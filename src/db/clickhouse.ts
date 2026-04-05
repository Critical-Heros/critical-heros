import { createClient } from '@clickhouse/client'
import 'dotenv/config'

export const clickhouse = createClient({
  url: `http://${process.env.CLICKHOUSE_HOST}:${process.env.CLICKHOUSE_PORT}`,
  database: process.env.CLICKHOUSE_DB,
  username: process.env.CLICKHOUSE_USER,
  password: process.env.CLICKHOUSE_PASSWORD ?? '',
})

// ClickHouse 스키마 초기화
export async function initClickHouseSchema() {
  // 커밋 인덱스 테이블
  await clickhouse.exec({
    query: `
      CREATE TABLE IF NOT EXISTS commits (
        sha         String,
        repo_id     String,
        author      String,
        message     String,
        timestamp   DateTime,
        diff_s3_key String,
        embedding   Array(Float32),
        created_at  DateTime DEFAULT now()
      ) ENGINE = MergeTree()
      ORDER BY (repo_id, timestamp)
    `,
  })

  // 메트릭 스냅샷 테이블
  await clickhouse.exec({
    query: `
      CREATE TABLE IF NOT EXISTS metric_snapshots (
        incident_id  String,
        metric_name  String,
        value        Float64,
        labels       String,
        captured_at  DateTime,
        created_at   DateTime DEFAULT now()
      ) ENGINE = MergeTree()
      ORDER BY (incident_id, captured_at)
    `,
  })

  // Slack 스레드 테이블
  await clickhouse.exec({
    query: `
      CREATE TABLE IF NOT EXISTS slack_threads (
        thread_ts    String,
        channel_id   String,
        user_id      String,
        message      String,
        incident_id  Nullable(String),
        posted_at    DateTime,
        created_at   DateTime DEFAULT now()
      ) ENGINE = MergeTree()
      ORDER BY (channel_id, posted_at)
    `,
  })

  console.log('ClickHouse schema initialized')
}