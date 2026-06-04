import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebClient } from '@slack/web-api'
import { z } from 'zod'
import { savePendingKnowledge } from '@/indexer/knowledge'
import type { OptionsType } from '@/types'

let slackClient: WebClient | undefined
function getSlack(): WebClient {
  if (!slackClient) slackClient = new WebClient(process.env.SLACK_BOT_TOKEN)
  return slackClient
}

// Post the proposed recipe to the owner with Approve/Deny buttons. The buttons carry only
// the row id + repo so the interactivity payload stays well under Slack's value limit.
async function requestApproval(id: string, repoId: string, title: string, content: string): Promise<void> {
  const slack = getSlack()
  const target = process.env.SLACK_DM_USER_ID
    ? (await slack.conversations.open({ users: process.env.SLACK_DM_USER_ID })).channel?.id
    : process.env.SLACK_CRITICAL_CHANNEL
  if (!target) return

  const preview = content.length > 800 ? `${content.slice(0, 800)}...` : content
  const value = JSON.stringify({ id, repo_id: repoId })

  await slack.chat.postMessage({
    channel: target,
    text: `레시피 저장 승인 요청: ${title}`,
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: `*레시피 저장 승인 요청*\n*${title}*\n${preview}` } },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: 'Yes' },
            style: 'primary',
            action_id: 'approve_knowledge',
            value,
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: 'No' },
            style: 'danger',
            action_id: 'deny_knowledge',
            value,
          },
        ],
      },
    ],
  })
}

export default function register(server: McpServer, _options: OptionsType) {
  server.registerTool(
    'save_knowledge',
    {
      title: 'Save Knowledge',
      description:
        '나중에 스스로 떠올릴 수 있도록 지식을 저장합니다. 두 종류 모두 저장하세요: ' +
        '(1) 컨벤션/선호/반복 작업 레시피 (브랜치 네이밍, PR 작성 방식 등), ' +
        '(2) 장애 대응(파이어파이팅) 노하우 — 증상, 원인 커밋, 완화 방법, 재발 방지책. ' +
        '저장 전 사용자에게 Slack 버튼으로 승인을 요청하며, 승인해야만 실제로 저장됩니다. ' +
        '사용자가 규칙을 알려주거나, 인시던트를 해결하며 교훈을 얻으면 호출하세요.',
      inputSchema: {
        repo_id: z.string().describe('레포지토리 ID'),
        title: z.string().describe('레시피 제목 (짧고 검색하기 좋게)'),
        content: z.string().describe('기억할 실제 내용 (규칙, 절차, 선호, 장애 대응 방법 등)'),
        tags: z.array(z.string()).default([]).describe('분류용 태그 (예: convention, incident, deploy)'),
      },
    },
    async ({ repo_id, title, content, tags }) => {
      try {
        const id = await savePendingKnowledge({ repoId: repo_id, title, content, tags })
        await requestApproval(id, repo_id, title, content)

        return {
          content: [
            { type: 'text' as const, text: `"${title}" 저장을 사용자에게 승인 요청했어요. 승인하면 기억해둘게요.` },
          ],
        }
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `레시피 저장 요청 실패: ${(err as Error).message}` }],
        }
      }
    },
  )
}
