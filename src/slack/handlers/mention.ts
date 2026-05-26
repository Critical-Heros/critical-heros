import type { App } from '@slack/bolt'
import { type AgentContext, runAgent } from '@/agent/router'

// 스레드별 대화 히스토리 (멀티턴 컨텍스트)
const threadHistory = new Map<string, Array<{ role: 'user' | 'assistant'; text: string }>>()

export function registerMentionHandler(app: App): void {
  app.event('app_mention', async ({ event, say, client }) => {
    // 봇 멘션 태그 제거 후 실제 질문 추출
    const query = event.text.replace(/<@[A-Z0-9]+>/g, '').trim()

    if (!query) {
      await say({
        text: '무엇을 도와드릴까요? `@critical-hero <질문>` 형식으로 질문해주세요.\n예) `@critical-hero 배포 후 API 에러가 발생했어. 원인 커밋 찾아줘`',
        thread_ts: event.ts,
      })
      return
    }

    // 분석 중임을 먼저 알림
    const thinkingResult = await say({
      text: '🔍 분석 중입니다...',
      thread_ts: event.ts,
    })

    const threadTs = (event as { thread_ts?: string }).thread_ts ?? event.ts
    const repoId = process.env.DEFAULT_REPO_ID ?? 'default'

    // 이전 대화 히스토리 가져오기 (멀티턴)
    const history = threadHistory.get(threadTs) ?? []
    const context: AgentContext = { threadHistory: history }

    try {
      const result = await runAgent(query, repoId, context)

      // 대화 히스토리 업데이트
      history.push({ role: 'user', text: query })
      history.push({ role: 'assistant', text: result.text })
      threadHistory.set(threadTs, history)

      // 분석 중 메시지를 최종 결과로 교체
      if (thinkingResult.ts) {
        await client.chat.update({
          channel: event.channel,
          ts: thinkingResult.ts as string,
          text: result.text,
        })
      } else {
        await say({ text: result.text, thread_ts: event.ts })
      }
    } catch (error) {
      console.error('[Slack] mention handler error:', error)
      const errMsg = '❌ 분석 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.'
      if (thinkingResult.ts) {
        await client.chat.update({ channel: event.channel, ts: thinkingResult.ts as string, text: errMsg })
      } else {
        await say({ text: errMsg, thread_ts: event.ts })
      }
    }
  })
}
