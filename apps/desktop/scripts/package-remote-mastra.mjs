#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const desktopDirectory = path.resolve(scriptDirectory, '..')
const outputDirectory = path.resolve(desktopDirectory, '../mastra/.mastra/output')
const destination = path.resolve(desktopDirectory, 'build/mastra-remote')
const architecture = process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'x64' : null

if (process.platform !== 'linux' || !architecture) {
  throw new Error('Remote Mastra bundles must be built on Linux x64 or arm64.')
}
if (!fs.existsSync(path.join(outputDirectory, 'index.mjs'))) {
  throw new Error(`Mastra build output is missing at ${outputDirectory}`)
}

const releaseVersion = String(process.env.KORGO_RELEASE_VERSION || process.env.GITHUB_SHA || '').trim()
if (!/^[a-zA-Z0-9._-]{1,128}$/.test(releaseVersion)) {
  throw new Error('KORGO_RELEASE_VERSION or GITHUB_SHA must provide a safe pinned release version.')
}

fs.mkdirSync(destination, { recursive: true })
const archivePath = path.join(destination, `linux-${architecture}.tar.gz`)

execFileSync('tar', ['-czf', archivePath, '-C', outputDirectory, '.'], { stdio: 'inherit' })
const archiveHash = crypto.createHash('sha256').update(fs.readFileSync(archivePath)).digest('hex')
fs.writeFileSync(
  path.join(destination, `linux-${architecture}.json`),
  `${JSON.stringify({ archiveHash, architecture, releaseVersion }, null, 2)}\n`,
  { mode: 0o644 }
)

console.log(`Packaged ${archivePath}`)
