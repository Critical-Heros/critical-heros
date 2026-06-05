import type { App, BlockAction, ButtonAction } from '@slack/bolt'
import { openFixPr } from '@/tools/registerOpenFixPr'

// The incident proposed fix is always "let mcp-server scale out under load", so the fix is
// a HorizontalPodAutoscaler. Keeping it deterministic means the Slack button only carries
// the incident id + repo, and the PR is opened through the same openFixPr() the agent uses.

const FIX_PATH = 'infra/helm/critical-hero/charts/mcp-server/templates/hpa.yaml'
const FIX_BRANCH = process.env.INCIDENT_FIX_BRANCH ?? 'demo/cpu-incident-autofix'

interface FixAction {
  incident_id: string
  repo: string
  alertname?: string
  service?: string
}

function hpaYaml(incidentId: string, service: string): string {
  return `apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: ${service}
  labels:
    app: ${service}
  annotations:
    # Auto-proposed remediation for incident ${incidentId}.
    # A traffic surge saturated a single ${service} replica; scaling out on CPU keeps
    # latency flat under load spikes.
    critical-hero.io/incident: "${incidentId}"
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: ${service}
  minReplicas: 2
  maxReplicas: 6
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
`
}

export function registerIncidentFixHandler(app: App): void {
  // Approve -> open the fix PR through the shared openFixPr(), then edit the message.
  app.action<BlockAction<ButtonAction>>('approve_fix_pr', async ({ ack, body, client, action }) => {
    await ack()
    const value = JSON.parse(action.value ?? '{}') as FixAction
    const service = value.service ?? 'mcp-server'
    const [owner, repo] = value.repo.split('/')
    const channel = body.channel?.id
    const ts = body.message?.ts
    const approver = body.user?.id

    try {
      const result = await openFixPr({
        owner,
        repo,
        files: [{ path: FIX_PATH, content: hpaYaml(value.incident_id, service) }],
        branch_name: FIX_BRANCH,
        incident_id: value.incident_id,
        description: `Add a HorizontalPodAutoscaler so ${service} scales out under load instead of saturating a single replica.`,
      })
      if (channel && ts) {
        await client.chat.update({
          channel,
          ts,
          text: `✅ Fix PR ${result.reused ? 'updated' : 'opened'}: ${result.pr_url}`,
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `✅ *Fix PR ${result.reused ? 'updated' : 'opened'}* for incident \`${value.incident_id}\`\n<${result.pr_url}|#${result.pr_number} — scale ${service} under load>${approver ? `\nApproved by <@${approver}>` : ''}`,
              },
            },
            {
              type: 'actions',
              elements: [
                {
                  type: 'button',
                  text: { type: 'plain_text', text: '🔧 Review PR' },
                  url: result.pr_url,
                  style: 'primary',
                },
              ],
            },
          ],
        })
      }
    } catch (err) {
      if (channel && ts) {
        await client.chat.update({ channel, ts, text: `❌ Failed to open fix PR: ${(err as Error).message}` })
      }
    }
  })

  // Deny -> just record the decision on the message.
  app.action<BlockAction<ButtonAction>>('deny_fix_pr', async ({ ack, body, client, action }) => {
    await ack()
    const value = JSON.parse(action.value ?? '{}') as FixAction
    const channel = body.channel?.id
    const ts = body.message?.ts
    const decider = body.user?.id
    if (channel && ts) {
      await client.chat.update({
        channel,
        ts,
        text: `✖ Fix denied for incident ${value.incident_id}`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `✖ *Fix denied* for incident \`${value.incident_id}\`. No PR opened.${decider ? `\nDenied by <@${decider}>` : ''}`,
            },
          },
        ],
      })
    }
  })
}
