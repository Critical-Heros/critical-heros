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
    text: `🚨 Incident detected: ${alertName} on ${service}`,
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: '🚨 Incident detected', emoji: true } },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Service:*\n${service}` },
          { type: 'mrkdwn', text: `*Alert:*\n${alertName}` },
          { type: 'mrkdwn', text: `*Severity:*\n${severity}` },
          { type: 'mrkdwn', text: `*Started:*\n${incidentTime}` },
        ],
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Details:* ${description}\n\nCritical Hero prepared a fix: add a HorizontalPodAutoscaler so \`${service}\` scales out under load instead of saturating a single replica. Approve to open the PR.`,
        },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: '✅ Approve & open fix PR', emoji: true },
            style: 'primary',
            action_id: 'approve_fix_pr',
            value: actionValue,
          },
          {
            type: 'button',
            text: { type: 'plain_text', text: '✖ Deny', emoji: true },
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
