import { MastraClient } from '@mastra/client-js'
import { createRuntimeConfig } from '../src/mastra/runtime-config.ts'
import { authenticatedHeaders } from './auth.ts'

const config = createRuntimeConfig()
const client = new MastraClient({ baseUrl: `http://${config.host}:${config.port}` })
const response = await fetch(`http://${config.host}:${config.port}/korgo/health`)
if (!response.ok) throw new Error(`Mastra health canary failed with HTTP ${response.status}.`)
const health = await response.json()
if (!config.auth.jwtSecret) throw new Error('Authenticated Mastra canary requires KORGO_MASTRA_JWT_SECRET.')

const anonymousRuns = await fetch(`http://${config.host}:${config.port}/korgo/runs`)
if (anonymousRuns.status !== 401) {
  throw new Error(`Anonymous Mastra run access must return 401, received ${anonymousRuns.status}.`)
}

const authenticatedRuns = await fetch(`http://${config.host}:${config.port}/korgo/runs?limit=1`, {
  headers: authenticatedHeaders(config.auth.jwtSecret)
})
if (!authenticatedRuns.ok) {
  throw new Error(`Authenticated Mastra run canary failed with HTTP ${authenticatedRuns.status}.`)
}
const runs = await authenticatedRuns.json()

// Force client construction into the canary so API compatibility is checked at build time.
void client
console.log(JSON.stringify({ ok: true, anonymousRunsStatus: anonymousRuns.status, health, runs }, null, 2))
