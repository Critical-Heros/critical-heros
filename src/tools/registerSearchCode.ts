import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Octokit } from '@octokit/rest'
import { z } from 'zod'
import type { OptionsType } from '@/types'

export default function register(server: McpServer, _options: OptionsType) {
  server.registerTool(
    'search_code',
    {
      title: 'Search Code',
      description:
        'GitHub 코드 검색으로 레포 안에서 수정할 만한 파일을 찾습니다. ' +
        '파일 위치를 모를 때 사용자에게 묻지 말고 이 도구로 직접 찾으세요.',
      inputSchema: {
        owner: z.string().describe('GitHub owner'),
        repo: z.string().describe('레포 이름'),
        query: z.string().describe('검색어 (함수명, 핸들러명, 에러 문자열 등)'),
        limit: z.number().default(10).describe('반환할 결과 수'),
      },
    },
    async ({ owner, repo, query, limit }) => {
      const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN })

      try {
        const { data } = await octokit.search.code({
          q: `${query} repo:${owner}/${repo}`,
          per_page: limit,
        })

        const results = data.items.map(i => ({ path: i.path, name: i.name }))

        if (results.length === 0) {
          return { content: [{ type: 'text' as const, text: `'${query}'에 해당하는 파일을 찾지 못했습니다.` }] }
        }

        return {
          content: [
            { type: 'text' as const, text: JSON.stringify({ query, total: data.total_count, results }, null, 2) },
          ],
        }
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `코드 검색 실패: ${(err as Error).message}` }] }
      }
    },
  )
}
