import { describe, expect, test } from 'vitest'

describe('registerTools', () => {
  test('registers the expected incident-intelligence tools', async () => {
    const { tools } = await global.client.listTools()
    const names = tools.map(tool => tool.name)

    expect(names).toEqual(
      expect.arrayContaining([
        'get_recent_commits',
        'get_commit_diff',
        'correlate_incident',
        'analyze_commit_impact',
        'search_commits',
        'draft_postmortem',
        'post_pr_comment',
        'open_fix_pr',
        'get_related_commits',
        'get_change_timeline',
        'summarize_changes',
      ]),
    )
  })
})
