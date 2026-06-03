import 'dotenv/config'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const client = new Client({
  name: 'test-mcp-client',
  version: '1.0.0',
})

// A single Client may only connect to one transport; use stdio for tests.
const stdioClientTransport = new StdioClientTransport({
  command: 'c8',
  args: ['--reporter=lcov', '--reporter=text', 'tsx', './src/index.ts'],
  env: {
    ...(process.env as Record<string, string>),
    NODE_V8_COVERAGE: './coverage/tmp',
  },
})
await client.connect(stdioClientTransport)

global.client = client
