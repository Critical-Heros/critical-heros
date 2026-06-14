import type { App, BlockAction, ButtonAction } from '@slack/bolt'
import {
  approvedMessage,
  deniedMessage,
  type FixAction,
  failedMessage,
  openIncidentFixPr,
} from '@/slack/incident-fix-core'

// Approve/deny buttons for the auto-proposed incident fix. The actual PR logic and message copy
// live in incident-fix-core so the slack-handler Lambda renders the exact same result.

export function registerIncidentFixHandler(app: App): void {
  // Approve -> open the fix PR through the shared core, then edit the message.
  app.action<BlockAction<ButtonAction>>('approve_fix_pr', async ({ ack, body, client, action }) => {
    await ack()
    const value = JSON.parse(action.value ?? '{}') as FixAction
    const channel = body.channel?.id
    const ts = body.message?.ts
    const approver = body.user?.id
    if (!channel || !ts) return

    try {
      const { result, service } = await openIncidentFixPr(value)
      const msg = approvedMessage(value, result, service, approver)
      await client.chat.update({ channel, ts, ...msg })
    } catch (err) {
      const msg = failedMessage(value, (err as Error).message)
      await client.chat.update({ channel, ts, ...msg })
    }
  })

  // Deny -> just record the decision on the message.
  app.action<BlockAction<ButtonAction>>('deny_fix_pr', async ({ ack, body, client, action }) => {
    await ack()
    const value = JSON.parse(action.value ?? '{}') as FixAction
    const channel = body.channel?.id
    const ts = body.message?.ts
    const decider = body.user?.id
    if (!channel || !ts) return
    await client.chat.update({ channel, ts, ...deniedMessage(value, decider) })
  })
}
