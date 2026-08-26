import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadRemoteMastraBundle, provisionRemoteMastra, remoteArchitecture } from './mastra-remote'

const temporary: string[] = []

afterEach(() => {
  temporary.splice(0).forEach(directory => fs.rmSync(directory, { recursive: true, force: true }))
})

function bundle() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mastra-remote-test-'))
  temporary.push(directory)
  const archive = Buffer.from('linux bundle')
  const archiveHash = crypto.createHash('sha256').update(archive).digest('hex')
  fs.writeFileSync(path.join(directory, 'linux-x64.tar.gz'), archive)
  fs.writeFileSync(path.join(directory, 'linux-x64.json'), JSON.stringify({
    archiveHash,
    architecture: 'x64',
    releaseVersion: 'release-1'
  }))
  return directory
}

describe('remote Mastra provisioning', () => {
  it('maps supported Linux architectures and rejects unknown hosts', () => {
    expect(remoteArchitecture('x86_64\n')).toBe('x64')
    expect(remoteArchitecture('aarch64\n')).toBe('arm64')
    expect(() => remoteArchitecture('riscv64')).toThrow(/unsupported/)
  })

  it('fails a tampered runtime archive before contacting Orgo', () => {
    const directory = bundle()
    fs.appendFileSync(path.join(directory, 'linux-x64.tar.gz'), 'tampered')
    expect(() => loadRemoteMastraBundle(directory, 'x64')).toThrow(/hash check/)
  })

  it('uploads, starts, and forwards a fresh remote runtime without putting secrets in commands', async () => {
    const commands: Array<{ command: string; stdinData?: Buffer | string }> = []
    const ssh = {
      exec: vi.fn(async (command: string, options?: { stdinData?: Buffer | string }) => {
        commands.push({ command, stdinData: options?.stdinData })
        if (command === 'uname -m') return 'x86_64\n'
        if (command.includes('process.versions.node')) return '22.22.0\n'
        return ''
      }),
      forward: vi.fn(async () => undefined)
    }
    const result = await provisionRemoteMastra({
      bundleDirectory: bundle(),
      hermesApiKey: 'hermes-secret',
      hermesPort: 8642,
      pickLocalPort: async () => 49112,
      profile: 'default',
      ssh
    })

    expect(result).toMatchObject({ baseUrl: 'http://127.0.0.1:49112', remotePort: 4112, runtimeVersion: 'release-1' })
    expect(ssh.forward).toHaveBeenCalledWith(49112, 4112)
    expect(commands.some(entry => Buffer.isBuffer(entry.stdinData))).toBe(true)
    expect(commands.some(entry => typeof entry.stdinData === 'string' && entry.stdinData.includes('hermes-secret'))).toBe(true)
    expect(commands.map(entry => entry.command).join('\n')).not.toContain('hermes-secret')
    expect(commands.map(entry => entry.command).join('\n')).toContain('release-1-')
    expect(commands.map(entry => entry.command).join('\n')).toContain('"$HOME/.hermes/mastra"')
  })

  it('reuses a live pinned runtime and its instance identity without uploading or restarting it', async () => {
    const commands: Array<{ command: string; stdinData?: Buffer | string }> = []
    const ssh = {
      exec: vi.fn(async (command: string, options?: { stdinData?: Buffer | string }) => {
        commands.push({ command, stdinData: options?.stdinData })
        if (command === 'uname -m') return 'x86_64\n'
        if (command.includes('process.versions.node')) return '22.22.0\n'
        if (command.includes('runtime.manifest')) {
          const directory = bundleDirectory
          const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'linux-x64.json'), 'utf8'))
          return `release-1:${manifest.archiveHash}`
        }
        if (command.includes('runtime.env')) {
          return [
            "KORGO_MASTRA_INSTANCE_ID='existing-instance'",
            "KORGO_MASTRA_JWT_SECRET='existing-secret'",
            "KORGO_MASTRA_RUNTIME_VERSION='release-1'"
          ].join('\n')
        }
        if (command.includes('kill -0')) return 'yes\n'
        return ''
      }),
      forward: vi.fn(async () => undefined)
    }
    const bundleDirectory = bundle()
    const result = await provisionRemoteMastra({
      bundleDirectory,
      hermesApiKey: 'new-hermes-secret',
      hermesPort: 8642,
      pickLocalPort: async () => 49113,
      profile: 'default',
      ssh
    })

    expect(result).toMatchObject({ instanceId: 'existing-instance', jwtSecret: 'existing-secret' })
    expect(commands.every(entry => entry.stdinData === undefined)).toBe(true)
    expect(commands.map(entry => entry.command).join('\n')).not.toContain('nohup node')
  })
})
