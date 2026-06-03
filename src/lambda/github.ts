import 'dotenv/config'
import { processGithubEvent } from '@/webhooks/github'

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

function readRawBody(event: LambdaFunctionUrlEvent): string {
  if (!event.body) return ''
  return event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body
}

export async function handler(event: LambdaFunctionUrlEvent): Promise<LambdaResponse> {
  const rawBody = readRawBody(event)
  const headers = event.headers ?? {}

  let body
  try {
    body = rawBody ? JSON.parse(rawBody) : {}
  } catch {
    return {
      statusCode: 400,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ error: 'Invalid JSON' }),
    }
  }

  // Function URL delivers header names in lowercase.
  const result = await processGithubEvent({
    event: headers['x-github-event'] ?? '',
    signature: headers['x-hub-signature-256'],
    rawBody,
    body,
  })

  return {
    statusCode: result.status,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(result.body),
  }
}
