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
      // 해당 커밋 조회
      const result = await clickhouse.query({
        query: `
          SELECT sha, author, message, timestamp, diff_s3_key
          FROM commits
          WHERE sha = {sha: String}
            AND repo_id = {repo_id: String}
          LIMIT 1
        `,
        query_params: { sha, repo_id },
        format: 'JSONEachRow',
      })

      const rows = (await result.json()) as any[]

      if (rows.length === 0) {
        return {
          content: [{ type: 'text' as const, text: `커밋 ${sha}를 찾을 수 없습니다` }],
        }
      }

      const commit = rows[0]

      // 같은 레포에서 최근 변경 빈도 조회 (위험도 계산용)
      const recentResult = await clickhouse.query({
        query: `
          SELECT count() AS recent_commit_count
          FROM commits
          WHERE repo_id = {repo_id: String}
            AND timestamp >= now() - INTERVAL 24 HOUR
        `,
        query_params: { repo_id },
        format: 'JSONEachRow',
      })

      const recentRows = (await recentResult.json()) as any[]
      const recentCount = recentRows[0]?.recent_commit_count ?? 0

      // 메시지 기반 위험도 키워드 분석
      const message = commit.message.toLowerCase()
      const highRiskKeywords = ['hotfix', 'critical', 'urgent', 'breaking', 'security', 'auth', 'payment']
      const mediumRiskKeywords = ['fix', 'bug', 'patch', 'update', 'refactor', 'migration']

      let riskScore = 'LOW'
      if (highRiskKeywords.some(k => message.includes(k))) {
        riskScore = 'HIGH'
      } else if (mediumRiskKeywords.some(k => message.includes(k)) || recentCount > 5) {
        riskScore = 'MEDIUM'
      }

      const riskEmoji = riskScore === 'HIGH' ? '🔴' : riskScore === 'MEDIUM' ? '🟡' : '🟢'

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                sha: commit.sha,
                author: commit.author,
                message: commit.message,
                timestamp: commit.timestamp,
                risk_score: riskScore,
                risk_emoji: riskEmoji,
                risk_reason:
                  riskScore === 'HIGH'
                    ? '고위험 키워드가 커밋 메시지에 포함되어 있습니다.'
                    : riskScore === 'MEDIUM'
                      ? '수정/버그 관련 키워드가 포함되어 있거나 최근 24시간 내 변경이 많습니다.'
                      : '일반적인 변경사항으로 위험도가 낮습니다.',
                recent_commits_24h: recentCount,
                blast_radius_analysis: `커밋 ${sha.slice(0, 7)}의 변경사항을 분석했습니다. 관련 서비스 및 영향 범위를 확인하세요.`,
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
