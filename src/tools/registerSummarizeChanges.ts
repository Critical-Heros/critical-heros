import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { clickhouse } from '@/db/clickhouse'
import type { OptionsType } from '@/types'

export default function register(server: McpServer, _options: OptionsType) {
  server.registerTool(
    'summarize_changes',
    {
      title: 'Summarize Changes',
      description: '특정 기간의 변경사항을 changelog 형식으로 요약합니다',
      inputSchema: {
        repo_id: z.string().describe('레포지토리 ID'),
        from_date: z.string().describe('시작 날짜 (YYYY-MM-DD)'),
        to_date: z.string().describe('종료 날짜 (YYYY-MM-DD)'),
      },
    },
    async ({ repo_id, from_date, to_date }) => {
      const result = await clickhouse.query({
        query: `
          SELECT sha, author, message, timestamp
          FROM commits
          WHERE repo_id = {repo_id: String}
            AND timestamp >= {from_date: String}
            AND timestamp <= {to_date: String}
          ORDER BY timestamp DESC
        `,
        query_params: { repo_id, from_date, to_date },
        format: 'JSONEachRow',
      })

      const rows = (await result.json()) as any[]

      const summary = {
        repo_id,
        period: `${from_date} ~ ${to_date}`,
        total_commits: rows.length,
        authors: [...new Set(rows.map((r: any) => r.author))],
        changelog: rows.map((r: any) => `- ${r.message} (${r.author}, ${r.timestamp})`).join('\n'),
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(summary, null, 2),
          },
        ],
      }
    },
  )
}
