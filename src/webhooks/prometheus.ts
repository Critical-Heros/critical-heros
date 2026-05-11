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
      const status = alert.status // firing or resolved
      const startsAt = alert.startsAt
      const labels = JSON.stringify(alert.labels || {})

      console.log(`Alert: ${alertName} - ${status}`)

      // 1. PostgreSQL에 인시던트 생성 (firing일 때만)
      if (status === 'firing') {
        const client = await pool.connect()
        try {
          // 레포지토리 ID 가져오기 (일단 첫 번째 레포 사용)
          const repoResult = await client.query(
            'SELECT repository_id FROM repositories LIMIT 1'
          )

          if (repoResult.rows.length > 0) {
            const repositoryId = repoResult.rows[0].repository_id

            // 인시던트 생성
            await client.query(
              `INSERT INTO incidents (repository_id, title, status, created_at, updated_at)
               VALUES ($1, $2, 'OPEN', NOW(), NOW())
               ON CONFLICT DO NOTHING`,
              [repositoryId, `[${alertName}] Prometheus Alert`]
            )
            console.log(`Incident created for alert: ${alertName}`)
          }
        } finally {
          client.release()
        }

        // 2. ClickHouse에 메트릭 스냅샷 저장
        await clickhouse.insert({
          table: 'metric_snapshots',
          values: [{
            incident_id: alertName,
            metric_name: alertName,
            value: 1.0,
            labels,
            captured_at: new Date(startsAt).toISOString().slice(0, 19).replace('T', ' '),
          }],
          format: 'JSONEachRow',
        })

        console.log(`Metric snapshot saved for: ${alertName}`)
      }
    }

    return reply.status(200).send({ message: 'OK' })
  })
}