/**
 * Critical Heros — booth traffic trigger.
 *
 * Serves a one-button web page. Clicking "SEND TRAFFIC" floods the deployed mcp-server
 * health endpoint at high concurrency, producing a visible CPU/network spike on the Grafana
 * dashboard. That is ALL this script does. Critical Hero itself reacts to the spike: the
 * Prometheus alert fires, Alertmanager hits the webhook, and the product posts the Slack
 * incident message + approve-to-fix PR. The script never touches Slack or GitHub.
 *
 * Run with: npm run booth
 */
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Fastify from 'fastify'

const here = dirname(fileURLToPath(import.meta.url))

// --- Config (override via env) ---------------------------------------------
const TARGET = (process.env.BOOTH_TARGET ?? 'https://mcp.critical-hero.uk').replace(/\/$/, '')
const HEALTH_URL = `${TARGET}/health`
const GRAFANA_BASE = (process.env.BOOTH_GRAFANA ?? 'https://grafana.critical-hero.uk').replace(/\/$/, '')
// "Kubernetes / Networking / Namespace (Pods)" — bandwidth-per-pod, the most visible spike.
const GRAFANA_URL = `${GRAFANA_BASE}/d/8b7a8b326d7a6f1f04244066368c67af/kubernetes-networking-namespace-pods?orgId=1&var-namespace=critical-hero&from=now-15m&to=now&refresh=10s`

const FLOOD_DURATION_MS = Number(process.env.BOOTH_DURATION_MS ?? 120_000)
const FLOOD_CONCURRENCY = Number(process.env.BOOTH_CONCURRENCY ?? 80)
const PORT = Number(process.env.BOOTH_PORT ?? 4545)

// --- Run state -------------------------------------------------------------
interface FloodState {
  running: boolean
  requestsSent: number
  errors: number
  rps: number
  durationMs: number
  elapsedMs: number
  grafanaUrl: string
}

let state: FloodState = {
  running: false,
  requestsSent: 0,
  errors: 0,
  rps: 0,
  durationMs: FLOOD_DURATION_MS,
  elapsedMs: 0,
  grafanaUrl: GRAFANA_URL,
}

// Set by /api/stop so the operator can end the flood early (the button toggles to STOP).
let stopRequested = false

async function flood() {
  stopRequested = false
  state = {
    running: true,
    requestsSent: 0,
    errors: 0,
    rps: 0,
    durationMs: FLOOD_DURATION_MS,
    elapsedMs: 0,
    grafanaUrl: GRAFANA_URL,
  }
  const startedAt = Date.now()
  const deadline = startedAt + FLOOD_DURATION_MS
  console.log(`[booth] flooding ${HEALTH_URL} for ${FLOOD_DURATION_MS / 1000}s with ${FLOOD_CONCURRENCY} workers`)

  let lastCount = 0
  const ticker = setInterval(() => {
    state.elapsedMs = Date.now() - startedAt
    state.rps = state.requestsSent - lastCount
    lastCount = state.requestsSent
  }, 1000)

  async function worker() {
    while (Date.now() < deadline && !stopRequested) {
      try {
        const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(5000) })
        await res.arrayBuffer().catch(() => {})
        state.requestsSent++
      } catch {
        state.errors++
      }
    }
  }

  await Promise.all(Array.from({ length: FLOOD_CONCURRENCY }, () => worker()))
  clearInterval(ticker)
  state.elapsedMs = Date.now() - startedAt
  state.rps = 0
  state.running = false
  console.log(`[booth] done: ${state.requestsSent} requests, ${state.errors} errors`)
}

// --- HTTP ------------------------------------------------------------------
const app = Fastify({ logger: false })

app.get('/', async (_req, reply) => {
  const html = await readFile(join(here, 'public', 'index.html'), 'utf8')
  reply.type('text/html').send(html)
})

app.get('/api/status', async () => ({ ...state, target: TARGET }))

app.post('/api/run', async (_req, reply) => {
  if (state.running) return reply.status(409).send({ ok: false, message: 'A flood is already running.' })
  flood() // fire and forget; the page polls /api/status
  return { ok: true }
})

app.post('/api/stop', async () => {
  stopRequested = true
  return { ok: true }
})

// Hosted in-cluster behind the Traefik ingress at critical-hero.uk/stress, so bind all interfaces.
app.listen({ port: PORT, host: '0.0.0.0' }, (err, address) => {
  if (err) {
    console.error(err)
    process.exit(1)
  }
  console.log('\n  Critical Heros booth traffic trigger')
  console.log(`  → open ${address}`)
  console.log(`  target:  ${HEALTH_URL}`)
  console.log(`  grafana: ${GRAFANA_URL}\n`)
})
