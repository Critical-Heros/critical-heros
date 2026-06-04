import 'dotenv/config'
import { WebClient } from '@slack/web-api'
import { runAgent } from '@/agent/router'
import { ingestSlackMessage } from '@/slack/handlers/message'
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

// Reply to an @mention: run the agent and post the result in-thread.
async function handleMention(ev: SlackEvent): Promise<void> {
  const slack = getSlack()
  const channel = ev.channel as string
  const ts = ev.ts as string
  const query = (ev.text ?? '').replace(/<@[A-Z0-9]+>/g, '').trim()

  if (!query) {
    await slack.chat.postMessage({
      channel,
      thread_ts: ts,
      text: '무엇을 도와드릴까요? `@critical-hero <질문>` 형식으로 질문해주세요.',
    })
    return
  }

  const thinking = await slack.chat.postMessage({ channel, thread_ts: ts, text: '🔍 분석 중입니다...' })

  try {
    const repoId = process.env.DEFAULT_REPO_ID ?? 'default'
    const result = await runAgent(query, repoId, {})
    const formatted = toSlackMrkdwn(result.text)

    if (thinking.ts) {
      await slack.chat.update({ channel, ts: thinking.ts as string, text: formatted })
    } else {
      await slack.chat.postMessage({ channel, thread_ts: ts, text: formatted })
    }
  } catch (err) {
    console.error('[lambda/slack] mention handler error:', err)
    if (thinking.ts) {
      await slack.chat.update({ channel, ts: thinking.ts as string, text: '❌ 분석 중 오류가 발생했습니다.' })
    }
  }
}

export async function handler(event: LambdaFunctionUrlEvent): Promise<LambdaResponse> {
  // Slack retries an event when we don't ack within ~3s. The agent takes longer than that,
  // so we process the first delivery and ignore retries to avoid double-handling.
  if (event.headers?.['x-slack-retry-num']) return ok()

  const rawBody = readRawBody(event)

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
