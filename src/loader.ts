#!/usr/bin/env node
// SDD Startup Loader
// Copyright (c) 2026 Jeremy McSpadden <jeremy@fluxlabs.net>
import { fileURLToPath } from 'url'
import { dirname, resolve, join, relative, delimiter } from 'path'
import { existsSync, readFileSync, mkdirSync, symlinkSync, cpSync } from 'fs'

// Fast-path: handle --version/-v and --help/-h before importing any heavy
// dependencies. This avoids loading the entire pi-coding-agent barrel import
// (~1s) just to print a version string.
const sddRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const firstArg = args[0]

// Read package.json once — reused for version, banner, and SDD_VERSION below
let sddVersion = '0.0.0'
try {
  const pkg = JSON.parse(readFileSync(join(sddRoot, 'package.json'), 'utf-8'))
  sddVersion = pkg.version || '0.0.0'
} catch { /* ignore */ }

if (firstArg === '--version' || firstArg === '-v') {
  process.stdout.write(sddVersion + '\n')
  process.exit(0)
}

if (firstArg === '--help' || firstArg === '-h') {
  const { printHelp } = await import('./help-text.js')
  printHelp(sddVersion)
  process.exit(0)
}

import { agentDir, appRoot } from './app-paths.js'
import { serializeBundledExtensionPaths } from './bundled-extension-paths.js'
import { discoverExtensionEntryPaths } from './extension-discovery.js'
import { loadRegistry, readManifestFromEntryPath, isExtensionEnabled } from './extension-registry.js'
import { renderLogo } from './logo.js'

// pkg/ is a shim directory: contains sdd's piConfig (package.json) and pi's
// theme assets (dist/modes/interactive/theme/) without a src/ directory.
// This allows config.js to:
//   1. Read piConfig.name → "sdd" (branding)
//   2. Resolve themes via dist/ (no src/ present → uses dist path)
const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'pkg')

// MUST be set before any dynamic import of pi SDK fires — this is what config.js
// reads to determine APP_NAME and CONFIG_DIR_NAME
process.env.PI_PACKAGE_DIR = pkgDir
process.env.PI_SKIP_VERSION_CHECK = '1'  // SDD runs its own update check in cli.ts — suppress pi's
process.title = 'sdd'

// Print branded banner on first launch (before ~/.sdd/ exists)
if (!existsSync(appRoot)) {
  const cyan  = '\x1b[36m'
  const green = '\x1b[32m'
  const dim   = '\x1b[2m'
  const reset = '\x1b[0m'
  const colorCyan = (s: string) => `${cyan}${s}${reset}`
  process.stderr.write(
    renderLogo(colorCyan) +
    '\n' +
    `  Spec-Driven Development ${dim}v${sddVersion}${reset}\n` +
    `  ${green}Welcome.${reset} Setting up your environment...\n\n`
  )
}

// SDD_CODING_AGENT_DIR — tells pi's getAgentDir() to return ~/.sdd/agent/ instead of ~/.sdd/agent/
process.env.SDD_CODING_AGENT_DIR = agentDir

// NODE_PATH — make sdd's own node_modules available to extensions loaded via jiti.
// Without this, extensions (e.g. browser-tools) can't resolve dependencies like
// `playwright` because jiti resolves modules from pi-coding-agent's location, not sdd's.
// Prepending sdd's node_modules to NODE_PATH fixes this for all extensions.
const sddNodeModules = join(sddRoot, 'node_modules')
process.env.NODE_PATH = [sddNodeModules, process.env.NODE_PATH]
  .filter(Boolean)
  .join(delimiter)
// Force Node to re-evaluate module search paths with the updated NODE_PATH.
// Must happen synchronously before cli.js imports → extension loading.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Module } = await import('module');
(Module as any)._initPaths?.()

// SDD_VERSION — expose package version so extensions can display it
process.env.SDD_VERSION = sddVersion

// SDD_BIN_PATH — absolute path to this loader (dist/loader.js), used by patched subagent
// to spawn sdd instead of pi when dispatching workflow tasks
process.env.SDD_BIN_PATH = process.argv[1]

// SDD_WORKFLOW_PATH — absolute path to bundled SDD-WORKFLOW.md, used by patched sdd extension
// when dispatching workflow prompts. Prefers dist/resources/ (stable, set at build time)
// over src/resources/ (live working tree) — see resource-loader.ts for rationale.
const distRes = join(sddRoot, 'dist', 'resources')
const srcRes = join(sddRoot, 'src', 'resources')
const resourcesDir = existsSync(distRes) ? distRes : srcRes
process.env.SDD_WORKFLOW_PATH = join(resourcesDir, 'SDD-WORKFLOW.md')

// SDD_BUNDLED_EXTENSION_PATHS — dynamically discovered bundled extension entry points.
// Uses the shared discoverExtensionEntryPaths() to scan the bundled resources
// directory, then remaps discovered paths to agentDir (~/.sdd/agent/extensions/)
// where initResources() will sync them.
const bundledExtDir = join(resourcesDir, 'extensions')
const agentExtDir = join(agentDir, 'extensions')
const registry = loadRegistry()
const discoveredExtensionPaths = discoverExtensionEntryPaths(bundledExtDir)
  .map((entryPath) => join(agentExtDir, relative(bundledExtDir, entryPath)))
  .filter((entryPath) => {
    const manifest = readManifestFromEntryPath(entryPath)
    if (!manifest) return true  // no manifest = always load
    return isExtensionEnabled(registry, manifest.id)
  })

process.env.SDD_BUNDLED_EXTENSION_PATHS = serializeBundledExtensionPaths(discoveredExtensionPaths)

// Respect HTTP_PROXY / HTTPS_PROXY / NO_PROXY env vars for all outbound requests.
// pi-coding-agent's cli.ts sets this, but SDD bypasses that entry point — so we
// must set it here before any SDK clients are created.
// Lazy-load undici (~200ms) only when proxy env vars are actually set.
if (process.env.HTTP_PROXY || process.env.HTTPS_PROXY || process.env.http_proxy || process.env.https_proxy) {
  const { EnvHttpProxyAgent, setGlobalDispatcher } = await import('undici')
  setGlobalDispatcher(new EnvHttpProxyAgent())
}

// Ensure workspace packages are linked (or copied on Windows) before importing
// cli.js (which imports @sdd/*).
// npm postinstall handles this normally, but npx --ignore-scripts skips postinstall.
// On Windows without Developer Mode or admin rights, symlinkSync will throw even for
// 'junction' type — so we fall back to cpSync (a full directory copy) which works
// everywhere without elevated permissions.
const sddScopeDir = join(sddNodeModules, '@sdd')
const packagesDir = join(sddRoot, 'packages')
const wsPackages = ['native', 'pi-agent-core', 'pi-ai', 'pi-coding-agent', 'pi-tui']
try {
  if (!existsSync(sddScopeDir)) mkdirSync(sddScopeDir, { recursive: true })
  for (const pkg of wsPackages) {
    const target = join(sddScopeDir, pkg)
    const source = join(packagesDir, pkg)
    if (!existsSync(source) || existsSync(target)) continue
    try {
      symlinkSync(source, target, 'junction')
    } catch {
      // Symlink failed (common on Windows without Developer Mode / admin).
      // Fall back to a directory copy — slower on first run but universally works.
      try { cpSync(source, target, { recursive: true }) } catch { /* non-fatal */ }
    }
  }
} catch { /* non-fatal */ }

// Validate critical workspace packages are resolvable. If still missing after the
// symlink+copy attempts, emit a clear diagnostic instead of a cryptic
// ERR_MODULE_NOT_FOUND from deep inside cli.js.
const criticalPackages = ['pi-coding-agent']
const missingPackages = criticalPackages.filter(pkg => !existsSync(join(sddScopeDir, pkg)))
if (missingPackages.length > 0) {
  const missing = missingPackages.map(p => `@sdd/${p}`).join(', ')
  process.stderr.write(
    `\nError: SDD installation is broken — missing packages: ${missing}\n\n` +
    `This is usually caused by one of:\n` +
    `  • An outdated version installed from npm (run: npm install -g sdd-pi@latest)\n` +
    `  • The packages/ directory was excluded from the installed tarball\n` +
    `  • A filesystem error prevented linking or copying the workspace packages\n\n` +
    `Fix it by reinstalling:\n\n` +
    `  npm install -g sdd-pi@latest\n\n` +
    `If the issue persists, please open an issue at:\n` +
    `  https://github.com/bhargavvc/sdd/issues\n`
  )
  process.exit(1)
}

// Dynamic import defers ESM evaluation — config.js will see PI_PACKAGE_DIR above
await import('./cli.js')
