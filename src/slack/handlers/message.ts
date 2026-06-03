import type { App } from '@slack/bolt'
import { clickhouse } from '@/db/clickhouse'

// 인시던트 관련 채널 목록 (쉼표 구분)
const getIncidentChannels = (): Set<string> =>
  new Set((process.env.SLACK_INCIDENT_CHANNELS ?? '').split(',').filter(Boolean))

// Core slack message ingestion, independent of the Bolt app (reused by the lambda handler).
export async function ingestSlackMessage(msg: Record<string, unknown>): Promise<void> {
  // 봇 메시지, 시스템 메시지 제외
  if (msg.bot_id || msg.subtype) return

  const incidentChannels = getIncidentChannels()

  // 인시던트 채널만 수집 (채널 설정 없으면 전체 수집)
  if (incidentChannels.size > 0 && !incidentChannels.has(msg.channel as string)) return

  try {
    const postedAt = new Date(parseFloat(msg.ts as string) * 1000).toISOString().replace('T', ' ').slice(0, 19)

    await clickhouse.insert({
      table: 'slack_threads',
      values: [
        {
          thread_ts: (msg.thread_ts ?? msg.ts) as string,
          channel_id: (msg.channel ?? '') as string,
          user_id: (msg.user ?? 'unknown') as string,
          message: (msg.text ?? '') as string,
          incident_id: null,
          posted_at: postedAt,
        },
      ],
      format: 'JSONEachRow',
    })
  } catch (err) {
    console.error('[Slack] 메시지 인제스트 실패:', err)
  }
}

export function registerMessageHandler(app: App): void {
  // 채널 메시지 수신 및 ClickHouse에 인제스트
  app.message(async ({ message }) => {
    await ingestSlackMessage(message as unknown as Record<string, unknown>)
  })
}
