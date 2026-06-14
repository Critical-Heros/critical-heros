import 'dotenv/config'
import { WebClient } from '@slack/web-api'
import { runAgent } from '@/agent/router'
import { approveKnowledge, denyKnowledge } from '@/indexer/knowledge'
import { ingestSlackMessage } from '@/slack/handlers/message'
import {
  approvedMessage,
  deniedMessage,
  type FixAction,
  failedMessage,
  openIncidentFixPr,
} from '@/slack/incident-fix-core'
import { toSlackMrkdwn } from '@/utils'

// Minimal AWS Lambda Function URL event/response shapes (avoids an @types/aws-lambda dependency).
interface LambdaFunctionUrlEvent {
  headers?: Record<string, string | undefined>
  body?: string | null
  isBase64Encoded?: boolean
}

interface LambdaResponse {
  statusCode: number
  headers?: Record<string, string>
  body: string
}

interface SlackEvent {
  type?: string
  text?: string
  channel?: string
  ts?: string
  thread_ts?: string
}

interface SlackEventBody {
  type?: string
  challenge?: string
  event?: SlackEvent & Record<string, unknown>
}

function readRawBody(event: LambdaFunctionUrlEvent): string {
  if (!event.body) return ''
  return event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body
}

function ok(body: Record<string, unknown> = { ok: true }): LambdaResponse {
  return { statusCode: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
}

let slackClient: WebClient | undefined
function getSlack(): WebClient {
  if (!slackClient) slackClient = new WebClient(process.env.SLACK_BOT_TOKEN)
  return slackClient
}

function stripMentions(text: string): string {
  return text.replace(/<@[A-Z0-9]+>/g, '').trim()
}

// Load prior messages in the thread so a follow-up @mention continues the conversation
// instead of starting fresh. Bot messages map to 'assistant', everyone else to 'user'.
async function fetchThreadHistory(
  slack: WebClient,
  channel: string,
  threadTs: string,
  currentTs: string,
): Promise<Array<{ role: 'user' | 'assistant'; text: string }>> {
  // A top-level mention (its own ts is the thread root) has nothing prior to load.
  if (threadTs === currentTs) return []

  try {
    const res = await slack.conversations.replies({ channel, ts: threadTs, limit: 50 })
    return (res.messages ?? [])
      .filter(m => m.ts !== currentTs && typeof m.text === 'string')
      .map(m => ({
        role: m.bot_id ? ('assistant' as const) : ('user' as const),
        text: stripMentions(m.text as string),
      }))
      .filter(m => m.text.length > 0)
  } catch (err) {
    console.error('[lambda/slack] failed to load thread history:', err)
    return []
  }
}

// Reply to an @mention: run the agent and post the result in-thread.
async function handleMention(ev: SlackEvent): Promise<void> {
  const slack = getSlack()
  const channel = ev.channel as string
  const ts = ev.ts as string
  // Reply into the existing thread when the mention is a reply; otherwise start one on the mention.
  const threadTs = ev.thread_ts ?? ts
  const query = stripMentions(ev.text ?? '')

  if (!query) {
    await slack.chat.postMessage({
      channel,
      thread_ts: threadTs,
      text: '무엇을 도와드릴까요? `@critical-hero <질문>` 형식으로 질문해주세요.',
    })
    return
  }

  // Fetch context before posting the placeholder so it isn't included in the history.
  const threadHistory = await fetchThreadHistory(slack, channel, threadTs, ts)

  const thinking = await slack.chat.postMessage({ channel, thread_ts: threadTs, text: '🔍 분석 중입니다...' })

  try {
    const repoId = process.env.DEFAULT_REPO_ID ?? 'default'
    const result = await runAgent(query, repoId, { threadHistory })
    const formatted = toSlackMrkdwn(result.text)

    if (thinking.ts) {
      await slack.chat.update({ channel, ts: thinking.ts as string, text: formatted })
    } else {
      await slack.chat.postMessage({ channel, thread_ts: threadTs, text: formatted })
    }
  } catch (err) {
    console.error('[lambda/slack] mention handler error:', err)
    if (thinking.ts) {
      await slack.chat.update({ channel, ts: thinking.ts as string, text: '❌ 분석 중 오류가 발생했습니다.' })
    }
  }
}

interface BlockActionsPayload {
  type?: string
  actions?: Array<{ action_id?: string; value?: string }>
  channel?: { id?: string }
  message?: { ts?: string }
  user?: { id?: string }
}

// Approve/Deny the auto-proposed incident fix. This is the production interactivity endpoint
// (the Bolt pod runs Socket Mode with no inbound port), so the fix buttons only work because the
// Lambda handles them here, reusing the same core the pod uses.
async function handleIncidentFix(payload: BlockActionsPayload, action: { action_id?: string; value?: string }) {
  const channel = payload.channel?.id
  const ts = payload.message?.ts
  const userId = payload.user?.id
  const value = JSON.parse(action.value ?? '{}') as FixAction

  if (action.action_id === 'deny_fix_pr') {
    if (channel && ts) await getSlack().chat.update({ channel, ts, ...deniedMessage(value, userId) })
    return ok()
  }

  // approve_fix_pr
  try {
    const { result, service } = await openIncidentFixPr(value)
    if (channel && ts) await getSlack().chat.update({ channel, ts, ...approvedMessage(value, result, service, userId) })
  } catch (err) {
    console.error('[lambda/slack] incident fix error:', err)
    if (channel && ts) await getSlack().chat.update({ channel, ts, ...failedMessage(value, (err as Error).message) })
  }
  return ok()
}

// Handle the Approve/Deny buttons posted by save_knowledge. On approve the pending recipe
// becomes searchable; on deny it's discarded. Either way we edit the message to show the result.
async function handleInteractivity(rawBody: string): Promise<LambdaResponse> {
  const payloadStr = new URLSearchParams(rawBody).get('payload')
  if (!payloadStr) return ok()

  let payload: BlockActionsPayload
  try {
    payload = JSON.parse(payloadStr)
  } catch {
    return {
      statusCode: 400,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ error: 'Invalid payload' }),
    }
  }

  if (payload.type !== 'block_actions') return ok()

  const action = payload.actions?.[0]
  if (!action?.value) return ok()

  // Incident fix buttons route through the shared core (opens the PR + edits the message).
  if (action.action_id === 'approve_fix_pr' || action.action_id === 'deny_fix_pr') {
    return handleIncidentFix(payload, action)
  }

  if (action.action_id !== 'approve_knowledge' && action.action_id !== 'deny_knowledge') {
    return ok()
  }

  let id: string
  let repoId: string
  try {
    const parsed = JSON.parse(action.value) as { id: string; repo_id: string }
    id = parsed.id
    repoId = parsed.repo_id
  } catch {
    return ok()
  }

  const approved = action.action_id === 'approve_knowledge'
  try {
    if (approved) await approveKnowledge(id, repoId)
    else await denyKnowledge(id, repoId)
  } catch (err) {
    console.error('[lambda/slack] knowledge action error:', err)
  }

  // Edit the original message to show the decision and drop the buttons.
  const channel = payload.channel?.id
  const ts = payload.message?.ts
  if (channel && ts) {
    await getSlack().chat.update({
      channel,
      ts,
      text: approved ? '이 정보를 저장했어요' : '이 정보는 저장하지 않을게요',
      blocks: [],
    })
  }

  return ok()
}

export async function handler(event: LambdaFunctionUrlEvent): Promise<LambdaResponse> {
  // Slack retries an event when we don't ack within ~3s. The agent takes longer than that,
  // so we process the first delivery and ignore retries to avoid double-handling.
  if (event.headers?.['x-slack-retry-num']) return ok()

  const rawBody = readRawBody(event)

  // Slack interactivity (button clicks) arrives form-encoded as `payload=<json>`, not JSON.
  const contentType = event.headers?.['content-type'] ?? event.headers?.['Content-Type'] ?? ''
  if (contentType.includes('application/x-www-form-urlencoded') || rawBody.startsWith('payload=')) {
    return handleInteractivity(rawBody)
  }

  let payload: SlackEventBody
  try {
    payload = rawBody ? JSON.parse(rawBody) : {}
  } catch {
    return {
      statusCode: 400,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ error: 'Invalid JSON' }),
    }
  }

  // Slack URL verification handshake (sent when registering the events endpoint).
  if (payload.type === 'url_verification') {
    return ok({ challenge: payload.challenge })
  }

  if (payload.type === 'event_callback' && payload.event) {
    const ev = payload.event
    if (ev.type === 'message') {
      await ingestSlackMessage(ev)
    } else if (ev.type === 'app_mention') {
      await handleMention(ev)
    }
  }

  return ok()
}
