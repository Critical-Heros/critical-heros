import crypto from 'crypto'
import type { FastifyInstance } from 'fastify'
import { triggerPrReview } from '@/agent/triggerPrReview'
import { clickhouse } from '@/db/clickhouse'
import { embedCommit } from '@/indexer/embedder'
import 'dotenv/config'
import { Octokit } from '@octokit/rest'

interface GithubCommit {
  id: string
  author?: { name?: string }
  message: string
  timestamp: string
}

interface GithubWebhookBody {
  action?: string
  commits?: GithubCommit[]
  pull_request?: {
    number: number
    title: string
    merged: boolean
    merge_commit_sha: string
    user?: { login?: string; email?: string | null }
  }
  repository?: {
    full_name: string
    name: string
    owner?: { login: string }
  }
}

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

    // 2. 이벤트 종류 분기
    const event = request.headers['x-github-event'] as string
    const body = request.body as GithubWebhookBody

    // pull_request (merged) 이벤트 처리
    if (event === 'pull_request') {
      const pr = body.pull_request
      if (body.action !== 'closed' || !pr?.merged) {
        return reply.status(200).send({ message: 'Ignored PR event' })
      }

      const owner = body.repository?.owner?.login ?? ''
      const repo = body.repository?.name ?? ''
      const repoId = body.repository?.full_name ?? ''

      triggerPrReview({
        owner,
        repo,
        repoId,
        prNumber: pr.number,
        prTitle: pr.title,
        mergeCommitSha: pr.merge_commit_sha,
        authorLogin: pr.user?.login ?? 'unknown',
        authorEmail: pr.user?.email ?? undefined,
      }).catch((err: unknown) => console.error('[webhook/github] PR review trigger 실패:', err))

      return reply.status(200).send({ message: `PR #${pr.number} review triggered` })
    }

    if (event !== 'push') {
      return reply.status(200).send({ message: `Ignored event: ${event}` })
    }

    // 3. 커밋 데이터 파싱
    const repoId = body.repository?.full_name ?? ''
    const commits = body.commits ?? []

    if (commits.length === 0) {
      return reply.status(200).send({ message: 'No commits' })
    }

    console.log(`📦 Received ${commits.length} commits from ${repoId}`)

    // 4. ClickHouse에 커밋 저장
    const rows = commits.map((commit: GithubCommit) => ({
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

    // 5. GitHub API로 diff 가져와서 임베딩 생성 (비동기로 처리)
    const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN })
    const [owner, repo] = repoId.split('/')

    for (const commit of commits) {
      ;(async () => {
        try {
          const { data: detail } = await octokit.repos.getCommit({
            owner,
            repo,
            ref: commit.id,
          })
          const diff = detail.files?.map((f: { patch?: string }) => f.patch ?? '').join('\n') ?? ''
          await embedCommit(commit.id, repoId, commit.message, diff)
          console.log(`Embedded commit ${commit.id}`)
        } catch (err) {
          console.error(`Failed to embed commit ${commit.id}:`, err)
        }
      })()
    }

    return reply.status(200).send({ message: `Processed ${rows.length} commits` })
  })
}
