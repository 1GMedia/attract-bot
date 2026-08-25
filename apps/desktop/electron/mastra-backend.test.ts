import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import { buildMastraSpawnSpec, resolveManagedNode, waitForMastraReady } from './mastra-backend'

describe('Mastra desktop backend', () => {
  it('prefers the Hermes-managed Node runtime', () => {
    expect(resolveManagedNode('/hermes-home', {}, 'darwin', candidate => candidate.endsWith('/node/bin/node'))).toBe(
      '/hermes-home/node/bin/node'
    )
  })

  it('keeps orchestration credentials in the child environment only', () => {
    const hermesRoot = path.resolve('checkout')
    const hermesHome = path.resolve('hermes-home')
    const managedNode = path.join(hermesHome, 'managed-node')
    const output = path.join(hermesRoot, 'apps', 'mastra', '.mastra', 'output', 'index.mjs')
    const spec = buildMastraSpawnSpec({
      hermesRoot,
      hermesHome,
      hermesBaseUrl: 'http://127.0.0.1:8642',
      hermesApiKey: 'ephemeral-hermes-key',
      jwtSecret: 'ephemeral-jwt-secret',
      instanceId: 'desktop-launch-123',
      profile: 'agency',
      environment: { NODE: managedNode, PATH: '/usr/bin' },
      exists: candidate => candidate === managedNode || candidate === output
    })

    expect(spec.command).toBe(managedNode)
    expect(spec.args).toEqual([output])
    expect(spec.env).toMatchObject({
      KORGO_HERMES_API_KEY: 'ephemeral-hermes-key',
      KORGO_HERMES_URL: 'http://127.0.0.1:8642',
      KORGO_HERMES_PROFILE: 'agency',
      KORGO_MASTRA_PORT: '4112',
      KORGO_MASTRA_JWT_SECRET: 'ephemeral-jwt-secret',
      KORGO_MASTRA_WORKSPACE_ID: hermesRoot
    })
  })

  it('requires the expected health identity', async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            service: 'hermes-mastra-local',
            instanceId: 'stale-launch'
          })
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            service: 'hermes-mastra-local',
            instanceId: 'desktop-launch-123'
          })
        )
      )

    await expect(
      waitForMastraReady({
        healthUrl: 'http://127.0.0.1:4112/korgo/health',
        child: { exitCode: null, killed: false },
        expectedInstanceId: 'desktop-launch-123',
        fetchImplementation,
        timeoutMs: 2_000
      })
    ).resolves.toBeUndefined()
    expect(fetchImplementation).toHaveBeenCalledTimes(2)
  })
})
