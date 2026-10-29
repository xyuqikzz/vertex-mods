import { releaseFor } from './optiscaler.js'
import { recoverableManifest } from './backup-recovery.js'
// Adapted to Vertex ES modules from DLSS5-Swapper v2.2.7 (MIT).
// Copyright (c) 2026 Rakan Alkhaldi. See resources/licenses/DLSS5-Swapper-LICENSE.txt.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import pe from './pe.js'
import emulators from './emulators.js'
import crypto from 'node:crypto'
import feederRelease from './feeder-release.js'
import { safePath } from './file-journal.js'
import { apiSummary } from '../renderer-evidence.js'
import {
  identifyExecutables,
  selectExecutable,
  engineFor,
  ENGINE_HELPER,
  ownedPath,
  pathKey
} from '../detection/executables.js'
import { refreshRuntimeCandidates } from '../detection/observe.js'
import { resolveRendering } from '../detection/resolver.js'
import { gameProcessState, snapshotGameProcesses } from '../processes.js'
import { readPeFile } from '../pe.js'
// Works out everything the swap needs to know about a game folder:
// which executable is the game, which rendering API it uses, where the
// existing DLSS/Streamline files live, and whether ReShade is already there.

const SKIP_DIRS = new Set([
  '_dlss5_backup',
  'reshade-shaders',
  'host64',
  'node_modules',
  '.git',
  // Asset trees contain tens of thousands of files but never the runtime DLL
  // or executable we need. Skipping them lets packaged Unreal games be scanned
  // deeper without making every library refresh slower.
  'paks',
  'movies',
  'screenshots',
  'saved',
  'logs',
  'mods',
  'bepinex',
  'bepinexpack',
  'melonloader',
  'downloads',
  'overwrite',
  'profiles',
  '_redist',
  'prerequisites',
  'directx',
  'redist',
  'redistributable',
  'redistributables',
  '_commonredist',
  'dotnet',
  // Shipped installers and vendor helpers keep their own executables around.
  'installer_resources',
  'installer',
  'installers',
  'support',
  'vcredist',
  '_support',
  'directx_redist',
  'eaanticheat',
  'easyanticheat',
  'battleye',
  // Never touch copies the user (or another tool) parked as a backup.
  'backup',
  'backups',
  '_backup',
  'bak',
  'old',
  'original',
  'originals'
])
const MAX_SCAN_DEPTH = 12

// Installers, launchers and anti-cheat helpers are never the game itself.
const NOT_A_GAME =
  /^(unins|setup|install|vcredist|vc_redist|dxsetup|dxwebsetup|oalinst|uninstall|crashreport|crashhandler|easyanticheat|eac|battleye|be_service|launcher|activation|patch|update|dotnetfx|touchup|rapidcrc|autorun|autoplay|quicksfv|readme|config|benchmark|report|helper|service|cleanup|modorganizer|redlauncher|skse\d*_loader|hlds\b|srcds\b|steamerrorreporter|dgvoodoocpl|reshade_setup)/i

const DLSS_FILE = /^(nvngx_dlss[a-z_]*\.dll|nvngx\.dll|_nvngx\.dll)$/i
const STREAMLINE_FILE = /^sl\.[a-z_]+\.dll$/i
const RESHADE_HOOKS = [
  'dxgi.dll',
  'd3d12.dll',
  'd3d11.dll',
  'd3d9.dll',
  'opengl32.dll',
  'dinput8.dll'
]

async function walk(root, onFile, maxDepth = 8, options = {}) {
  const queue = [{ dir: root, depth: 0 }]
  let visited = 0,
    programFiles = 0
  const limit = () => {
    throw Object.assign(new Error('扫描范围过大，请选择具体游戏的安装文件夹。'), {
      code: 'scan_limit'
    })
  }
  for (let cursor = 0; cursor < queue.length; cursor++) {
    options.signal?.throwIfAborted()
    const { dir, depth } = queue[cursor]
    let entries
    try {
      entries = await fs.promises.opendir(dir)
    } catch {
      continue
    }
    for await (const entry of entries) {
      options.signal?.throwIfAborted()
      if (++visited > options.maxEntries) limit()
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        const lower = entry.name.toLowerCase()
        // Unreal's Content tree is assets-only and enormous, but modern Xbox
        // installs put the entire accessible game under <Game>\Content.
        const skipContent = lower === 'content' && !options.includeContent
        if (!skipContent && !SKIP_DIRS.has(lower)) {
          if (depth >= maxDepth || queue.length >= options.maxDirectories) limit()
          queue.push({ dir: full, depth: depth + 1 })
        }
      } else if (entry.isFile() && /\.(?:exe|dll|addon(?:32|64)?)$/i.test(entry.name)) {
        if (++programFiles > options.maxProgramFiles) limit()
        await onFile(full, entry.name, depth)
      }
    }
  }
}

// The version resource of an Addon build looks identical to a plain one, so
// the only honest test is whether the binary carries the add-on loader itself.
function hasAddonSupport(file) {
  try {
    return fs.readFileSync(file).includes(Buffer.from('Searching for add-ons'))
  } catch {
    return false
  }
}

// ReShade proxies itself as a system DLL, so a d3d12.dll/dxgi.dll sitting next
// to the game is either ReShade or something else entirely — the version
// resource is what tells them apart. Modded games (GTA V with an ASI loader)
// instead run it as ReShade.asi, which must not be doubled up with a proxy.
function inspectReShade(exeDir) {
  let names = [...RESHADE_HOOKS]
  try {
    names = names.concat(fs.readdirSync(exeDir).filter((f) => /\.asi$/i.test(f)))
  } catch {
    /* Preserve upstream optional-file / best-effort fallback semantics. */
  }

  for (const name of names) {
    const file = path.join(exeDir, name)
    if (!fs.existsSync(file)) continue
    if (pe.versionMentions(file, 'ReShade')) {
      return {
        installed: true,
        file: name,
        kind: /\.asi$/i.test(name) ? 'asi' : 'proxy',
        version: pe.getFileVersion(file),
        addonSupport: hasAddonSupport(file)
      }
    }
  }
  return { installed: false, file: null, kind: null, version: null, addonSupport: false }
}

// Entry points a game asks for by name when it loads Direct3D at runtime.
const API_MARKERS = [
  // Agility SDK games can export only the SDK path/version from the launcher
  // executable and resolve D3D12 in the engine later. Dying Light: The Beast
  // is one such layout, so those exports are authoritative D3D12 evidence too.
  'D3D12CreateDevice',
  'D3D12SDKPath',
  'D3D12SDKVersion',
  'D3D11CreateDevice',
  'D3D10CreateDevice',
  // DirectDraw's two entry points. Without them a Genesis emulator reads as
  // having no 3D in it at all (#150).
  'DirectDrawCreateEx',
  'DirectDrawCreate',
  'Direct3DCreate9',
  'Direct3DCreate8',
  'CreateDXGIFactory',
  'vkCreateInstance',
  'wglCreateContext'
]

// A Direct3D DLL sitting beside the executable that is really DXVK or vkd3d:
// the game calls Direct3D, the wrapper turns it into Vulkan, and the frame
// is presented by Vulkan. Both halves of the app need to agree on this - the
// installer already refused to overwrite such a file, while the scanner
// still called the game DirectX and offered a route that could not work.
function isVulkanWrapper(file, bitness) {
  if (pe.getBitness(file) !== bitness || pe.versionMentions(file, 'ReShade')) return false
  if (pe.versionMentions(file, 'DXVK') || pe.versionMentions(file, 'vkd3d')) return true
  const markers = pe.findMarkers(file, ['DXVK', 'vkd3d', 'vkGetInstanceProcAddr', 'ReShade'])
  return (
    !markers.has('ReShade') &&
    markers.has('vkGetInstanceProcAddr') &&
    (markers.has('DXVK') || markers.has('vkd3d'))
  )
}

// Which DLL a game of each API would be calling, so only the file that could
// be a wrapper is opened.
const WRAPPED_BY_API = {
  dxgi: ['d3d12.dll', 'd3d11.dll', 'dxgi.dll'],
  d3d10: ['d3d10.dll', 'd3d10_1.dll'],
  d3d9: ['d3d9.dll'],
  d3d8: ['d3d8.dll'],
  ddraw: ['ddraw.dll']
}
function vulkanWrapperBeside(file, api, bitness) {
  const dir = path.dirname(file)
  for (const name of WRAPPED_BY_API[api] || []) {
    const candidate = findCaseInsensitive(dir, name)
    try {
      if (candidate && isVulkanWrapper(candidate, bitness)) return true
    } catch {
      /* unreadable is not a wrapper */
    }
  }
  return false
}
function apiFromNames(imports) {
  const names = [
    ['d3d12.dll', 'dxgi', 'DirectX 12'],
    ['d3d11.dll', 'dxgi', 'DirectX 11'],
    ['d3d10.dll', 'd3d10', 'DirectX 10'],
    ['d3d10_1.dll', 'd3d10', 'DirectX 10'],
    ['dxgi.dll', 'dxgi', 'DirectX (DXGI)'],
    ['vulkan-1.dll', 'vulkan', 'Vulkan'],
    ['d3d9.dll', 'd3d9', 'DirectX 9'],
    ['d3d8.dll', 'd3d8', 'DirectX 8'],
    ['ddraw.dll', 'ddraw', 'DirectDraw'],
    ['opengl32.dll', 'opengl', 'OpenGL']
  ]
  return apiSummary(
    names.filter(([name]) => imports.includes(name)).map(([, api, label]) => ({ api, label }))
  )
}

function apiFromMarkers(file) {
  const markers = pe.findMarkers(file, API_MARKERS)
  const signatures = [
    [['D3D12CreateDevice', 'D3D12SDKPath', 'D3D12SDKVersion'], 'dxgi', 'DirectX 12'],
    [['D3D11CreateDevice'], 'dxgi', 'DirectX 11'],
    [['D3D10CreateDevice'], 'd3d10', 'DirectX 10'],
    [['CreateDXGIFactory'], 'dxgi', 'DirectX (DXGI)'],
    [['Direct3DCreate9'], 'd3d9', 'DirectX 9'],
    [['Direct3DCreate8'], 'd3d8', 'DirectX 8'],
    [['DirectDrawCreateEx', 'DirectDrawCreate'], 'ddraw', 'DirectDraw'],
    [['vkCreateInstance'], 'vulkan', 'Vulkan'],
    [['wglCreateContext'], 'opengl', 'OpenGL']
  ]
  return apiSummary(
    signatures
      .filter(([list]) => list.some((name) => markers.has(name)))
      .map(([, api, label]) => ({ api, label }))
  )
}

function findCaseInsensitive(dir, wanted) {
  try {
    const name = fs.readdirSync(dir).find((entry) => entry.toLowerCase() === wanted.toLowerCase())
    return name ? path.join(dir, name) : null
  } catch {
    return null
  }
}

function xmlAttributes(text) {
  const out = {}
  for (const match of String(text).matchAll(/([\w:.-]+)\s*=\s*(["'])(.*?)\2/g)) {
    out[match[1].toLowerCase()] = match[3]
  }
  return out
}

// GDK executables may remain encrypted even in a modifiable flat-file install,
// so PE inspection can fail. MicrosoftGame.config is the package's authority
// for the executable path and architecture and remains readable.
function xboxExecutables(gameDir) {
  const configs = [
    findCaseInsensitive(gameDir, 'MicrosoftGame.config'),
    findCaseInsensitive(path.join(gameDir, 'Content'), 'MicrosoftGame.config')
  ].filter(Boolean)
  const found = []
  for (const config of configs) {
    let text
    try {
      text = fs.readFileSync(config, 'utf8')
    } catch {
      continue
    }
    for (const match of text.matchAll(/<Executable\b([^>]*)\/?\s*>/gi)) {
      const attrs = xmlAttributes(match[1])
      if (!attrs.name || /^gamelaunchhelper\.exe$/i.test(path.basename(attrs.name))) continue
      const full = path.resolve(path.dirname(config), attrs.name.replace(/[\\/]/g, path.sep))
      const rel = path.relative(gameDir, full)
      if (rel.startsWith('..') || path.isAbsolute(rel)) continue
      const architecture = String(attrs.architecture || '').toLowerCase()
      found.push({
        config,
        path: full,
        rel,
        name: path.basename(full),
        bitness: architecture === 'x64' ? 64 : architecture === 'x86' ? 32 : null,
        arm64: architecture === 'arm64',
        id: attrs.id || null
      })
    }
  }
  return found
}

// Some games deliberately ship one executable per renderer. Far Cry 3 is a
// common example (farcry3_d3d11.exe), and those small dispatcher binaries may
// not import the graphics API themselves. The explicit renderer suffix is a
// useful final signal, after imports and binary markers have been exhausted.
function apiFromFileName(file) {
  const name = path.basename(file).toLowerCase()
  if (/(?:^|[_-])(?:d3d|dx)12(?:[_-]|\.|$)/.test(name)) return { api: 'dxgi', label: 'DirectX 12' }
  if (/(?:^|[_-])(?:d3d|dx)11(?:[_-]|\.|$)/.test(name)) return { api: 'dxgi', label: 'DirectX 11' }
  if (/(?:^|[_-])(?:d3d|dx)10(?:[_-]|\.|$)/.test(name)) return { api: 'd3d10', label: 'DirectX 10' }
  if (/(?:^|[_-])(?:d3d|dx)9(?:[_-]|\.|$)/.test(name)) return { api: 'd3d9', label: 'DirectX 9' }
  if (/(?:^|[_-])(?:d3d|dx)8(?:[_-]|\.|$)/.test(name)) return { api: 'd3d8', label: 'DirectX 8' }
  if (/(?:^|[_-])ddraw(?:[_-]|\.|$)/.test(name)) return { api: 'ddraw', label: 'DirectDraw' }
  if (/(?:^|[_-])vulkan(?:[_-]|\.|$)/.test(name)) return { api: 'vulkan', label: 'Vulkan' }
  if (/(?:^|[_-])(?:ogl|opengl)(?:[_-]|\.|$)/.test(name)) return { api: 'opengl', label: 'OpenGL' }
  return null
}

// Where RDR2 keeps its own graphics settings. The executable is byte-for-byte
// the same under DX12 and Vulkan, so this file is the only place the answer
// exists, and people who switch the renderer for a Vulkan-only ReShade add-on
// were left looking at a card that still said DirectX 12.
function rdr2SettingsFiles() {
  const home = process.env.USERPROFILE || os.homedir()
  const rel = path.join('Rockstar Games', 'Red Dead Redemption 2', 'Settings', 'system.xml')
  // Documents is often redirected into OneDrive, which leaves the original
  // path empty rather than missing.
  const roots = [path.join(home, 'Documents'), path.join(home, 'OneDrive', 'Documents')]
  if (process.env.OneDrive) roots.push(path.join(process.env.OneDrive, 'Documents'))
  return roots.map((root) => path.join(root, rel))
}

// Deliberately one-way: only an explicit Vulkan setting moves the answer. A
// missing, unreadable or unrecognised file keeps the DirectX 12 this profile
// has always reported, so a wrong guess here can never take a working game
// away from someone.
function rdr2Renderer(files = rdr2SettingsFiles()) {
  for (const file of files) {
    let text
    try {
      text = fs.readFileSync(file, 'utf8')
    } catch {
      continue
    }
    const setting = /<API[^>]*>([^<]*)<\/API>/i.exec(text)
    if (setting && /vulkan/i.test(setting[1])) return { api: 'vulkan', label: 'Vulkan' }
    if (setting) return { api: 'dxgi', label: 'DirectX 12' }
  }
  return { api: 'dxgi', label: 'DirectX 12' }
}

// A few engines keep compatibility or launcher code for an API they never use
// to render the game. RDR2 carries a Direct3D 9 marker even though its only PC
// renderers are DX12 and Vulkan, so binary-string guessing is actively wrong
// for this executable. Profiles are intentionally exact-name and expose every
// renderer the user can select instead of pretending the first marker wins.
function gameApiProfile(file, renderer = rdr2Renderer) {
  if (/^rdr2\.exe$/i.test(path.basename(file))) {
    return {
      detected: { ...renderer(), via: 'game-profile' },
      choices: [
        { api: 'dxgi', label: 'DirectX 12' },
        { api: 'vulkan', label: 'Vulkan' }
      ]
    }
  }
  return null
}

// Imports describe available backends, not the one selected at runtime. Engines
// can statically import OpenGL while resolving DirectX/Vulkan with LoadLibrary.
function binaryApi(file, imports = pe.getImports(file)) {
  const direct = apiFromNames(imports)
  const dynamic = apiFromMarkers(file)
  return apiSummary([
    ...(direct?.candidates || []).map((item) => ({
      ...item,
      sources: [{ file, kind: 'imports' }]
    })),
    ...(dynamic?.candidates || []).map((item) => ({
      ...item,
      sources: [{ file, kind: 'strings' }]
    }))
  ])
}

function detectApi(file, imports) {
  const own = binaryApi(file, imports)
  const evidence = [...(own?.candidates || [])]
  let via = own?.candidates[0]?.sources[0]?.kind
  let evidenceFile
  const dir = path.dirname(file)
  for (const name of imports.slice(0, 80)) {
    if (path.basename(name) !== name || /[\\/:]/.test(name) || NOT_A_RENDERER.test(name)) continue
    const sibling = findCaseInsensitive(dir, name)
    // System DLLs live in System32; only the game's own modules sit here.
    if (!sibling || pe.getBitness(sibling) !== pe.getBitness(file)) continue
    const inner = binaryApi(sibling)
    if (!inner) continue
    evidence.push(...inner.candidates)
    via ||= 'module:' + name
    evidenceFile ||= sibling
  }
  const combined = apiSummary(evidence)
  if (combined) return { ...combined, via, file: evidenceFile }
  const named = apiFromFileName(file)
  if (named) return { ...named, via: 'filename' }
  return detectEngineApi(file)
}

// Small Source/GoldSrc dispatchers and several Ubisoft/UE2 games load their
// renderer dynamically from a separate module, not the executable's imports.
// Only inspect modules belonging to these entry points, with matching PE
// architecture and actual API evidence. A random DLL beside a tool is not
// evidence that the tool is a game; injected graphics proxies are never used.
function detectEngineApi(file) {
  const modules = {
    'hl.exe': ['hw.dll'],
    'hl2.exe': [
      'bin/shaderapidx9.dll',
      'bin/engine.dll',
      'bin/x64/shaderapidx9.dll',
      'bin/x64/engine.dll'
    ],
    'left4dead2.exe': ['bin/shaderapidx9.dll', 'bin/engine.dll'],
    'killingfloor.exe': ['D3D9Drv.dll', 'D3DDrv.dll', 'OpenGLDrv.dll'],
    'farcry5.exe': ['FC_m64.dll'],
    'watch_dogs.exe': ['Disrupt_b64.dll'],
    'kingdomcome.exe': ['WHGame.dll'],
    // X-Ray picks its renderer at startup and loads it with LoadLibrary, so
    // xrEngine.exe imports no Direct3D and reads as having no 3D in it at all.
    // R1 is DX8/9 fixed-function, R2 DX9, R3 DX10, R4 DX11 - whichever is
    // present answers. Reported as "No 3D executable found" on #232.
    'xrengine.exe': ['xrRender_R4.dll', 'xrRender_R3.dll', 'xrRender_R2.dll', 'xrRender_R1.dll'],
    // Source games each ship their own executable name. shaderapidx9.dll is
    // the engine's renderer and its filename is specific enough to be
    // evidence; Portal 2 is the one on #217.
    'portal2.exe': ['bin/shaderapidx9.dll', 'bin/x64/shaderapidx9.dll'],
    'csgo.exe': ['bin/shaderapidx9.dll'],
    'garrysmod.exe': ['bin/shaderapidx9.dll', 'bin/win64/shaderapidx9.dll']
  }[path.basename(file).toLowerCase()]
  if (!modules) return null
  const bitness = pe.getBitness(file)
  const evidence = []
  let evidenceFile
  for (const rel of modules) {
    let module = path.dirname(file)
    for (const part of rel.split('/')) {
      module = findCaseInsensitive(module, part)
      if (!module) break
    }
    if (!module || pe.getBitness(module) !== bitness) continue
    const api = binaryApi(module)
    if (api) {
      evidence.push(...api.candidates)
      evidenceFile ||= module
    }
  }
  const combined = apiSummary(evidence)
  return combined
    ? { ...combined, via: 'engine-module:' + path.basename(evidenceFile), file: evidenceFile }
    : null
}

// Libraries that mention Direct3D without being a game's renderer: browser
// engines, shader compilers, the graphics runtimes themselves, and the files
// this app and the mods it sits beside put there. None of them is evidence
// that a folder holds a game.
const NOT_A_RENDERER =
  /^(?:libglesv2|libegl|libcef|chrome_elf|cef|d3dcompiler_\d+|dxcompiler|dxil|vulkan-1|opengl32|d3d\d+|d3d\d+core|dxgi|ddraw|d3dimm|nvngx.*|sl\..*|amd_.*|ffx_.*|reshade\d*|dlss5.*|dgvoodoo.*|qt\d.*|mono.*|steam_api.*|galaxy.*|eossdk.*|discord.*|gameoverlayrenderer.*|renodx.*)\.dll$/i
// Source 2 loads rendersystemdx11.dll itself, and installing into Dota 2 broke
// it (#199). Its renderer is named so the reason is honest, but never offered.
const NOT_OFFERED = /^rendersystem/i

// The graphics evidence a game keeps in one of its own libraries rather than
// in the executable. Bounded hard: this runs only when a scan already found
// nothing, and it must not turn that into a long walk.
function rendererEvidence(gameDir, budget = 60) {
  const queue = [[gameDir, 0]]
  while (queue.length && budget > 0) {
    const [dir, depth] = queue.shift()
    let entries = []
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      // Prey keeps its renderer four folders down: Binaries/Danielle/x64/Release.
      if (entry.isDirectory()) {
        if (depth < 4) queue.push([full, depth + 1])
        continue
      }
      if (!/\.dll$/i.test(entry.name) || NOT_A_RENDERER.test(entry.name) || budget-- <= 0) continue
      try {
        const api = binaryApi(full)
        if (api)
          return {
            file: full,
            name: entry.name,
            api: api.api,
            label: api.label,
            bitness: pe.getBitness(full)
          }
      } catch {
        /* an unreadable module is not evidence */
      }
    }
  }
  return null
}

function rendererModule(gameDir, budget = 60) {
  const found = rendererEvidence(gameDir, budget)
  return found ? found.name : null
}

// The same evidence, but only from a library in an executable's own folder and
// built for the same architecture. A DLL elsewhere in the tree says nothing
// about which executable it belongs to, and Source 2 is never offered (#199).
async function rendererBeside(root, exes, budget = 60) {
  const byDir = new Map()
  for (const exe of exes) {
    if (
      ['helper', 'launcher', 'dedicated-server', 'interpreter'].includes(exe.role) ||
      !['x86', 'x64'].includes(exe.architecture)
    )
      continue
    const dir = path.dirname(exe.path)
    const key = pathKey(dir)
    const group = byDir.get(key) || { dir, exes: [] }
    group.exes.push(exe)
    byDir.set(key, group)
  }
  const results = []
  for (const { dir, exes: here } of byDir.values()) {
    // Anonymous modules cannot identify an owner among multiple same-architecture
    // programs, even when one of those programs already has direct API evidence.
    const targets = here.filter(
      (exe) =>
        !exe.api &&
        !exe.apiCandidates?.length &&
        here.filter((peer) => peer.architecture === exe.architecture).length === 1
    )
    if (!targets.length) continue
    let names = []
    try {
      names = fs
        .readdirSync(dir, { withFileTypes: true })
        .filter(
          (entry) =>
            entry.isFile() &&
            /\.dll$/i.test(entry.name) &&
            !NOT_A_RENDERER.test(entry.name) &&
            !NOT_OFFERED.test(entry.name)
        )
        .map((entry) => entry.name)
    } catch {
      continue
    }
    // An unread remainder may contain a second API. Never turn a truncated
    // directory probe into a precise static recommendation.
    if (names.length > budget) continue
    budget -= names.length
    const libraries = []
    for (const name of names) {
      const file = path.join(dir, name)
      if (!ownedPath(root, file)) continue
      try {
        const facts = await readPeFile(file, { dynamic: false })
        if (!facts.valid || !targets.some((exe) => exe.architecture === facts.architecture))
          continue
        const api = binaryApi(file, facts.imports)
        if (api) libraries.push({ file, name, ...api, architecture: facts.architecture })
      } catch {
        continue
      }
    }
    for (const exe of targets) {
      const fitting = libraries.filter((item) => item.architecture === exe.architecture)
      const combined = apiSummary(fitting.flatMap((item) => item.candidates))
      if (combined) results.push({ exe, evidence: { ...fitting[0], ...combined } })
    }
  }
  return results
}

function pathDistance(a, b) {
  const left = path.resolve(a).toLowerCase().split(path.sep).filter(Boolean)
  const right = path.resolve(b).toLowerCase().split(path.sep).filter(Boolean)
  let common = 0
  while (common < left.length && common < right.length && left[common] === right[common]) common++
  return left.length - common + (right.length - common)
}

function selectPrimaryDlss(files, chosen) {
  const exact = files.filter((file) => /^nvngx_dlss\.dll$/i.test(file.name))
  const legacy = files.filter((file) => /^_?nvngx\.dll$/i.test(file.name))
  const candidates = exact.length ? exact : legacy
  if (!candidates.length) return null
  const exeDir = chosen ? path.dirname(chosen.path) : null
  return [...candidates].sort((a, b) => {
    const score = (file) => {
      let value = 0
      if (file.version) value += 10000
      if (chosen && file.bitness === chosen.bitness) value += 2000
      if (
        chosen &&
        new RegExp(`(?:^|[\\\\/])win${chosen.bitness}(?:[\\\\/]|$)`, 'i').test(file.rel)
      )
        value += 500
      if (exeDir) value -= pathDistance(path.dirname(file.path), exeDir)
      return value
    }
    return score(b) - score(a) || a.rel.localeCompare(b.rel)
  })[0]
}

// Prefer the executable a player normally launches. Several older games ship
// separate SP and MP/Online programs in the same folder; installing beside the
// multiplayer binary makes ReShade appear missing in the single-player game.
// How many unreadable executables a folder may add to the picker. Enough for
// a launcher, a script extender and a couple of engine binaries; not a menu
// of every tool an installer left behind.
const UNDETECTED_LIMIT = 128

function playableRoleScore(exe) {
  const rel = String(exe.rel || exe.path || '').toLowerCase()
  let score = 0
  if (/(?:^|[\\/])singleplayer(?:[\\/]|$)/.test(rel)) score += 4
  if (/sp(?:[_-][^\\/]*)?\.exe$/.test(rel)) score += 2
  if (/(?:^|[\\/])(?:multiplayer|online)(?:[\\/]|$)/.test(rel)) score -= 4
  if (/mp(?:[_-][^\\/]*)?\.exe$/.test(rel)) score -= 2
  return score
}

async function scanGame(gameDir, options = {}) {
  const exeCandidates = []
  // Executables that are real PE binaries but name no rendering API. Kept
  // aside rather than thrown away: see the fallback below.
  const undetectedExes = []
  const manualExes = []
  const dlssFiles = []
  const streamlineFiles = []
  let addonPresent = null
  const xboxDeclared = xboxExecutables(gameDir)
  const xboxLayout =
    xboxDeclared.length > 0 || /(?:^|[\\/])xboxgames(?:[\\/]|$)/i.test(path.resolve(gameDir))

  await walk(
    gameDir,
    async (full, name, depth) => {
      const lower = name.toLowerCase()
      if (lower.endsWith('.exe')) {
        const facts = await readPeFile(full, { dynamic: false }).catch(() => null)
        const engineEntry = facts?.valid && engineFor(gameDir, { path: full, name })
        if (
          (NOT_A_GAME.test(lower) && !facts?.bootstrapTarget && !engineEntry) ||
          ENGINE_HELPER.test(lower)
        ) {
          if (facts?.valid && !facts.isDll)
            manualExes.push({
              path: full,
              rel: path.relative(gameDir, full),
              name,
              size: facts.size,
              depth,
              bitness: facts.bitness,
              api: null,
              apiLabel: null,
              apiCandidates: [],
              roleHint: /^launcher/i.test(name) ? 'launcher' : 'helper',
              via: 'manual-candidate'
            })
          return
        }
        let size = 0
        try {
          size = (await fs.promises.stat(full)).size
        } catch {
          return
        }
        const bitness = pe.getBitness(full)
        if (!bitness) return
        const emulator = emulators.profileFor(full)
        const gameProfile = emulator ? null : gameApiProfile(full)
        const detected = emulator
          ? { ...emulators.apiChoices(emulator)[0], via: 'emulator-profile' }
          : gameProfile
            ? gameProfile.detected
            : detectApi(full, facts?.valid ? facts.imports : pe.getImports(full))
        if (!detected) {
          undetectedExes.push({
            path: full,
            rel: path.relative(gameDir, full),
            name,
            size,
            depth,
            bitness,
            bootstrapTarget: facts?.bootstrapTarget || ''
          })
          return
        }
        // DXVK and vkd3d present the frame with Vulkan even though the game asks
        // for Direct3D, so that is the renderer to report and to install for.
        const wrapped =
          !emulator &&
          !gameProfile &&
          detected.api !== 'vulkan' &&
          vulkanWrapperBeside(full, detected.api, bitness)
        // File size is not a game classifier. Genuine engine dispatchers can be
        // only a few KB; retain them when PE/API evidence above is available.
        exeCandidates.push({
          path: full,
          rel: path.relative(gameDir, full),
          name,
          size,
          depth,
          api: wrapped ? 'vulkan' : detected.api,
          apiLabel: wrapped ? 'Vulkan' : detected.label,
          evidenceFile: detected.file,
          apiCandidates: wrapped
            ? [{ api: 'vulkan', label: 'Vulkan' }]
            : detected.candidates || [{ api: detected.api, label: detected.label }],
          via: wrapped ? 'vulkan-wrapper' : detected.via,
          dynamic: detected.via !== 'imports',
          bitness,
          dx12: !wrapped && detected.label === 'DirectX 12',
          emulator: emulator
            ? {
                key: emulator.key,
                name: emulator.name,
                system: emulator.system,
                hint: emulator.hint
              }
            : null,
          apiChoices: emulator
            ? emulators.apiChoices(emulator)
            : gameProfile
              ? gameProfile.choices
              : wrapped
                ? [
                    { api: 'vulkan', label: 'Vulkan' },
                    { api: detected.api, label: detected.label }
                  ]
                : [{ api: detected.api, label: detected.label }]
        })
      } else if (DLSS_FILE.test(name) || STREAMLINE_FILE.test(name)) {
        const item = {
          path: full,
          rel: path.relative(gameDir, full),
          name,
          version: pe.getFileVersion(full),
          bitness: pe.getBitness(full),
          depth
        }
        ;(STREAMLINE_FILE.test(name) ? streamlineFiles : dlssFiles).push(item)
      } else if (
        lower.endsWith('.addon64') ||
        lower.endsWith('.addon32') ||
        lower.endsWith('.addon')
      ) {
        addonPresent = path.relative(gameDir, full)
      }
    },
    MAX_SCAN_DEPTH,
    {
      includeContent: xboxLayout,
      maxProgramFiles: 30000,
      maxDirectories: 4096,
      maxEntries: 1000000,
      signal: options.signal
    }
  )

  // Add manifest-declared executables that could not be inspected as PE files.
  // DXGI is the safe fallback for a GDK PC title when no readable module gives
  // a stronger answer: the same ReShade hook serves DirectX 11 and DirectX 12.
  for (const declared of xboxDeclared) {
    if (!fs.existsSync(declared.path) || declared.arm64) continue
    if (
      exeCandidates.some(
        (candidate) =>
          path.resolve(candidate.path).toLowerCase() === path.resolve(declared.path).toLowerCase()
      )
    ) {
      const candidate = exeCandidates.find(
        (item) =>
          path.resolve(item.path).toLowerCase() === path.resolve(declared.path).toLowerCase()
      )
      candidate.declared = true
      continue
    }
    let size = 0
    try {
      size = fs.statSync(declared.path).size
    } catch {
      /* Preserve upstream optional-file / best-effort fallback semantics. */
    }
    const detected = detectApi(declared.path, pe.getImports(declared.path)) || {
      api: 'dxgi',
      label: 'DirectX 11/12',
      via: 'MicrosoftGame.config'
    }
    exeCandidates.push({
      ...declared,
      size,
      depth: declared.rel.split(path.sep).length - 1,
      api: detected.api,
      apiLabel: detected.label,
      via: detected.via,
      dynamic: true,
      bitness: pe.getBitness(declared.path) || declared.bitness || 64,
      declared: true,
      encrypted: pe.getBitness(declared.path) === null,
      dx12: detected.label === 'DirectX 12'
    })
  }

  // Order display fallbacks and merge duplicate paths. Recommendation below
  // uses executable identity, not this size/depth ordering.
  exeCandidates.sort(
    (a, b) =>
      (b.emulator ? 1 : 0) - (a.emulator ? 1 : 0) ||
      (b.declared ? 1 : 0) - (a.declared ? 1 : 0) ||
      playableRoleScore(b) - playableRoleScore(a) ||
      a.depth - b.depth ||
      b.size - a.size
  )
  const seenNames = new Set()
  const unique = []
  for (const exe of exeCandidates) {
    const key = path.resolve(exe.path).toLowerCase()
    if (seenNames.has(key)) continue
    seenNames.add(key)
    unique.push(exe)
  }
  exeCandidates.length = 0
  exeCandidates.push(...unique)

  // Executables that named no API at all. Protected builds, script extenders
  // and launchers that start the real engine resolve Direct3D in a way that
  // leaves no import and no string behind, and dropping them silently is what
  // "no 3D executable" and "my game's exe is not in the list" come from.
  //
  // They are offered only once the folder is already known to be a game -
  // either something else named an API, or the folder ships DLSS/Streamline -
  // so an ordinary folder of tools is still not a game. The renderer is left
  // unknown rather than guessed; the person picks it with the API override.
  const isGameFolder =
    exeCandidates.length > 0 ||
    dlssFiles.length > 0 ||
    streamlineFiles.length > 0 ||
    undetectedExes.some((exe) => exe.bootstrapTarget || engineFor(gameDir, exe))
  if (isGameFolder && undetectedExes.length) {
    const offered = []
    for (const exe of [...undetectedExes].sort(
      (a, b) => playableRoleScore(b) - playableRoleScore(a) || a.depth - b.depth || b.size - a.size
    )) {
      const key = path.resolve(exe.path).toLowerCase()
      if (seenNames.has(key) || offered.length >= UNDETECTED_LIMIT) continue
      seenNames.add(key)
      offered.push({
        ...exe,
        api: null,
        apiLabel: null,
        via: 'undetected',
        dynamic: true,
        dx12: false,
        emulator: null,
        apiChoices: []
      })
    }
    // Always after the ones that did name an API, so the automatic choice is
    // never taken away from a game that was being detected correctly.
    exeCandidates.push(...offered)
  }

  // 推荐集合只负责自动选择；所有实际扫描到的有效 EXE 另供用户手动选择。
  const discoveredByPath = new Map()
  for (const exe of [...exeCandidates, ...undetectedExes, ...manualExes]) {
    const key = path.resolve(exe.path).toLowerCase()
    if (!discoveredByPath.has(key)) discoveredByPath.set(key, exe)
  }
  const discovered = [...discoveredByPath.values()]
  const { launchEntries } = await identifyExecutables(path.resolve(gameDir), discovered)
  // Classify every executable before lending anonymous adjacent-module evidence.
  // Keep all ambiguous entries for the manual picker instead of inventing an owner.
  for (const { exe, evidence } of await rendererBeside(gameDir, discovered)) {
    Object.assign(exe, {
      api: evidence.api,
      apiLabel: evidence.label,
      apiCandidates: evidence.candidates || [],
      evidenceFile: evidence.file,
      via: 'renderer-module:' + evidence.name,
      dynamic: true,
      dx12: evidence.label === 'DirectX 12',
      emulator: null,
      apiChoices: [{ api: evidence.api, label: evidence.label }],
      role: 'renderer',
      roleReasons: [...exe.roleReasons, 'renderer-module']
    })
  }
  // The weak/unknown fallback budget must not demote a genuine engine entry
  // discovered later into the tools-only portion of the picker.
  for (const exe of discovered)
    if (['renderer', 'engine-entry'].includes(exe.role) && !exeCandidates.includes(exe))
      exeCandidates.push(exe)
  const otherExecutables = discovered.filter(
    (exe) =>
      !exeCandidates.includes(exe) || ['helper', 'launcher', 'dedicated-server'].includes(exe.role)
  )
  exeCandidates.splice(
    0,
    exeCandidates.length,
    ...exeCandidates.filter((exe) => !otherExecutables.includes(exe))
  )
  let processRows
  const hasRuntimeLogs = [
    ...new Set([gameDir, ...exeCandidates.map((exe) => path.dirname(exe.path))])
  ].some((dir) => {
    try {
      return fs.readdirSync(dir).some((name) => /^ReShade\d*\.log$/i.test(name))
    } catch {
      return false
    }
  })
  const needsProcesses =
    exeCandidates.some((exe) => exe.engine || !exe.api) ||
    hasRuntimeLogs ||
    fs.existsSync(path.join(gameDir, 'renpy'))
  try {
    processRows =
      needsProcesses || options.processes
        ? await (options.processes || snapshotGameProcesses)(gameDir, exeCandidates[0]?.path)
        : undefined
  } catch {
    processRows = null
    /* 只读运行通道不可用时保留文件证据。 */
  }
  for (const exe of discovered) exe.processState = gameProcessState(exe.path, processRows)
  for (const exe of exeCandidates)
    exe.staticApiCandidates =
      exe.apiCandidates || (exe.api ? [{ api: exe.api, label: exe.apiLabel }] : [])
  const runtimeCandidates = options.captureCandidates ? structuredClone(discovered) : undefined
  await refreshRuntimeCandidates(path.resolve(gameDir), exeCandidates, { ...options, processRows })
  exeCandidates.sort(
    (a, b) =>
      Number(!!b.launchers?.length) - Number(!!a.launchers?.length) ||
      Number(b.role === 'renderer' || b.role === 'engine-entry') -
        Number(a.role === 'renderer' || a.role === 'engine-entry') ||
      playableRoleScore(b) - playableRoleScore(a) ||
      a.rel.localeCompare(b.rel)
  )
  const selection = selectExecutable(exeCandidates, { root: path.resolve(gameDir) })
  const chosen =
    exeCandidates.find((exe) => exe.path === selection.path) || exeCandidates[0] || null
  for (const exe of discovered) {
    if (!exeCandidates.includes(exe) && !otherExecutables.includes(exe)) otherExecutables.push(exe)
    exe.rendering ||= resolveRendering(exe)
  }
  const selectableExecutables = [...exeCandidates, ...otherExecutables]
    .filter((exe) => !exe.roleReasons?.includes('invalid-executable-target'))
    .sort(
      (a, b) =>
        Number(b.path === selection.path) - Number(a.path === selection.path) ||
        Number(['renderer', 'engine-entry'].includes(b.role)) -
          Number(['renderer', 'engine-entry'].includes(a.role)) ||
        Number(exeCandidates.includes(b)) - Number(exeCandidates.includes(a)) ||
        a.rel.localeCompare(b.rel)
    )
  const primaryDlss = selectPrimaryDlss(dlssFiles, chosen)
  // When nothing turned up, say which kind of folder this actually is instead
  // of leaving the user to guess.
  let emptyReason = null
  if (!chosen) {
    let top = []
    try {
      top = fs.readdirSync(gameDir).map((f) => f.toLowerCase())
    } catch {
      /* Preserve upstream optional-file / best-effort fallback semantics. */
    }
    const looksPacked =
      top.some((f) => /^setup\.exe$/.test(f)) &&
      top.some((f) => /\.(bin|rar|iso|zip|part\d+)$/.test(f))
    if (xboxDeclared.length || /(?:^|[\\/])windowsapps(?:[\\/]|$)/i.test(path.resolve(gameDir)))
      emptyReason = 'xbox-protected'
    else if (looksPacked) emptyReason = 'installer'
    else if (!top.some((f) => f.endsWith('.exe'))) emptyReason = 'no-exe'
    // "No 3D executable" was true and useless: it came out both for a folder
    // with no game in it and for X-Ray, Source and Source 2, whose executables
    // load a renderer with LoadLibrary and so import no Direct3D themselves
    // (#232, #199, #150). Those two need different answers, and the game's own
    // DLLs say which one this is.
    else emptyReason = rendererModule(gameDir) ? 'renderer-in-dll' : 'no-graphics-exe'
  }
  let install = null
  const activeManifest = path.join(gameDir, '_DLSS5_Backup', 'manifest.json')
  let restoreCandidate = null
  try {
    restoreCandidate = fs.existsSync(activeManifest)
      ? {
          manifest: JSON.parse(
            fs.readFileSync(safePath(gameDir, '_DLSS5_Backup/manifest.json'), 'utf8')
          ),
          recovered: false
        }
      : recoverableManifest(gameDir)
  } catch {
    /* Keep restore available for a damaged active record. */
  }
  if (restoreCandidate) {
    try {
      const data = restoreCandidate.manifest
      install = {
        route: data.route || (data.game && data.game.bitness === 32 ? 'feeder' : 'native'),
        api: data.game && data.game.api,
        apiLabel: data.game && data.game.apiLabel,
        exe: data.game && data.game.exe,
        previousReShadeRoute: data.previousReShadeRoute || null,
        optiscaler: data.route === 'optiscaler' ? data.optiscaler : null,
        components: data.components || null,
        previousConsumer: data.previousConsumer || null,
        reshadeProxy: data.reshade?.file?.replace(/\.dll$/i, '') || null,
        added: Array.isArray(data.added)
          ? data.added.filter((item) => typeof item === 'string')
          : [],
        vulkanLayer: data.vulkanLayer || null
      }
      if (install.optiscaler) {
        const exeDir = path.dirname(safePath(gameDir, data.game.exe))
        const hook = safePath(
          gameDir,
          path.relative(gameDir, path.join(exeDir, install.optiscaler.hook))
        )
        install.optiscaler.installed =
          pe.versionMentions(hook, 'OptiScaler') &&
          [
            releaseFor(install.optiscaler.version).layout.forwarder,
            'nvngx_dlssnr.dll',
            'OptiScaler.ini'
          ]
            .filter(Boolean)
            .every((name) => fs.existsSync(path.join(exeDir, name)))
      }
    } catch {
      /* Preserve upstream optional-file / best-effort fallback semantics. */
    }
  }
  let reshade = chosen ? inspectReShade(path.dirname(chosen.path)) : inspectReShade(gameDir)
  if (
    !reshade.installed &&
    install &&
    install.vulkanLayer &&
    fs.existsSync(install.vulkanLayer.manifest || '')
  ) {
    reshade = {
      installed: true,
      file: 'Vulkan layer',
      kind: 'vulkan-layer',
      version: '6.8.0',
      addonSupport: true
    }
  }

  return {
    gameDir,
    gameName: path.basename(gameDir),
    exeCandidates,
    selectableExecutables,
    chosen,
    selection,
    launchEntries,
    ...(runtimeCandidates ? { runtimeCandidates } : {}),
    otherExecutables,
    emulator: chosen ? chosen.emulator : null,
    dlssFiles,
    primaryDlss,
    streamlineFiles,
    addonPresent,
    emptyReason,
    reshade,
    install,
    hasBackup: fs.existsSync(activeManifest) || !!restoreCandidate,
    recoverableBackup: !!restoreCandidate?.recovered
  }
}

// Validates the folder holding the new DLSS 5 payload (streamline\ + addon).
function scanSource(sourceDir) {
  const streamlineDir = fs.existsSync(path.join(sourceDir, 'streamline'))
    ? path.join(sourceDir, 'streamline')
    : sourceDir

  let files = []
  try {
    files = fs
      .readdirSync(streamlineDir)
      .filter((f) => DLSS_FILE.test(f) || STREAMLINE_FILE.test(f))
  } catch {
    return { ok: false, reason: 'sourceMissing' }
  }

  // The native route's consumer, chosen by name. It used to be "the first
  // .addon64 in the folder", and 2.2.5 shipped the multipass consumer,
  // renodx-dlss.addon64, at the root where it sorts ahead of
  // renodx-dlss5.addon64 - so every native install became a multipass one. The
  // multipass file is never this: it has its own route and its own path.
  const feederDir = path.join(sourceDir, 'feeder')
  let addon = null
  for (const dir of [sourceDir, streamlineDir]) {
    try {
      const files = fs
        .readdirSync(dir)
        .filter((f) => /\.addon64$/i.test(f) && !/^renodx-dlss\.addon64$/i.test(f))
      const found = files.find((f) => /^renodx-dlss5\.addon64$/i.test(f)) || files[0]
      if (found) {
        addon = path.join(dir, found)
        break
      }
    } catch {
      /* Preserve upstream optional-file / best-effort fallback semantics. */
    }
  }
  // A 2.2.5 payload carries only the multipass file at its root. The ordinary
  // consumer is still there: the same verified file the Feeder route installs.
  const hostConsumer = path.join(feederDir, 'host64', 'renodx-dlss5.addon64')
  if (!addon && fs.existsSync(hostConsumer)) addon = hostConsumer

  const payload = files.map((name) => ({
    name,
    path: path.join(streamlineDir, name),
    version: pe.getFileVersion(path.join(streamlineDir, name))
  }))

  const nr = payload.find((f) => /^nvngx_dlssnr\.dll$/i.test(f.name))
  const feeder = {
    version: feederRelease.version,
    addon64: path.join(feederDir, 'dlss5-feed.addon64'),
    addon32: path.join(feederDir, 'dlss5-feed.addon32'),
    host64: path.join(feederDir, 'dlss5-feed-host64.exe'),
    feedShader: path.join(feederDir, 'reshade-shaders', 'Shaders', 'DLSS5_Feed.fx'),
    shaderRoot: path.join(feederDir, 'reshade-shaders'),
    hostAddon: path.join(feederDir, 'host64', 'renodx-dlss5.addon64'),
    // ShortFuse's DLSS Tool build, carrying the multipass control (#251).
    // Optional: a payload built without it simply does not offer the route.
    multipassAddon: path.join(feederDir, 'host64', 'renodx-dlss.addon64'),
    dgVoodooDir: path.join(feederDir, 'dgvoodoo'),
    vulkanLayerDir: path.join(sourceDir, 'reshade-vulkan'),
    // Feeder's interop layer, one folder per architecture, copied beside a
    // Vulkan game so it can be launched with the layer when needed.
    feedLayer64: path.join(feederDir, 'layer-x64'),
    feedLayer32: path.join(feederDir, 'layer-x86')
  }
  feeder.releaseVerified = Object.entries(feederRelease.hashes).every(([rel, expected]) => {
    try {
      return (
        crypto
          .createHash('sha256')
          .update(fs.readFileSync(path.join(feederDir, rel)))
          .digest('hex') === expected
      )
    } catch {
      return false
    }
  })
  feeder.ok32 = [feeder.addon32, feeder.host64, feeder.feedShader, feeder.hostAddon]
    .concat([
      path.join(feeder.shaderRoot, 'Shaders', 'vort_Motion.fx'),
      path.join(feeder.shaderRoot, 'Shaders', 'ReShade.fxh'),
      path.join(feeder.shaderRoot, 'Shaders', 'ReShadeUI.fxh'),
      path.join(feeder.shaderRoot, 'Shaders', 'Includes', 'vort_Defs.fxh'),
      path.join(feeder.shaderRoot, 'Textures', 'vort_BlueNoise.png')
    ])
    .every((file) => fs.existsSync(file))
  feeder.ok64 = [feeder.addon64, feeder.feedShader, feeder.hostAddon]
    .concat([
      path.join(feeder.shaderRoot, 'Shaders', 'vort_Motion.fx'),
      path.join(feeder.shaderRoot, 'Shaders', 'ReShade.fxh'),
      path.join(feeder.shaderRoot, 'Shaders', 'ReShadeUI.fxh')
    ])
    .every((file) => fs.existsSync(file))
  feeder.vulkanOk = ['ReShade64.dll', 'ReShade64.json', 'ReShade32.dll', 'ReShade32.json'].every(
    (name) => fs.existsSync(path.join(feeder.vulkanLayerDir, name))
  )
  feeder.ok32 = feeder.ok32 && feeder.releaseVerified
  feeder.ok64 = feeder.ok64 && feeder.releaseVerified
  feeder.ok = feeder.ok32 && feeder.ok64
  return {
    ok: payload.length > 0,
    reason: payload.length ? null : 'sourceEmpty',
    dir: streamlineDir,
    addon,
    payload,
    // The add-on refuses to run without nvngx_dlssnr.dll beside it.
    hasNeuralRendering: Boolean(nr),
    feeder,
    dlssVersion: (payload.find((f) => /^nvngx_dlss\.dll$/i.test(f.name)) || {}).version || null
  }
}

export {
  scanGame,
  scanSource,
  walk,
  selectPrimaryDlss,
  xboxExecutables,
  playableRoleScore,
  inspectReShade,
  isVulkanWrapper,
  vulkanWrapperBeside,
  gameApiProfile,
  rdr2Renderer,
  rdr2SettingsFiles
}
export default {
  scanGame,
  scanSource,
  walk,
  selectPrimaryDlss,
  xboxExecutables,
  playableRoleScore,
  inspectReShade,
  isVulkanWrapper,
  vulkanWrapperBeside,
  gameApiProfile,
  rdr2Renderer,
  rdr2SettingsFiles
}
