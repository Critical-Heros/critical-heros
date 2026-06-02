import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { clickhouse } from '@/db/clickhouse'
import { pool } from '@/db/postgres'
import { createNotionPostmortemPage } from '@/notion/postmortem'
import type { OptionsType } from '@/types'

export default function register(server: McpServer, _options: OptionsType) {
  server.registerTool(
    'draft_postmortem',
    {
      title: 'Draft Postmortem',
      description: '인시던트 ID를 기반으로 Postmortem 초안을 자동 생성하고 Notion에 저장합니다',
      inputSchema: {
        incident_id: z.string().describe('인시던트 ID'),
        root_cause: z.string().optional().describe('분석된 근본 원인 (correlate_incident 결과)'),
        impact: z.string().optional().describe('영향 범위 분석 결과 (analyze_commit_impact 결과)'),
        action_items: z.string().optional().describe('재발 방지 대책'),
      },
    },
    async ({ incident_id, root_cause, impact, action_items }) => {
      type Incident = { title: string; status: string; created_at: string; resolved_at: string | null }
      type MetricSnapshot = { metric_name: string; value: string | number; captured_at: string }

      // PostgreSQL에서 인시던트 정보 조회
      const client = await pool.connect()
      let incident: Incident | null = null

      try {
        const result = await client.query('SELECT * FROM incidents WHERE incident_id = $1', [incident_id])
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

      const metrics = (await metricResult.json()) as MetricSnapshot[]

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
          root_cause: root_cause ?? '원인 분석 결과를 여기에 작성하세요.',
          impact: impact ?? '영향 범위를 여기에 작성하세요.',
          action_items: action_items ?? '재발 방지 대책을 여기에 작성하세요.',
        },
      }

      // Notion 페이지 생성 (환경변수 미설정 시 건너뜀)
      let notionUrl: string | null = null
      try {
        notionUrl = await createNotionPostmortemPage(postmortem)

        // Notion URL을 PostgreSQL postmortems 테이블에 저장
        const dbClient = await pool.connect()
        try {
          await dbClient.query(
            `INSERT INTO postmortems (incident_id, notion_page_url, content)
             VALUES ($1, $2, $3)
             ON CONFLICT (incident_id) DO UPDATE
               SET notion_page_url = EXCLUDED.notion_page_url,
                   updated_at = now()`,
            [incident_id, notionUrl, JSON.stringify(postmortem)],
          )
        } finally {
          dbClient.release()
        }
      } catch (err) {
        console.warn('[draft_postmortem] Notion 저장 실패 (계속 진행):', err)
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                ...postmortem,
                notion_url: notionUrl ?? '(NOTION_TOKEN 또는 NOTION_DATABASE_ID 미설정)',
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
