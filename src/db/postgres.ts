import pg from 'pg'
import 'dotenv/config'

const { Pool } = pg

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
})

// PostgreSQL 스키마 초기화 (ERD 기반)
export async function initPostgresSchema() {
  const client = await pool.connect()
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS workspaces (
        workspace_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        slack_team_id VARCHAR NOT NULL UNIQUE,
        name          VARCHAR NOT NULL,
        created_at    TIMESTAMP DEFAULT now(),
        updated_at    TIMESTAMP DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS users (
        user_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id  UUID REFERENCES workspaces(workspace_id),
        slack_user_id VARCHAR NOT NULL,
        name          VARCHAR,
        email         VARCHAR,
        role          VARCHAR DEFAULT 'USER',
        created_at    TIMESTAMP DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS repositories (
        repository_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id   UUID REFERENCES workspaces(workspace_id),
        github_repo_id VARCHAR NOT NULL,
        name           VARCHAR NOT NULL,
        url            VARCHAR,
        is_tracking    BOOLEAN DEFAULT true,
        created_at     TIMESTAMP DEFAULT now(),
        updated_at     TIMESTAMP DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS integrations (
        integration_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        workspace_id   UUID REFERENCES workspaces(workspace_id),
        provider       VARCHAR NOT NULL,
        access_token   VARCHAR NOT NULL,
        status         VARCHAR DEFAULT 'ACTIVE',
        created_at     TIMESTAMP DEFAULT now(),
        updated_at     TIMESTAMP DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS incidents (
        incident_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        repository_id  UUID REFERENCES repositories(repository_id),
        title          VARCHAR NOT NULL,
        status         VARCHAR DEFAULT 'OPEN',
        slack_thread_ts VARCHAR,
        created_at     TIMESTAMP DEFAULT now(),
        resolved_at    TIMESTAMP,
        updated_at     TIMESTAMP DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS postmortems (
        postmortem_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        incident_id    UUID UNIQUE REFERENCES incidents(incident_id),
        notion_page_url VARCHAR,
        content        TEXT,
        created_at     TIMESTAMP DEFAULT now(),
        updated_at     TIMESTAMP DEFAULT now()
      );
    `)
    console.log('✅ PostgreSQL schema initialized')
  } finally {
    client.release()
  }
}