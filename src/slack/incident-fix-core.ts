import { type OpenFixPrResult, openFixPr } from '@/tools/registerOpenFixPr'

// The incident proposed fix is always "let the saturated service scale out under load", so the
// fix is a HorizontalPodAutoscaler. Keeping it deterministic means the Slack button only carries
// the incident id + repo, and the PR is opened through the same openFixPr() the agent uses.
//
// Shared by the Bolt incident-fix handler (Socket Mode pod) AND the slack-handler Lambda so the
// approve/deny buttons behave identically on whichever path Slack routes the interaction to.

const FIX_PATH = 'infra/helm/critical-hero/charts/mcp-server/templates/hpa.yaml'
const FIX_BRANCH = process.env.INCIDENT_FIX_BRANCH ?? 'demo/cpu-incident-autofix'

export interface FixAction {
  incident_id: string
  repo: string
  alertname?: string
  service?: string
}

// Slack message payload (text fallback + blocks) for a chat.update call.
interface SlackMessage {
  text: string
  // Loosely typed so this stays shared between Bolt's client and the Lambda's WebClient.
  blocks: Array<Record<string, unknown>>
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

// Open (or reuse) the fix PR for an approved incident. Side effects land on GitHub only;
// the caller owns the Slack message update.
export async function openIncidentFixPr(value: FixAction): Promise<{ result: OpenFixPrResult; service: string }> {
  const service = value.service ?? 'mcp-server'
  const [owner, repo] = value.repo.split('/')
  const result = await openFixPr({
    owner,
    repo,
    files: [{ path: FIX_PATH, content: hpaYaml(value.incident_id, service) }],
    branch_name: FIX_BRANCH,
    incident_id: value.incident_id,
    description: `트래픽이 몰릴 때 ${service}가 자동으로 늘어나도록 오토스케일러(HPA)를 추가합니다.`,
  })
  return { result, service }
}

// --- Slack message builders (shared so both paths render the same result) ----------------

export function approvedMessage(
  value: FixAction,
  result: OpenFixPrResult,
  service: string,
  approver?: string,
): SlackMessage {
  const verb = result.reused ? '업데이트했어요' : '만들었어요'
  return {
    text: `✅ 수정 PR을 ${verb}: ${result.pr_url}`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `✅ *수정 PR을 ${verb}* — 인시던트 \`${value.incident_id}\`\n<${result.pr_url}|#${result.pr_number} — 트래픽 몰릴 때 ${service} 자동 확장>${approver ? `\n승인: <@${approver}>` : ''}`,
        },
      },
      {
        type: 'actions',
        elements: [
          {
            type: 'button',
            text: { type: 'plain_text', text: '🔧 PR 보기' },
            url: result.pr_url,
            style: 'primary',
          },
        ],
      },
    ],
  }
}

export function deniedMessage(value: FixAction, decider?: string): SlackMessage {
  return {
    text: `✖ 인시던트 ${value.incident_id} 수정을 안 하기로 했어요`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `✖ *수정 안 함* — 인시던트 \`${value.incident_id}\`. PR을 만들지 않았어요.${decider ? `\n거부: <@${decider}>` : ''}`,
        },
      },
    ],
  }
}

export function failedMessage(value: FixAction, error: string): SlackMessage {
  return {
    text: `❌ 수정 PR을 만들지 못했어요: ${error}`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `❌ *수정 PR을 만들지 못했어요* — 인시던트 \`${value.incident_id}\`\n\`\`\`${error}\`\`\``,
        },
      },
    ],
  }
}
