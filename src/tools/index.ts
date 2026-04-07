import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { OptionsType } from '@/types'
import registerGetData from './registerGetData'
import registerGetRecentCommits from './registerGetRecentCommits'
import registerGetCommitDiff from './registerGetCommitDiff'
import registerCorrelateIncident from './registerCorrelateIncident'

export const registerTools = (server: McpServer, options: OptionsType) => {
  registerGetData(server, options)
  registerGetRecentCommits(server, options)
  registerGetCommitDiff(server, options)
  registerCorrelateIncident(server, options)
}
