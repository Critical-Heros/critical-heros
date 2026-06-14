import { WebClient } from '@slack/web-api'
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

// Repo the proposed fix PR is opened against. Carried in the button value so the approve
// handler (running in the Slack pod) knows where to open it.
const INCIDENT_FIX_REPO = process.env.INCIDENT_FIX_REPO ?? 'Critical-Heros/critical-heros'

export async function triggerIncidentAlert(payload: AlertmanagerPayload, incidentId?: string): Promise<void> {
  // Only react to firing alerts (ignore resolved).
  const firingAlerts = payload.alerts.filter(a => a.status === 'firing')
  if (firingAlerts.length === 0) return

  const alert = firingAlerts[0]
  const service = alert.labels.service ?? payload.commonLabels.service ?? 'unknown'
  const alertName = alert.labels.alertname ?? payload.commonLabels.alertname ?? 'Unknown Alert'
  const description = alert.annotations.description ?? alert.annotations.summary ?? alertName
  const incidentTime = alert.startsAt
  const severity = alert.labels.severity ?? payload.commonLabels.severity ?? 'unknown'
  const grafanaUrl = alert.generatorURL || payload.externalURL || ''

  const incident = incidentId ?? alertName
  const channel = process.env.SLACK_CRITICAL_CHANNEL ?? '#critical'

  // Keep the button value small (Slack caps it ~2000 chars): only identifiers, no file content.
  const actionValue = JSON.stringify({ incident_id: incident, repo: INCIDENT_FIX_REPO, alertname: alertName, service })

  // Post the incident with an approve-to-fix button. Approving opens the PR via openFixPr().
  await slackClient.chat.postMessage({
    channel,
    text: `🚨 인시던트 감지: ${alertName} (${service})`,
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: '🚨 인시던트 감지', emoji: true } },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*서비스:*\n${service}` },
          { type: 'mrkdwn', text: `*알림:*\n${alertName}` },
          { type: 'mrkdwn', text: `*심각도:*\n${severity}` },
          { type: 'mrkdwn', text: `*시작 시각:*\n${incidentTime}` },
        ],
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*상세:* ${description}\n\nCritical Hero가 해결 방법을 준비했어요: 트래픽이 몰릴 때 \`${service}\`가 자동으로 늘어나도록 오토스케일러(HPA)를 추가합니다. 승인하면 PR을 만들어요.`,
        },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: '✅ 승인하고 PR 만들기', emoji: true },
            style: 'primary',
            action_id: 'approve_fix_pr',
            value: actionValue,
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: '✖ 거부', emoji: true },
            style: 'danger',
            action_id: 'deny_fix_pr',
            value: actionValue,
          },
          ...(grafanaUrl
            ? [
                {
                  type: 'button' as const,
                  text: { type: 'plain_text' as const, text: '📊 Grafana', emoji: true },
                  url: grafanaUrl,
                },
              ]
            : []),
        ],
      },
    ],
  })
}
