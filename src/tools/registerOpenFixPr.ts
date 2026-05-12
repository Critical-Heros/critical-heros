import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { Octokit } from '@octokit/rest'
import type { OptionsType } from '@/types'

export default function register(server: McpServer, _options: OptionsType) {
  server.registerTool(
    'open_fix_pr',
    {
      title: 'Open Fix PR',
      description: '장애 원인 수정을 위한 브랜치를 생성하고 PR을 자동으로 엽니다',
      inputSchema: {
        owner: z.string().describe('GitHub 레포 소유자'),
        repo: z.string().describe('레포지토리 이름'),
        branch_name: z.string().describe('생성할 브랜치 이름'),
        description: z.string().describe('PR 설명'),
        incident_id: z.string().describe('관련 인시던트 ID'),
        base_branch: z.string().default('main').describe('베이스 브랜치 (기본: main)'),
      },
    },
    async ({ owner, repo, branch_name, description, incident_id, base_branch }) => {
      const octokit = new Octokit({
        auth: process.env.GITHUB_TOKEN,
      })

      // 1. 베이스 브랜치의 최신 SHA 가져오기
      const { data: baseBranchData } = await octokit.repos.getBranch({
        owner,
        repo,
        branch: base_branch,
      })

      const baseSha = baseBranchData.commit.sha

      // 2. 새 브랜치 생성
      await octokit.git.createRef({
        owner,
        repo,
        ref: `refs/heads/${branch_name}`,
        sha: baseSha,
      })

      // 3. PR 생성
      const { data: pr } = await octokit.pulls.create({
        owner,
        repo,
        title: `[Critical Hero] Fix: ${incident_id} 인시던트 수정`,
        body: `## 🚨 Critical Hero 자동 생성 PR

### 관련 인시던트
인시던트 ID: \`${incident_id}\`

### 수정 내용
${description}

### 주의사항
이 PR은 Critical Hero AI Agent가 자동 생성했습니다.
반드시 코드 리뷰 후 머지하세요.

---
*Critical Hero AI Agent가 자동 생성한 PR입니다.*`,
        head: branch_name,
        base: base_branch,
      })

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                success: true,
                pr_number: pr.number,
                pr_url: pr.html_url,
                branch: branch_name,
                message: `PR #${pr.number}이 생성되었습니다.`,
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
