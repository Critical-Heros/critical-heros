import { createHash } from 'node:crypto'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { Octokit } from '@octokit/rest'
import { z } from 'zod'
import type { OptionsType } from '@/types'

export interface OpenFixPrParams {
  owner: string
  repo: string
  files: Array<{ path: string; content: string }>
  branch_name?: string
  description?: string
  incident_id?: string
  base_branch?: string
}

export interface OpenFixPrResult {
  pr_number: number
  pr_url: string
  branch: string
  reused: boolean
}

// Core PR-opening logic, shared by the MCP `open_fix_pr` tool and the Slack incident
// approve handler so both go through exactly the same code path.
export async function openFixPr({
  owner,
  repo,
  files,
  branch_name,
  description,
  incident_id,
  base_branch = 'main',
}: OpenFixPrParams): Promise<OpenFixPrResult> {
  // Generate sensible defaults so callers never have to compute these.
  const incident = incident_id ?? 'N/A'
  const branch =
    branch_name ??
    `fix/auto-${createHash('sha1')
      .update(`${repo}:${description ?? incident}`)
      .digest('hex')
      .slice(0, 8)}`
  const prDescription = description ?? `인시던트 ${incident} 관련 자동 수정`

  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN })

  // 1. Get the latest SHA of the base branch
  const { data: baseBranchData } = await octokit.repos.getBranch({ owner, repo, branch: base_branch })
  const baseSha = baseBranchData.commit.sha

  // 2. Create the branch (reuse it if it already exists so repeated demo runs are safe)
  try {
    await octokit.git.getRef({ owner, repo, ref: `heads/${branch}` })
  } catch {
    await octokit.git.createRef({ owner, repo, ref: `refs/heads/${branch}`, sha: baseSha })
  }

  // 3. Commit the files (the branch needs a real diff before a PR can be opened)
  for (const file of files) {
    // Existing files need their current blob sha to update; new files have none.
    let sha: string | undefined
    try {
      const existing = await octokit.repos.getContent({ owner, repo, path: file.path, ref: branch })
      if (!Array.isArray(existing.data) && existing.data.type === 'file') {
        sha = existing.data.sha
      }
    } catch {
      // File doesn't exist yet - creating it.
    }

    await octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: file.path,
      branch,
      message: `[Critical Hero] fix: ${file.path}`,
      content: Buffer.from(file.content, 'utf8').toString('base64'),
      sha,
    })
  }

  // 4. Reuse an open PR for this branch if one exists, otherwise create it
  const { data: openPrs } = await octokit.pulls.list({ owner, repo, head: `${owner}:${branch}`, state: 'open' })
  if (openPrs.length > 0) {
    return { pr_number: openPrs[0].number, pr_url: openPrs[0].html_url, branch, reused: true }
  }

  const { data: pr } = await octokit.pulls.create({
    owner,
    repo,
    title: `[Critical Hero] Fix: ${incident} 인시던트 수정`,
    body: `## 🚨 Critical Hero 자동 생성 PR

### 관련 인시던트
인시던트 ID: \`${incident}\`

### 수정 내용
${prDescription}

### 주의사항
이 PR은 Critical Hero AI Agent가 자동 생성했습니다.
반드시 코드 리뷰 후 머지하세요.

---
*Critical Hero AI Agent가 자동 생성한 PR입니다.*`,
    head: branch,
    base: base_branch,
  })

  return { pr_number: pr.number, pr_url: pr.html_url, branch, reused: false }
}

export default function register(server: McpServer, _options: OptionsType) {
  server.registerTool(
    'open_fix_pr',
    {
      title: 'Open Fix PR',
      description: '장애 원인 수정을 위한 브랜치를 생성하고 PR을 자동으로 엽니다',
      inputSchema: {
        owner: z.string().describe('GitHub 레포 소유자'),
        repo: z.string().describe('레포지토리 이름'),
        files: z
          .array(z.object({ path: z.string(), content: z.string() }))
          .min(1)
          .describe('수정/추가할 파일들. content는 파일 전체 내용. read_repo_file로 읽어 수정한 결과를 넣으세요'),
        branch_name: z.string().optional().describe('생성할 브랜치 이름 (생략 시 자동 생성)'),
        description: z.string().optional().describe('PR 설명 (생략 시 분석 내용으로 채움)'),
        incident_id: z.string().optional().describe('관련 인시던트 ID (있으면)'),
        base_branch: z.string().default('main').describe('베이스 브랜치 (기본: main)'),
      },
    },
    // The tool is a thin wrapper around the shared openFixPr() so the agent and the Slack
    // approve handler stay in sync.
    async params => {
      const result = await openFixPr(params)
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                success: true,
                pr_number: result.pr_number,
                pr_url: result.pr_url,
                branch: result.branch,
                message: `PR #${result.pr_number}이 ${result.reused ? '업데이트' : '생성'}되었습니다.`,
              },
              null,
              2,
            ),
          },
        ],
      }
    },
  )
}
