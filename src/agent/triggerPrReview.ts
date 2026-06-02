import { WebClient } from '@slack/web-api'
import { runAgent } from './router'
import 'dotenv/config'

export interface PrMergePayload {
  owner: string
  repo: string
  repoId: string
  prNumber: number
  prTitle: string
  mergeCommitSha: string
  authorLogin: string
  authorEmail?: string
}

const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN)

export async function triggerPrReview(payload: PrMergePayload): Promise<void> {
  const { owner, repo, repoId, prNumber, prTitle, mergeCommitSha, authorLogin } = payload
  const channel = process.env.SLACK_CRITICAL_CHANNEL ?? '#critical'

  const initialPost = await slackClient.chat.postMessage({
    channel,
    text: [
      '🔍 *PR Blast Radius 분석*',
      `*PR:* #${prNumber} ${prTitle}`,
      `*작성자:* ${authorLogin}  |  *저장소:* ${repoId}`,
      `*Merge Commit:* \`${mergeCommitSha.slice(0, 7)}\``,
      '',
      '⏳ 영향 범위 분석 중...',
    ].join('\n'),
  })

  try {
    const result = await runAgent(
      `PR #${prNumber} "${prTitle}" (by ${authorLogin})가 방금 머지됐습니다. ` +
        `merge commit SHA는 ${mergeCommitSha}이고 레포지토리는 ${repoId}입니다. ` +
        '1) analyze_commit_impact 도구로 이 커밋의 Blast Radius를 분석하고, ' +
        '2) post_pr_comment 도구로 PR에 분석 결과 코멘트를 작성해주세요. ' +
        `post_pr_comment 호출 시: owner="${owner}", repo="${repo}", pr_number=${prNumber}`,
      repoId,
    )

    await slackClient.chat.postMessage({
      channel,
      thread_ts: initialPost.ts,
      text: result.text,
    })

    // 위험도 파싱 후 HIGH면 PR 작성자에게 DM
    const riskMatch = result.text.match(/\b(HIGH|MEDIUM|LOW)\b/)
    if (riskMatch?.[0] === 'HIGH') {
      await notifyAuthorDm(payload, result.text)
    }
  } catch (error) {
    console.error('[triggerPrReview] 에이전트 분석 실패:', error)
    await slackClient.chat.postMessage({
      channel,
      thread_ts: initialPost.ts,
      text: `❌ PR #${prNumber} 자동 분석에 실패했습니다. 수동으로 확인해주세요.`,
    })
  }
}

async function notifyAuthorDm(payload: PrMergePayload, analysisText: string): Promise<void> {
  const { prNumber, repoId, authorLogin, authorEmail } = payload

  try {
    let userId: string | undefined

    // 이메일로 Slack 사용자 조회
    if (authorEmail) {
      const res = await slackClient.users.lookupByEmail({ email: authorEmail })
      userId = res.user?.id
    }

    if (!userId) {
      console.log(`[triggerPrReview] Slack 사용자 미조회: ${authorLogin} (email: ${authorEmail ?? 'none'})`)
      return
    }

    const dm = await slackClient.conversations.open({ users: userId })
    const dmChannel = dm.channel?.id
    if (!dmChannel) return

    const preview = analysisText.length > 400 ? analysisText.slice(0, 400) + '...' : analysisText

    await slackClient.chat.postMessage({
      channel: dmChannel,
      text: [
        `🔴 *[High Risk] PR #${prNumber} 머지 알림*`,
        `\`${repoId}\` 에 머지된 PR이 *HIGH* 위험도로 분류됐습니다. 확인이 필요합니다.`,
        '',
        preview,
      ].join('\n'),
    })
  } catch (err) {
    console.error('[triggerPrReview] Slack DM 전송 실패:', err)
  }
}
