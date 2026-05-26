import { App } from '@slack/bolt'
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
  registerMessageHandler(app)

  return app
}
