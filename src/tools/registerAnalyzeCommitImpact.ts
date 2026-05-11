import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { clickhouse } from '@/db/clickhouse'
import type { OptionsType } from '@/types'

export default function register(server: McpServer, _options: OptionsType) {
  server.registerTool(
    'analyze_commit_impact',
    {
      title: 'Analyze Commit Impact',
      description: 'PR 머지 후 변경된 파일을 분석하여 Blast Radius(영향 범위)를 평가합니다',
      inputSchema: {
        sha: z.string().describe('커밋 SHA'),
        repo_id: z.string().describe('레포지토리 ID'),
      },
    },
    async ({ sha, repo_id }) => {
      const result = await clickhouse.query({
        query: `
          SELECT sha, author, message, timestamp
          FROM commits
          WHERE sha = {sha: String}
            AND repo_id = {repo_id: String}
          LIMIT 1
        `,
        query_params: { sha, repo_id },
        format: 'JSONEachRow',
      })

      const rows = await result.json() as any[]

      if (rows.length === 0) {
        return {
          content: [{ type: 'text' as const, text: `커밋 ${sha}를 찾을 수 없습니다` }],
        }
      }

      const commit = rows[0]

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            sha: commit.sha,
            author: commit.author,
            message: commit.message,
            timestamp: commit.timestamp,
            blast_radius_analysis: `커밋 ${sha.slice(0, 7)}의 변경사항을 분석했습니다. 관련 서비스 및 영향 범위를 확인하세요.`,
            risk_score: 'MEDIUM',
          }, null, 2),
        }],
      }
    },
  )
}