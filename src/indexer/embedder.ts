import OpenAI from 'openai'
import { clickhouse } from '@/db/clickhouse'
import 'dotenv/config'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

// 텍스트를 벡터로 변환
export async function generateEmbedding(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
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