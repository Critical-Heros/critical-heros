import { type AgentContext, type AgentResponse, runIncidentAgent } from './claude'
import { runIncidentAgentOpenAI } from './openai'

export type { AgentContext, AgentResponse }

// AGENT_PROVIDER 환경변수로 에이전트 선택 (기본값: claude)
export async function runAgent(userQuery: string, repoId: string, context: AgentContext = {}): Promise<AgentResponse> {
  const provider = process.env.AGENT_PROVIDER ?? 'claude'

  if (provider === 'openai') {
    return runIncidentAgentOpenAI(userQuery, repoId, context)
  }

  return runIncidentAgent(userQuery, repoId, context)
}
