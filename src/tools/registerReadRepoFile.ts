import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Octokit } from '@octokit/rest'
import { z } from 'zod'
import type { OptionsType } from '@/types'

// Cap file content so a large file doesn't blow the agent's context window.
const MAX_FILE_CHARS = 12000

export default function register(server: McpServer, _options: OptionsType) {
  server.registerTool(
    'read_repo_file',
    {
      title: 'Read Repo File',
      description:
        'GitHub 레포의 파일 내용을 읽습니다. 디렉터리 경로를 주면 하위 항목 목록을 반환합니다. ' +
        '수정할 코드를 직접 찾아 읽을 때 사용하세요 (사용자에게 파일 위치를 묻지 마세요).',
      inputSchema: {
        owner: z.string().describe('GitHub owner'),
        repo: z.string().describe('레포 이름'),
        path: z.string().describe('파일 또는 디렉터리 경로 (예: src/webhooks/github.ts)'),
        ref: z.string().optional().describe('브랜치/태그/커밋 (생략 시 기본 브랜치)'),
      },
    },
    async ({ owner, repo, path, ref }) => {
      const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN })

      try {
        const { data } = await octokit.repos.getContent({ owner, repo, path, ref })

        // Directory: return the listing so the agent can navigate.
        if (Array.isArray(data)) {
          const entries = data.map(d => ({ type: d.type, path: d.path }))
          return { content: [{ type: 'text' as const, text: JSON.stringify({ path, entries }, null, 2) }] }
        }

        if (data.type !== 'file' || typeof data.content !== 'string') {
          return {
            content: [{ type: 'text' as const, text: `'${path}'는 읽을 수 있는 파일이 아닙니다 (${data.type}).` }],
          }
        }

        const content = Buffer.from(data.content, 'base64').toString('utf8')
        const capped = content.length > MAX_FILE_CHARS ? `${content.slice(0, MAX_FILE_CHARS)}\n...(truncated)` : content
        return { content: [{ type: 'text' as const, text: capped }] }
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `파일 조회 실패 (${path}): ${(err as Error).message}` }] }
      }
    },
  )
}
