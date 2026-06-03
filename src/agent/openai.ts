import OpenAI from 'openai'
import type { AgentContext, AgentResponse } from './claude'
import { callMcpTool, createMcpClient } from './mcpClient'
import 'dotenv/config'

// Lazily construct the OpenAI client so importing this module doesn't require
// OPENAI_API_KEY at boot (the SDK throws on a missing key at construction).
let openaiClient: OpenAI | undefined
function getOpenAI(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  }
  return openaiClient
}

const SYSTEM_PROMPT = `당신은 Critical Hero입니다. 프로덕션 인시던트를 분석하는 인텔리전스 어시스턴트입니다.
커밋 히스토리와 코드 변경 이력을 분석하여 엔지니어가 장애 원인을 빠르게 파악하도록 돕습니다.

인시던트 분석 시 반드시 다음을 포함하세요:
1. 타이밍과 내용을 기반으로 가장 유력한 원인 커밋 식별
2. 해당 커밋이 무엇을 변경했고 왜 이슈를 유발할 수 있는지 설명
3. 즉각적인 완화 방법 제안

Slack 응답은 간결하게 유지하세요 (불릿 포인트 사용, 섹션당 800자 이내).
항상 한국어로 답변하세요.`

export async function runIncidentAgentOpenAI(
  userQuery: string,
  repoId: string,
  context: AgentContext = {},
): Promise<AgentResponse> {
  const mcpClient = await createMcpClient()

  try {
    // MCP 서버에서 사용 가능한 툴 목록 가져오기
    const { tools: mcpTools } = await mcpClient.listTools()

    const tools: OpenAI.Chat.ChatCompletionTool[] = mcpTools.map(t => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description ?? '',
        parameters: t.inputSchema,
      },
    }))

    const userContent = [
      `레포지토리: ${repoId}`,
      context.incidentTime ? `인시던트 발생 시각: ${context.incidentTime}` : null,
      `질문: ${userQuery}`,
    ]
      .filter(Boolean)
      .join('\n')

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...(context.threadHistory?.map(m => ({ role: m.role, content: m.text })) ?? []),
      { role: 'user', content: userContent },
    ]

    const toolsUsed: string[] = []

    while (true) {
      const response = await getOpenAI().chat.completions.create({
        model: process.env.OPENAI_MODEL ?? 'gpt-4o',
        max_tokens: 1024,
        tools,
        messages,
      })

      const choice = response.choices[0]

      if (choice.finish_reason === 'stop') {
        return {
          text: choice.message.content ?? '분석 결과를 생성하지 못했습니다.',
          toolsUsed,
        }
      }

      if (choice.finish_reason === 'tool_calls' && choice.message.tool_calls) {
        messages.push(choice.message)

        for (const toolCall of choice.message.tool_calls) {
          if (toolCall.type !== 'function') continue
          toolsUsed.push(toolCall.function.name)
          const input = JSON.parse(toolCall.function.arguments) as Record<string, unknown>
          // MCP 서버를 통해 툴 실행
          const result = await callMcpTool(mcpClient, toolCall.function.name, input)
          messages.push({ role: 'tool', tool_call_id: toolCall.id, content: result })
        }
      } else {
        break
      }
    }

    return { text: '분석이 완료되지 않았습니다.', toolsUsed }
  } finally {
    await mcpClient.close()
  }
}
