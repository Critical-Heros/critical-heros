import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { clickhouse } from '@/db/clickhouse'
import type { OptionsType } from '@/types'

export default function register(server: McpServer, _options: OptionsType) {
  server.registerTool(
    'get_related_commits',
    {
      title: 'Get Related Commits',
      description: '특정 파일과 관련된 최근 커밋들을 조회합니다',
      inputSchema: {
        file_paths: z.array(z.string()).describe('파일 경로 목록'),
        repo_id: z.string().describe('레포지토리 ID'),
        limit: z.number().default(10).describe('반환할 결과 수'),
      },
    },
    async ({ file_paths, repo_id, limit }) => {
      const result = await clickhouse.query({
        query: `
          SELECT sha, author, message, timestamp
          FROM commits
          WHERE repo_id = {repo_id: String}
          ORDER BY timestamp DESC
          LIMIT {limit: Int32}
        `,
        query_params: { repo_id, limit },
        format: 'JSONEachRow',
      })

      const rows = (await result.json()) as any[]

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                file_paths,
                related_commits: rows,
              },
              null,
              2,
            ),
          },
        ],
      }
    },
  )
}
