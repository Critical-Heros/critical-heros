import 'dotenv/config'
import { createSlackApp } from './bot'

export async function startSlackServer(): Promise<void> {
  const port = Number(process.env.SLACK_PORT ?? 3002)
  const app = createSlackApp()

  await app.start(port)

  console.log(`⚡️ Slack 봇 HTTP 서버 시작됨 (포트: ${port})`)
  console.log(`   Events URL : http://localhost:${port}/slack/events`)
  console.log(`   Slash CMD  : http://localhost:${port}/slack/events`)
  console.log(`   로컬 개발 시 ngrok으로 퍼블릭 URL을 발급받아 Slack 앱 설정에 등록하세요.`)
}
