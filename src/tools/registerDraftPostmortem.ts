import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { pool } from '@/db/postgres'
import { clickhouse } from '@/db/clickhouse'
import type { OptionsType } from '@/types'

export default function register(server: McpServer, _options: OptionsType) {
  server.registerTool(
    'draft_postmortem',
    {
      title: 'Draft Postmortem',
      description: '인시던트 ID를 기반으로 Postmortem 초안을 자동 생성합니다',
      inputSchema: {
        incident_id: z.string().describe('인시던트 ID'),
      },
    },
    async ({ incident_id }) => {
      // PostgreSQL에서 인시던트 정보 조회
      const client = await pool.connect()
      let incident: any = null

      try {
        const result = await client.query(
          'SELECT * FROM incidents WHERE incident_id = $1',
          [incident_id]
        )
        incident = result.rows[0]
      } finally {
        client.release()
      }

      if (!incident) {
        return {
          content: [{ type: 'text' as const, text: `인시던트 ${incident_id}를 찾을 수 없습니다` }],
        }
      }

      // ClickHouse에서 관련 메트릭 조회
      const metricResult = await clickhouse.query({
        query: `
          SELECT metric_name, value, captured_at
          FROM metric_snapshots
          WHERE incident_id = {incident_id: String}
          ORDER BY captured_at ASC
          LIMIT 10
        `,
        query_params: { incident_id },
        format: 'JSONEachRow',
      })

      const metrics = await metricResult.json() as any[]

      // Postmortem 초안 생성
      const postmortem = {
        title: `Postmortem: ${incident.title}`,
        incident_id,
        date: new Date().toISOString().split('T')[0],
        status: incident.status,
        created_at: incident.created_at,
        resolved_at: incident.resolved_at,
        sections: {
          summary: `${incident.title} 장애가 ${incident.created_at}에 발생하여 ${incident.resolved_at || '미해결'} 상태입니다.`,
          timeline: metrics.map(m => `[${m.captured_at}] ${m.metric_name}: ${m.value}`).join('\n'),
          root_cause: '원인 분석 결과를 여기에 작성하세요.',
          impact: '영향 범위를 여기에 작성하세요.',
          action_items: '재발 방지 대책을 여기에 작성하세요.',
        },
      }

      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(postmortem, null, 2),
        }],
      }
    },
  )
}