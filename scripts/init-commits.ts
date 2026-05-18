import { Octokit } from '@octokit/rest'
import { clickhouse } from '../src/db/clickhouse'
import { embedCommit } from '../src/indexer/embedder'
import 'dotenv/config'

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
})

async function fetchAndStoreCommits(owner: string, repo: string) {
  console.log(` Fetching commits from ${owner}/${repo}...`)

  let page = 1
  let totalSaved = 0

  while (true) {
    // 커밋 목록 가져오기
    const { data: commits } = await octokit.repos.listCommits({
      owner,
      repo,
      per_page: 100,
      page,
    })

    if (commits.length === 0) break

    console.log(` Page ${page}: ${commits.length} commits`)

    for (const commit of commits) {
      try {
        // 커밋 상세 정보 (diff 포함) 가져오기
        const { data: detail } = await octokit.repos.getCommit({
          owner,
          repo,
          ref: commit.sha,
        })

        const message = commit.commit.message
        const author = commit.commit.author?.name || 'unknown'
        const timestamp = commit.commit.author?.date || new Date().toISOString()
        const diff = detail.files?.map(f => f.patch || '').join('\n') || ''
        const repoId = `${owner}/${repo}`

        // ClickHouse에 저장
        await clickhouse.insert({
          table: 'commits',
          values: [{
            sha: commit.sha,
            repo_id: repoId,
            author,
            message,
            timestamp: new Date(timestamp).toISOString().replace('T', ' ').replace('Z', ''),
            diff_s3_key: '',
            embedding: [],
          }],
          format: 'JSONEachRow',
        })

        // 임베딩 생성
        await embedCommit(commit.sha, repoId, message, diff)

        totalSaved++
        console.log(`✅ ${totalSaved}. ${commit.sha.slice(0, 7)} - ${message.slice(0, 50)}`)

        // API 요청 속도 제한 방지
        await new Promise(r => setTimeout(r, 200))

      } catch (err) {
        console.error(` Failed for ${commit.sha}:`, err)
      }
    }

    page++
    if (commits.length < 100) break
  }

  console.log(`\n Done! Total saved: ${totalSaved} commits`)
  process.exit(0)
}

// 실행
const [owner, repo] = (process.argv[2] || '').split('/')
if (!owner || !repo) {
  console.error('Usage: tsx scripts/init-commits.ts owner/repo')
  console.error('Example: tsx scripts/init-commits.ts google/microservices-demo')
  process.exit(1)
}

fetchAndStoreCommits(owner, repo).catch(err => {
  console.error(' Error:', err)
  process.exit(1)
})