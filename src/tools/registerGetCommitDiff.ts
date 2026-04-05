import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { clickhouse } from '@/db/clickhouse'
import type { OptionsType } from '@/types'

export default function register(server: McpServer, _options: OptionsType) {
  server.registerTool(
    'get_commit_diff',
    {
      title: 'Get Commit Diff',
      description: '특정 커밋의 diff를 조회합니다',
      inputSchema: {
        sha: z.string().describe('커밋 SHA'),
      },
    },
    async ({ sha }) => {
      const result = await clickhouse.query({
        query: `
          SELECT sha, author, message, timestamp, diff_s3_key
          FROM commits
          WHERE sha = {sha: String}
          LIMIT 1
        `,
        query_params: { sha },
        format: 'JSONEachRow',
      })

      const rows = await result.json() as any[]

      if (rows.length === 0) {
        return {
          content: [{ type: 'text' as const, text: `커밋 ${sha}를 찾을 수 없습니다` }],
        }
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(rows[0], null, 2),
          },
        ],
      }
    },
  )
}