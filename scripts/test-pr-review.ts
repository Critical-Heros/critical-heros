import { triggerPrReview } from '../src/agent/triggerPrReview'

// 실제 PR merge 이벤트를 시뮬레이션
async function main() {
  console.log('🧪 PR review agent 테스트 시작...')

  await triggerPrReview({
    owner: 'your-github-org', // 실제 GitHub owner로 변경
    repo: 'your-repo', // 실제 repo 이름으로 변경
    repoId: 'your-github-org/your-repo',
    prNumber: 1, // 실제 PR 번호로 변경
    prTitle: 'feat: add payment retry logic',
    mergeCommitSha: 'abc1234def5678901234567890abcdef12345678',
    authorLogin: 'your-github-username',
    authorEmail: 'your-slack-email@example.com', // Slack DM 테스트 시 본인 이메일로
  })

  console.log('✅ 테스트 완료')
  process.exit(0)
}

main().catch(err => {
  console.error('❌ 실패:', err)
  process.exit(1)
})
