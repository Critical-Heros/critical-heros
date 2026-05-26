import { WebClient } from '@slack/web-api'
import { runAgent } from './router'
import 'dotenv/config'

// Prometheus Alertmanager webhook payload 타입
export interface PrometheusAlert {
  status: 'firing' | 'resolved'
  labels: Record<string, string>
  annotations: Record<string, string>
  startsAt: string
  endsAt: string
  generatorURL: string
}

export interface AlertmanagerPayload {
  version: string
  groupKey: string
  status: 'firing' | 'resolved'
  receiver: string
  groupLabels: Record<string, string>
  commonLabels: Record<string, string>
  commonAnnotations: Record<string, string>
  externalURL: string
  alerts: PrometheusAlert[]
}

const slackClient = new WebClient(process.env.SLACK_BOT_TOKEN)

export async function triggerIncidentAlert(payload: AlertmanagerPayload): Promise<void> {
  // firing 상태 알람만 처리 (resolved는 무시)
  const firingAlerts = payload.alerts.filter(a => a.status === 'firing')
  if (firingAlerts.length === 0) return

  const alert = firingAlerts[0]
  const service = alert.labels.service ?? payload.commonLabels.service ?? 'unknown'
  const alertName = alert.labels.alertname ?? payload.commonLabels.alertname ?? 'Unknown Alert'
  const description = alert.annotations.description ?? alert.annotations.summary ?? alertName
  const incidentTime = alert.startsAt
  const severity = alert.labels.severity ?? payload.commonLabels.severity ?? 'unknown'

  const repoId = process.env.DEFAULT_REPO_ID ?? 'default'
  const channel = process.env.SLACK_CRITICAL_CHANNEL ?? '#critical'

  // 인시던트 시작 알림 먼저 포스팅
  const initialPost = await slackClient.chat.postMessage({
    channel,
    text: [
      `🚨 *인시던트 감지*`,
      `*서비스:* ${service}`,
      `*알람:* ${alertName}  |  *심각도:* ${severity}`,
      `*설명:* ${description}`,
      `*발생 시각:* ${incidentTime}`,
      '',
      `🔍 원인 커밋 분석 중...`,
    ].join('\n'),
  })

  try {
    const result = await runAgent(
      `인시던트 발생. 서비스: ${service}, 알람: ${alertName}, 에러: ${description}. 원인 커밋을 찾아 분석해줘.`,
      repoId,
      { incidentTime },
    )

    // 분석 결과를 스레드로 포스팅
    await slackClient.chat.postMessage({
      channel,
      thread_ts: initialPost.ts,
      text: result.text,
    })
  } catch (error) {
    console.error('[triggerIncidentAlert] 에이전트 분석 실패:', error)
    await slackClient.chat.postMessage({
      channel,
      thread_ts: initialPost.ts,
      text: `❌ 자동 분석에 실패했습니다. 수동으로 확인해주세요.\n\`/hero incident ${description}\``,
    })
  }
}
