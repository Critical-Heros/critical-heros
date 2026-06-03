import 'dotenv/config'
import { ingestSlackMessage } from '@/slack/handlers/message'

// Minimal AWS Lambda Function URL event/response shapes (avoids an @types/aws-lambda dependency).
interface LambdaFunctionUrlEvent {
  body?: string | null
  isBase64Encoded?: boolean
}

interface LambdaResponse {
  statusCode: number
  headers?: Record<string, string>
  body: string
}

interface SlackEventBody {
  type?: string
  challenge?: string
  event?: { type?: string } & Record<string, unknown>
}

function readRawBody(event: LambdaFunctionUrlEvent): string {
  if (!event.body) return ''
  return event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body
}

export async function handler(event: LambdaFunctionUrlEvent): Promise<LambdaResponse> {
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
    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ challenge: payload.challenge }),
    }
  }

  if (payload.type === 'event_callback' && payload.event?.type === 'message') {
    await ingestSlackMessage(payload.event)
  }

  return { statusCode: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ok: true }) }
}
