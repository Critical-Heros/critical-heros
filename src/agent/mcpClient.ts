import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import 'dotenv/config'

// Defaults to the local server; set MCP_SERVER_URL to reach a remote MCP server
// (e.g. running the PR-review agent from a lambda or another host).
const MCP_URL = process.env.MCP_SERVER_URL ?? `http://localhost:${process.env.PORT ?? 8401}/mcp`

// 에이전트 실행마다 새 MCP 클라이언트를 생성해 툴을 호출
export async function createMcpClient(): Promise<Client> {
  const client = new Client({ name: 'critical-hero-slack-agent', version: '1.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL))
  await client.connect(transport)
  return client
}

export async function callMcpTool(client: Client, name: string, input: Record<string, unknown>): Promise<string> {
  const result = await client.callTool({ name, arguments: input })
  const content = result.content as Array<{ type: string; text?: string }>
  const textBlock = content.find(c => c.type === 'text')
  return textBlock?.text ?? JSON.stringify(content)
}
