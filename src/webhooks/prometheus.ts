import type { FastifyInstance } from 'fastify'
import { clickhouse } from '@/db/clickhouse'
import { pool } from '@/db/postgres'
import 'dotenv/config'

export async function registerPrometheusWebhook(app: FastifyInstance) {
  app.post('/webhook/prometheus', async (request, reply) => {
    const body = request.body as any

    console.log(`Prometheus alert received: ${body.status}`)

    const alerts = body.alerts || []

    for (const alert of alerts) {
      const alertName = alert.labels?.alertname || 'unknown'
      const status = alert.status
      const startsAt = alert.startsAt
      const labels = JSON.stringify(alert.labels || {})

      console.log(`Alert: ${alertName} - ${status}`)

      if (status === 'firing') {
        const client = await pool.connect()
        let incidentId = alertName

        try {
          const repoResult = await client.query('SELECT repository_id FROM repositories LIMIT 1')

          if (repoResult.rows.length > 0) {
            const repositoryId = repoResult.rows[0].repository_id

            // 인시던트 생성 후 incident_id 반환
            const incidentResult = await client.query(
              `INSERT INTO incidents (repository_id, title, status, created_at, updated_at)
               VALUES ($1, $2, 'OPEN', NOW(), NOW())
               ON CONFLICT DO NOTHING
               RETURNING incident_id`,
              [repositoryId, `[${alertName}] Prometheus Alert`],
            )

            // 실제 UUID 사용, 없으면 alertName 폴백
            incidentId = incidentResult.rows[0]?.incident_id ?? alertName
            console.log(`Incident created: ${incidentId}`)
          }
        } finally {
          client.release()
        }

        // ClickHouse에 메트릭 스냅샷 저장 (실제 incident_id로)
        await clickhouse.insert({
          table: 'metric_snapshots',
          values: [
            {
              incident_id: incidentId,
              metric_name: alertName,
              value: 1.0,
              labels,
              captured_at: new Date(startsAt).toISOString().slice(0, 19).replace('T', ' '),
            },
          ],
          format: 'JSONEachRow',
        })

        console.log(`Metric snapshot saved for: ${alertName}`)
      }
    }

    return reply.status(200).send({ message: 'OK' })
  })
}
