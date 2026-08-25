import { describe, expect, it } from 'vitest'
import { createRuntimeConfig, normalizeHermesUrl, normalizeProfile } from '../src/mastra/runtime-config.ts'

describe('Mastra runtime configuration', () => {
  it('defaults to local-only services and an external application data directory', () => {
    const config = createRuntimeConfig({}, '/Users/tester', 'darwin')
    expect(config.host).toBe('127.0.0.1')
    expect(config.port).toBe(4112)
    expect(config.instanceId).toBe('standalone')
    expect(config.hermes.baseUrl).toBe('http://127.0.0.1:8642')
    expect(config.dataDirectory.replaceAll('\\', '/')).toContain('Library/Application Support/Hermes Bots/Mastra')
  })

  it('uses platform-native durable data directories on Windows and Linux', () => {
    expect(
      createRuntimeConfig({ LOCALAPPDATA: 'C:\\Users\\tester\\AppData\\Local' }, 'C:\\Users\\tester', 'win32')
        .dataDirectory
    ).toSatisfy((directory: string) =>
      directory.replaceAll('\\', '/').includes('AppData/Local/Hermes Bots/Mastra')
    )
    expect(createRuntimeConfig({ XDG_DATA_HOME: '/var/data/tester' }, '/home/tester', 'linux').dataDirectory).toBe(
      '/var/data/tester/hermes-bots/mastra'
    )
  })

  it('allows HTTPS remote Hermes but rejects plaintext remote execution', () => {
    expect(normalizeHermesUrl('https://hermes.example.com/')).toBe('https://hermes.example.com')
    expect(() => normalizeHermesUrl('http://hermes.example.com')).toThrow(/HTTPS/)
  })

  it('rejects path-shaped profile names', () => {
    expect(normalizeProfile('client_01')).toBe('client_01')
    expect(() => normalizeProfile('../client')).toThrow(/profile/)
  })
})
