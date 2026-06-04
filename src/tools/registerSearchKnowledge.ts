import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { clickhouse } from '@/db/clickhouse'
import { generateEmbedding } from '@/indexer/embedder'
import type { OptionsType } from '@/types'

export default function register(server: McpServer, _options: OptionsType) {
  server.registerTool(
    'search_knowledge',
    {
      title: 'Search Knowledge',
      description:
        '저장해둔 컨벤션/레시피/장애 대응 노하우를 의미론적으로 검색합니다. ' +
        '사용자에게 규칙이나 기본값을 묻기 전에 먼저 이 도구로 확인하세요.',
      inputSchema: {
        repo_id: z.string().describe('레포지토리 ID'),
        query: z.string().describe('자연어 검색 질의 (지금 하려는 작업이나 상황)'),
        limit: z.number().default(5).describe('반환할 결과 수'),
      },
    },
    async ({ repo_id, query, limit }) => {
      const queryEmbedding = await generateEmbedding(query)

      // FINAL collapses ReplacingMergeTree duplicates so we read one row per recipe.
      // length(embedding) = {dim} guards cosineDistance against size mismatches.
      const result = await clickhouse.query({
        query: `
          SELECT
            title,
            content,
            tags,
            cosineDistance(embedding, {queryEmbedding: Array(Float32)}) AS distance
          FROM knowledge FINAL
          WHERE repo_id = {repo_id: String}
            AND length(embedding) = {dim: UInt32}
          ORDER BY distance ASC
          LIMIT {limit: Int32}
        `,
        query_params: { queryEmbedding, repo_id, limit, dim: queryEmbedding.length },
        format: 'JSONEachRow',
      })

      const rows = (await result.json()) as Array<Record<string, unknown>>

      if (rows.length === 0) {
        return {
          content: [{ type: 'text' as const, text: '저장된 관련 레시피가 없습니다.' }],
        }
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ query, recipes: rows }, null, 2) }],
      }
    },
  )
}
