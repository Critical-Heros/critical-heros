import OpenAI from 'openai'
import { clickhouse } from '@/db/clickhouse'
import 'dotenv/config'

// Lazily construct the OpenAI client so importing this module doesn't require
// OPENAI_API_KEY at boot (the SDK throws on a missing key at construction).
let openaiClient: OpenAI | undefined
function getOpenAI(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  }
  return openaiClient
}

// Convert text into an embedding vector
export async function generateEmbedding(text: string): Promise<number[]> {
  const response = await getOpenAI().embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
  })
  return response.data[0].embedding
}

// 커밋 하나를 임베딩해서 ClickHouse에 업데이트
export async function embedCommit(sha: string, repoId: string, message: string, diff: string) {
  // 커밋 메시지 + diff 합쳐서 벡터화
  const text = `${message}\n\n${diff}`.slice(0, 8000) // 토큰 초과 방지
  const embedding = await generateEmbedding(text)

  await clickhouse.exec({
    query: `
      ALTER TABLE commits UPDATE
        embedding = {embedding: Array(Float32)}
      WHERE sha = {sha: String} AND repo_id = {repoId: String}
    `,
    query_params: { embedding, sha, repoId },
  })

  console.log(`✅ Embedded commit ${sha}`)
}
