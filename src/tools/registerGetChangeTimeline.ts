import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { clickhouse } from '@/db/clickhouse'
import { generateEmbedding } from '@/indexer/embedder'
import type { OptionsType } from '@/types'

export default function register(server: McpServer, _options: OptionsType) {
  server.registerTool(
    'get_change_timeline',
    {
      title: 'Get Change Timeline',
      description: '특정 기능이나 파일에 대한 변경 이력을 시간순으로 조회합니다',
      inputSchema: {
        query: z.string().describe('조회할 기능 또는 파일명'),
        repo_id: z.string().describe('레포지토리 ID'),
        limit: z.number().default(10).describe('반환할 결과 수'),
      },
    },
    async ({ query, repo_id, limit }) => {
      const queryEmbedding = await generateEmbedding(query)
      const result = await clickhouse.query({
        query: `
    SELECT sha, author, message, timestamp, distance
    FROM (
      SELECT
        sha,
        author,
        message,
        timestamp,
        cosineDistance(embedding, {queryEmbedding: Array(Float32)}) AS distance
      FROM commits
      WHERE repo_id = {repo_id: String}
        AND length(embedding) = {dim: UInt32}
    )
    WHERE distance < 0.5
    ORDER BY timestamp ASC
    LIMIT {limit: Int32}
  `,
        query_params: { queryEmbedding, repo_id, limit, dim: queryEmbedding.length },
        format: 'JSONEachRow',
      })

      const rows = (await result.json()) as Array<Record<string, unknown>>

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                query,
                timeline: rows,
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
