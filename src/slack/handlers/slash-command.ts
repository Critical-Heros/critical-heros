import type { App } from '@slack/bolt'
import { runAgent } from '@/agent/router'

export function registerSlashCommandHandler(app: App): void {
  app.command('/hero', async ({ command, ack, respond }) => {
    // Slack은 3초 이내 응답 요구 → 즉시 ack
    await ack()

    const parts = command.text.trim().split(/\s+/)
    const subcommand = parts[0] ?? ''
    const args = parts.slice(1).join(' ')
    const repoId = process.env.DEFAULT_REPO_ID ?? 'default'

    switch (subcommand) {
      case 'incident': {
        await respond({ text: '🚨 인시던트 분석을 시작합니다...', response_type: 'in_channel' })

        const description = args || '최근 프로덕션 이슈'
        try {
          const result = await runAgent(
            `인시던트 발생: ${description}. 최근 커밋 중 원인 후보를 찾아 분석해줘.`,
            repoId,
            { incidentTime: new Date().toISOString() },
          )
          await respond({ text: result.text, response_type: 'in_channel' })
        } catch (error) {
          console.error('[Slack] /hero incident error:', error)
          await respond({
            text: '❌ 분석 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
            response_type: 'in_channel',
          })
        }
        break
      }

      case 'query': {
        if (!args) {
          await respond({ text: '사용법: `/hero query <검색어>`\n예) `/hero query cache layer`' })
          return
        }
        await respond({ text: `🔍 \`${args}\` 검색 중...`, response_type: 'in_channel' })
        try {
          const result = await runAgent(args, repoId)
          await respond({ text: result.text, response_type: 'in_channel' })
        } catch (error) {
          console.error('[Slack] /hero query error:', error)
          await respond({
            text: '❌ 검색 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
            response_type: 'in_channel',
          })
        }
        break
      }

      default: {
        await respond({
          text: [
            '*Critical Hero 사용 가능한 명령어:*',
            '• `/hero incident [설명]` — 인시던트 분석 트리거 (F1)',
            '• `/hero query <검색어>` — 커밋 히스토리 자연어 검색 (F3)',
            '',
            '멘션으로도 사용 가능: `@critical-hero <질문>`',
          ].join('\n'),
        })
      }
    }
  })
}
