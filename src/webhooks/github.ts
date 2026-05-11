import type { FastifyInstance } from 'fastify'
import crypto from 'crypto'
import { clickhouse } from '@/db/clickhouse'
import { embedCommit } from '@/indexer/embedder'
import 'dotenv/config'

// GitHub 웹훅 서명 검증 함수
function verifyGithubSignature(payload: string, signature: string): boolean {
  const secret = process.env.GITHUB_WEBHOOK_SECRET || ''
  const hmac = crypto.createHmac('sha256', secret)
  const digest = 'sha256=' + hmac.update(payload).digest('hex')
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature))
}

export async function registerGithubWebhook(app: FastifyInstance) {
  app.post('/webhook/github', async (request, reply) => {
    // 1. 서명 검증
    const signature = request.headers['x-hub-signature-256'] as string
    if (!signature) {
      return reply.status(401).send({ error: 'No signature provided' })
    }

    const rawBody = JSON.stringify(request.body)
    if (!verifyGithubSignature(rawBody, signature)) {
      return reply.status(401).send({ error: 'Invalid signature' })
    }

    // 2. push 이벤트인지 확인
    const event = request.headers['x-github-event'] as string
    if (event !== 'push') {
      return reply.status(200).send({ message: `Ignored event: ${event}` })
    }

    // 3. 커밋 데이터 파싱
    const body = request.body as any
    const repoId = body.repository?.full_name
    const commits = body.commits || []

    if (commits.length === 0) {
      return reply.status(200).send({ message: 'No commits' })
    }

    console.log(`📦 Received ${commits.length} commits from ${repoId}`)

    // 4. ClickHouse에 커밋 저장
    const rows = commits.map((commit: any) => ({
      sha: commit.id,
      repo_id: repoId,
      author: commit.author?.name || 'unknown',
      message: commit.message,
      timestamp: new Date(commit.timestamp).toISOString().slice(0, 19).replace('T', ' '),
      diff_s3_key: '',
      embedding: [] as number[],
    }))

    await clickhouse.insert({
      table: 'commits',
      values: rows,
      format: 'JSONEachRow',
    })

    console.log(`✅ Saved ${rows.length} commits to ClickHouse`)

    // 5. 임베딩 생성 (비동기로 처리)
    for (const commit of commits) {
      const diff = commit.added?.join('\n') + commit.modified?.join('\n') || ''
      embedCommit(commit.id, repoId, commit.message, diff).catch(console.error)
    }

    return reply.status(200).send({ message: `Processed ${rows.length} commits` })
  })
}