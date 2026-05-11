import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { clickhouse } from '@/db/clickhouse'
import { generateEmbedding } from '@/indexer/embedder'
import type { OptionsType } from '@/types'

export default function register(server: McpServer, _options: OptionsType) {
  server.registerTool(
    'search_commits',
    {
      title: 'Search Commits',
      description: '자연어 질의로 의미론적으로 유사한 커밋을 검색합니다 (RAG)',
      inputSchema: {
        query: z.string().describe('자연어 검색 질의'),
        repo_id: z.string().describe('레포지토리 ID'),
        limit: z.number().default(5).describe('반환할 결과 수'),
      },
    },
    async ({ query, repo_id, limit }) => {
      // 질의를 벡터로 변환
      const queryEmbedding = await generateEmbedding(query)

      // ClickHouse에서 유사 벡터 검색
      const result = await clickhouse.query({
        query: `
          SELECT
            sha,
            author,
            message,
            timestamp,
            cosineDistance(embedding, {queryEmbedding: Array(Float32)}) AS distance
          FROM commits
          WHERE repo_id = {repo_id: String}
            AND length(embedding) > 0
          ORDER BY distance ASC
          LIMIT {limit: Int32}
        `,
        query_params: { queryEmbedding, repo_id, limit },
        format: 'JSONEachRow',
      })

      const rows = await result.json() as any[]

      if (rows.length === 0) {
        return {
          content: [{ type: 'text' as const, text: '관련 커밋을 찾을 수 없습니다' }],
        }
      }

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify({
            query,
            results: rows,
          }, null, 2),
        }],
      }
    },
  )
}