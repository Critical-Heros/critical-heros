import 'dotenv/config'

const NOTION_API_URL = 'https://api.notion.com/v1'
const NOTION_VERSION = '2022-06-28'

type RichText = {
  type: 'text'
  text: { content: string }
}

type Block =
  | { object: 'block'; type: 'heading_2'; heading_2: { rich_text: RichText[] } }
  | { object: 'block'; type: 'paragraph'; paragraph: { rich_text: RichText[] } }
  | { object: 'block'; type: 'divider'; divider: Record<string, never> }

function heading2(text: string): Block {
  return {
    object: 'block',
    type: 'heading_2',
    heading_2: { rich_text: [{ type: 'text', text: { content: text } }] },
  }
}

function paragraph(text: string): Block {
  return {
    object: 'block',
    type: 'paragraph',
    paragraph: { rich_text: [{ type: 'text', text: { content: text || '(미작성)' } }] },
  }
}

function divider(): Block {
  return { object: 'block', type: 'divider', divider: {} }
}

export interface PostmortemDraft {
  title: string
  incident_id: string
  date: string
  status: string
  sections: {
    summary: string
    timeline: string
    root_cause: string
    impact: string
    action_items: string
  }
}

export async function createNotionPostmortemPage(draft: PostmortemDraft): Promise<string> {
  const token = process.env.NOTION_TOKEN
  const databaseId = process.env.NOTION_DATABASE_ID

  if (!token || !databaseId) {
    throw new Error('NOTION_TOKEN 또는 NOTION_DATABASE_ID 환경변수가 설정되지 않았습니다')
  }

  const children: Block[] = [
    heading2('📋 요약 (Summary)'),
    paragraph(draft.sections.summary),
    divider(),
    heading2('⏱ 타임라인 (Timeline)'),
    paragraph(draft.sections.timeline || '(데이터 없음)'),
    divider(),
    heading2('🔍 근본 원인 (Root Cause)'),
    paragraph(draft.sections.root_cause),
    divider(),
    heading2('💥 영향 범위 (Impact)'),
    paragraph(draft.sections.impact),
    divider(),
    heading2('✅ 재발 방지 대책 (Action Items)'),
    paragraph(draft.sections.action_items),
  ]

  const body = {
    parent: { page_id: databaseId },
    properties: {
      title: {
        title: [{ type: 'text', text: { content: draft.title } }],
      },
    },
    children,
  }

  const res = await fetch(`${NOTION_API_URL}/pages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Notion-Version': NOTION_VERSION,
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Notion API 오류: ${res.status} ${err}`)
  }

  const page = (await res.json()) as { url: string }
  return page.url
}
