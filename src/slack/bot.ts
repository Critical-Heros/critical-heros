import { App } from '@slack/bolt'
import { TARGET_ENVIRONMENT } from '@/constants'
import { registerIncidentFixHandler } from './handlers/incident-fix'
import { registerMentionHandler } from './handlers/mention'
import { registerMessageHandler } from './handlers/message'
import { registerSlashCommandHandler } from './handlers/slash-command'

const isSocketMode = process.env.SLACK_SOCKET_MODE === 'true'

export function createSlackApp(): App {
  if (!process.env.SLACK_BOT_TOKEN) throw new Error('SLACK_BOT_TOKEN 환경변수가 필요합니다')
  if (!process.env.SLACK_SIGNING_SECRET) throw new Error('SLACK_SIGNING_SECRET 환경변수가 필요합니다')
  if (isSocketMode && !process.env.SLACK_APP_TOKEN)
    throw new Error('Socket Mode 사용 시 SLACK_APP_TOKEN 환경변수가 필요합니다')

  const app = new App({
    token: process.env.SLACK_BOT_TOKEN,
    signingSecret: process.env.SLACK_SIGNING_SECRET,
    socketMode: isSocketMode,
    appToken: isSocketMode ? process.env.SLACK_APP_TOKEN : undefined,
    processBeforeResponse: true,
  })

  registerMentionHandler(app)
  registerSlashCommandHandler(app)
  // Incident approve/deny buttons -> open the fix PR (works in Socket Mode + HTTP).
  registerIncidentFixHandler(app)
  // In develop the bot ingests messages; in production the slack-handler lambda owns ingestion.
  if (TARGET_ENVIRONMENT !== 'production') {
    registerMessageHandler(app)
  }

  return app
}
