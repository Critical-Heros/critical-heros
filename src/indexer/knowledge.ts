import { createHash } from 'node:crypto'
import { clickhouse } from '@/db/clickhouse'
import { generateEmbedding } from './embedder'

// Deterministic id from repo + title so re-saving the same recipe updates it in place
// (ReplacingMergeTree collapses on the ORDER BY key) instead of duplicating.
export function knowledgeId(repoId: string, title: string): string {
  return createHash('sha1').update(`${repoId}:${title.trim().toLowerCase()}`).digest('hex')
}

export interface PendingKnowledge {
  repoId: string
  title: string
  content: string
  tags: string[]
}

// Embed and store the recipe as pending. It stays invisible to search_knowledge
// until the user approves it via Slack. Returns the row id.
export async function savePendingKnowledge(k: PendingKnowledge): Promise<string> {
  const id = knowledgeId(k.repoId, k.title)
  const embedding = await generateEmbedding(`${k.title}\n\n${k.content}`)

  await clickhouse.insert({
    table: 'knowledge',
    // Omit created_at/updated_at so the now() defaults apply; the newest write wins.
    values: [{ id, repo_id: k.repoId, title: k.title, content: k.content, tags: k.tags, embedding, status: 'pending' }],
    format: 'JSONEachRow',
  })

  return id
}

// Approve a pending recipe so search_knowledge can return it.
export async function approveKnowledge(id: string, repoId: string): Promise<void> {
  await clickhouse.exec({
    query: `
      ALTER TABLE knowledge
      UPDATE status = 'approved', updated_at = now()
      WHERE id = {id: String} AND repo_id = {repoId: String}
    `,
    query_params: { id, repoId },
  })
}

// Discard a recipe the user denied.
export async function denyKnowledge(id: string, repoId: string): Promise<void> {
  await clickhouse.exec({
    query: `ALTER TABLE knowledge DELETE WHERE id = {id: String} AND repo_id = {repoId: String}`,
    query_params: { id, repoId },
  })
}
