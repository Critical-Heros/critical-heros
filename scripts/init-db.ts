import { initClickHouseSchema } from '../src/db/clickhouse'
import { initPostgresSchema } from '../src/db/postgres'

async function main() {
  console.log('🚀 Initializing databases...')
  await initClickHouseSchema()
  await initPostgresSchema()
  console.log('All done!')
  process.exit(0)
}

main().catch((err) => {
  console.error(' Failed:', err)
  process.exit(1)
})