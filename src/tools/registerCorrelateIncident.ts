import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { clickhouse } from '@/db/clickhouse'
import type { OptionsType } from '@/types'

export default function register(server: McpServer, _options: OptionsType) {
  server.registerTool(
    'correlate_incident',
    {
      title: 'Correlate Incident',
      description: '에러 메시지와 타임스탬프를 기반으로 원인 커밋을 찾습니다',
      inputSchema: {
        repo_id: z.string().describe('레포지토리 ID'),
        error_message: z.string().describe('인시던트 에러 메시지'),
        timestamp: z.string().describe('인시던트 발생 시각 (ISO 8601)'),
        window_hours: z.number().default(6).describe('탐색 시간 범위 (기본 6시간)'),
      },
    },
    async ({ repo_id, error_message, timestamp, window_hours }) => {
      // 인시던트 발생 시각 기준으로 이전 커밋들 조회
      const result = await clickhouse.query({
        query: `
          SELECT sha, author, message, timestamp, diff_s3_key
          FROM commits
          WHERE repo_id = {repo_id: String}
            AND timestamp BETWEEN 
              parseDateTimeBestEffort({timestamp: String}) - INTERVAL {window_hours: Int32} HOUR
              AND parseDateTimeBestEffort({timestamp: String})
          ORDER BY timestamp DESC
          LIMIT 20
        `,
        query_params: { repo_id, timestamp, window_hours },
        format: 'JSONEachRow',
      })

      const commits = await result.json() as any[]

      if (commits.length === 0) {
        return {
          content: [{
            type: 'text' as const,
            text: '해당 시간대에 커밋이 없습니다',
          }],
        }
      }

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            error_message,
            incident_time: timestamp,
            candidate_commits: commits,
            analysis: `인시던트 발생 ${window_hours}시간 이내 ${commits.length}개의 커밋을 발견했습니다. 가장 최근 커밋(${commits[0].sha})을 우선 확인하세요.`,
          }, null, 2),
        }],
      }
    },
  )
}