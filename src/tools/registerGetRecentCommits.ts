import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { clickhouse } from '@/db/clickhouse'
import type { OptionsType } from '@/types'

export default function register(server: McpServer, _options: OptionsType) {
  server.registerTool(
    'get_recent_commits',
    {
      title: 'Get Recent Commits',
      description: 'ClickHouse에서 특정 레포의 최근 커밋 목록을 조회합니다',
      inputSchema: {
        repo_id: z.string().describe('레포지토리 ID'),
        since_hours: z.number().default(24).describe('몇 시간 이내 커밋 (기본 24시간)'),
      },
    },
    async ({ repo_id, since_hours }) => {
      const result = await clickhouse.query({
        query: `
          SELECT sha, author, message, timestamp, diff_s3_key
          FROM commits
          WHERE repo_id = {repo_id: String}
            AND timestamp >= now() - INTERVAL {since_hours: Int32} HOUR
          ORDER BY timestamp DESC
          LIMIT 50
        `,
        query_params: { repo_id, since_hours },
        format: 'JSONEachRow',
      })

      const rows = await result.json()

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(rows, null, 2),
          },
        ],
      }
    },
  )
}