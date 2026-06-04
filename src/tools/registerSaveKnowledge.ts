import { createHash } from 'node:crypto'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { clickhouse } from '@/db/clickhouse'
import { generateEmbedding } from '@/indexer/embedder'
import type { OptionsType } from '@/types'

// Deterministic id from repo + title so re-saving the same recipe updates it in place
// (ReplacingMergeTree collapses on the ORDER BY key) instead of duplicating.
function knowledgeId(repoId: string, title: string): string {
  return createHash('sha1').update(`${repoId}:${title.trim().toLowerCase()}`).digest('hex')
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
        const embedding = await generateEmbedding(`${title}\n\n${content}`)

        await clickhouse.insert({
          table: 'knowledge',
          // Omit created_at/updated_at so the now() defaults apply; the newest write wins.
          values: [{ id: knowledgeId(repo_id, title), repo_id, title, content, tags, embedding }],
          format: 'JSONEachRow',
        })

        return {
          content: [{ type: 'text' as const, text: `레시피를 저장했습니다: "${title}"` }],
        }
      } catch (err) {
        return {
          content: [{ type: 'text' as const, text: `레시피 저장 실패: ${(err as Error).message}` }],
        }
      }
    },
  )
}
