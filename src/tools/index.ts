import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { OptionsType } from '@/types'
import registerAnalyzeCommitImpact from './registerAnalyzeCommitImpact'
import registerCorrelateIncident from './registerCorrelateIncident'
import registerDraftPostmortem from './registerDraftPostmortem'
import registerGetChangeTimeline from './registerGetChangeTimeline'
import registerGetCommitDiff from './registerGetCommitDiff'
import registerGetRecentCommits from './registerGetRecentCommits'
import registerGetRelatedCommits from './registerGetRelatedCommits'
import registerOpenFixPr from './registerOpenFixPr'
import registerPostPrComment from './registerPostPrComment'
import registerSaveKnowledge from './registerSaveKnowledge'
import registerSearchCommits from './registerSearchCommits'
import registerSearchKnowledge from './registerSearchKnowledge'
import registerSummarizeChanges from './registerSummarizeChanges'

export const registerTools = (server: McpServer, options: OptionsType) => {
  registerGetRecentCommits(server, options)
  registerGetCommitDiff(server, options)
  registerCorrelateIncident(server, options)
  registerAnalyzeCommitImpact(server, options)
  registerSearchCommits(server, options)
  registerDraftPostmortem(server, options)
  registerPostPrComment(server, options)
  registerOpenFixPr(server, options)
  registerGetRelatedCommits(server, options)
  registerGetChangeTimeline(server, options)
  registerSummarizeChanges(server, options)
  registerSaveKnowledge(server, options)
  registerSearchKnowledge(server, options)
}
