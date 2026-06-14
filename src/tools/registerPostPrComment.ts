import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { Octokit } from '@octokit/rest'
import type { OptionsType } from '@/types'

const COMMENT_MARKER = '<!-- critical-hero-blast-radius -->'

export default function register(server: McpServer, _options: OptionsType) {
  server.registerTool(
    'post_pr_comment',
    {
      title: 'Post PR Comment',
      description: 'PR에 Blast Radius 분석 결과를 코멘트로 자동 작성합니다',
      inputSchema: {
        owner: z.string().describe('GitHub 레포 소유자'),
        repo: z.string().describe('레포지토리 이름'),
        pr_number: z.number().describe('PR 번호'),
        sha: z.string().describe('분석할 커밋 SHA'),
        risk_score: z.string().describe('위험도 점수 (LOW/MEDIUM/HIGH)'),
        impacted_files: z.array(z.string()).describe('영향받는 파일 목록'),
        summary: z.string().describe('분석 요약'),
      },
    },
    async ({ owner, repo, pr_number, sha, risk_score, impacted_files, summary }) => {
      const octokit = new Octokit({
        auth: process.env.GITHUB_TOKEN,
      })

      const riskEmoji = risk_score === 'HIGH' ? '🔴' : risk_score === 'MEDIUM' ? '🟡' : '🟢'

      const body = `${COMMENT_MARKER}
## 🤖 Critical Hero - Blast Radius 분석 결과

${riskEmoji} **위험도: ${risk_score}**

### 분석 대상 커밋
\`${sha.slice(0, 7)}\`

### 요약
${summary}

### 영향받는 파일 (${impacted_files.length}개)
${impacted_files.map(f => `- \`${f}\``).join('\n')}

---
*Critical Hero AI Agent가 자동 생성한 분석입니다.*`

      // 기존 Critical Hero 코멘트가 있으면 덮어쓰고, 없으면 새로 작성
      const existingComments = await octokit.issues.listComments({
        owner,
        repo,
        issue_number: pr_number,
      })

      const existing = existingComments.data.find(c => c.body?.includes(COMMENT_MARKER))

      if (existing) {
        await octokit.issues.updateComment({
          owner,
          repo,
          comment_id: existing.id,
          body,
        })
      } else {
        await octokit.issues.createComment({
          owner,
          repo,
          issue_number: pr_number,
          body,
        })
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                success: true,
                message: `PR #${pr_number}에 Blast Radius 분석 코멘트를 작성했습니다.`,
                risk_score,
                impacted_files_count: impacted_files.length,
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
