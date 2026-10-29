import { deploymentRevision } from '../../../shared/dlss-swapper/deployment-version.js'
import { effectiveReShadeProxy } from '../../../shared/dlss-swapper/reshade-proxy.js'
// Installation orchestration from DLSS5-Swapper 2.2.7 main.js (MIT).
// Copyright (c) 2026 Rakan Alkhaldi. The independent F8 overlay UI belongs to its own feature.
import fs from 'node:fs'
import path from 'node:path'
import { scanGame } from './swapper/scan.js'
import guards from './swapper/install-guards.js'
import compatibility from './swapper/compatibility.js'
import backends from './swapper/backend-manager.js'
import journal from './swapper/file-journal.js'
import optiscaler from './swapper/optiscaler.js'
import vulkanLayer from './swapper/vulkan-layer.js'
import { ensureLumenite, ensureDgVoodoo, missingVCRuntime } from './swapper/runtime-components.js'
import installRoutes from '../../../shared/dlss-swapper/install-routes.js'
import renderingApi from '../../../shared/dlss-swapper/rendering-api.js'
import antiCheatWarning from '../../../shared/dlss-swapper/anti-cheat-warning.js'
import { steam } from './swapper/library.js'
import { contextForSteamGame, createSetupRunner } from './swapper/proton.js'
import { planConsumer } from './consumer-components.js'
import { hashFile } from './files.js'
import { componentProgress } from './progress.js'

export function createSwapperInstaller({
  root,
  scan: inspectGame = scanGame,
  payload,
  dialog,
  shell,
  win,
  featureText,
  saveOperation,
  history,
  loadState,
  apiPreference,
  companionAddons,
  exclusiveMutation,
  gameName,
  consumerPreference = () => ({ consumerVersion: 'auto' }),
  validateTarget = () => {}
}) {
  const handlers = new Map()
  const ipcMain = { handle: (name, handler) => handlers.set(name, handler) }
  const app = { getPath: () => root }
  const payloadMissing = () => ({ message: '组件包尚未准备' })
  const componentCode = (error, fallback) =>
    error?.code === 'componentRemoved' ? 'componentQuarantined' : fallback
  ipcMain.handle('install', (event, dir, exePath, requestedRoute, requestedApi) =>
    exclusiveMutation(async () => {
      await guards.assertGameClosed(dir, exePath)
      const prepared = await payload(event)
      if (!prepared) return { ok: false, ...payloadMissing() }
      const p = { ...prepared }
      // Scan after component preparation so EXE/log changes during a download
      // are validated before choosing a route or writing any game files.
      const scan = await inspectGame(dir)
      if (!scan.chosen && !exePath) return { ok: false, message: 'No game executable found' }
      if (!exePath && scan.selection?.state === 'needs-choice')
        return {
          ok: false,
          code: 'choose_executable',
          message: '发现多个游戏入口，请先选择实际游戏程序。'
        }

      // Honour the sheet's choice, but only if it is one of the candidates we
      // actually found - never patch a path the renderer made up.
      const detected = exePath
        ? (scan.selectableExecutables || scan.exeCandidates).find(
            (e) => path.resolve(e.path).toLowerCase() === path.resolve(exePath).toLowerCase()
          )
        : scan.chosen
      if (!detected)
        return {
          ok: false,
          code: 'choose_executable',
          message: '所选程序已变化，请重新扫描并选择游戏程序。'
        }
      validateTarget(detected)
      const selection = requestedApi ?? apiPreference(loadState(), dir, detected.path)
      const target = renderingApi.effective({ ...detected, manualSelection: !!exePath }, selection)
      compatibility.assertSafeTarget(dir, target.path)
      target.hasNativeDlss = installRoutes.nativeDlssPresent(scan, detected)
      const api = target.api
      const availableRoutes = installRoutes.routesFor(target, api)
      const routeError = installRoutes.routeError(target, requestedRoute)
      if (routeError) return { ok: false, code: routeError }
      const recommendedRoute = installRoutes.recommendedRoute(scan, target)
      const route = availableRoutes.includes(requestedRoute)
        ? requestedRoute
        : availableRoutes.includes(recommendedRoute)
          ? recommendedRoute
          : availableRoutes[0]

      // ReShade Setup is a Windows executable. On Linux, support Windows games
      // launched with Steam Play by using their existing Proton prefix; native
      // Linux games do not load the Windows DLSS/ReShade payload.
      const protonGame =
        process.platform === 'linux'
          ? steam().find((game) => path.resolve(game.dir) === path.resolve(dir))
          : null
      const proton = contextForSteamGame(protonGame)
      if (process.platform === 'linux' && !proton) {
        return {
          ok: false,
          code: 'errProtonRequired',
          message:
            'This installer supports Windows games launched through Steam Proton. Launch the game once with Proton, then try again.'
        }
      }
      if (process.platform === 'linux' && api === 'vulkan') {
        return {
          ok: false,
          code: 'errLinuxVulkanUnsupported',
          message:
            'The Vulkan Feeder route needs a host Vulkan layer and is not supported on Linux yet. Select a DirectX renderer in the game.'
        }
      }

      const send = (e) => event.sender.send('job', e)
      // Component preparation may download/extract for a while. The user can
      // relaunch the game meanwhile, so the early preflight cannot cover writes.
      await guards.assertGameClosed(dir, target.path)
      const preference = consumerPreference(detected.path)
      const { plan: consumerPlan } = await planConsumer(
        dir,
        target,
        route,
        preference.consumerVersion
      )
      if (consumerPlan?.blocked) return { ok: false, code: consumerPlan.blocked }
      if (
        consumerPlan &&
        preference.consumerPlan &&
        (preference.consumerPlan.sha256 !== consumerPlan.sha256 ||
          preference.consumerPlan.api !== api ||
          preference.consumerPlan.route !== route)
      )
        return { ok: false, code: 'component_plan_changed' }
      if (consumerPlan) {
        const file =
          p.consumers?.[consumerPlan.version] ||
          (route === 'feeder' ? p.source?.feeder?.hostAddon : p.source?.addon)
        if (!file || (await hashFile(file)) !== consumerPlan.sha256)
          return { ok: false, code: 'consumer_not_ready' }
        p.source = { ...p.source, addon: file, feeder: { ...p.source.feeder, hostAddon: file } }
      }
      if (fs.existsSync(journal.pendingPath(dir))) return { ok: false, code: 'errBackendRecovery' }
      const old = backends.readManifest(dir)
      const changed =
        old &&
        (old.route !== route ||
          old.game.api !== api ||
          old.game.exe.toLowerCase() !== target.rel.toLowerCase())
      if (changed && (old.game.api === 'vulkan' || api === 'vulkan'))
        return { ok: false, code: 'errBackendVulkanSwitch' }
      let antiCheatAcknowledged = false
      if (compatibility.hasAntiCheat(dir, target.path)) {
        const answer = await dialog.showMessageBox(
          win,
          antiCheatWarning.dialogOptions(loadState().lang, dir, target.path)
        )
        if (answer.response !== 1) return { ok: false, cancelled: true }
        antiCheatAcknowledged = true
        send({ code: 'antiCheatRiskAccepted', params: {} })
      }
      // The ReShade and Feeder routes both drive the RenoDX neural consumer, which
      // upstream has measured faulting inside NVIDIA's runtime on a known driver
      // range. Say so before the work starts; it never stops the install.
      if (route === 'native' || route === 'feeder') {
        // Advice only: nothing about reading the driver may decide whether an
        // install runs.
        try {
          const rows = await guards.gpuInfo()
          if (guards.driverNeuralFault(rows, consumerPlan?.sha256))
            send({ code: 'driverNeuralFault', params: { gpu: guards.driverNames(rows) } })
        } catch {
          /* Driver advice must not prevent an otherwise valid installation. */
        }
      }

      let optiRoot = null
      let optiVersion = null
      if (route === 'optiscaler') {
        optiscaler.checkConflicts(dir, target.path, old, api)
        if (api === 'vulkan' && (await vulkanLayer.existing(vulkanLayer.defaultRunner)))
          return { ok: false, code: 'errOptiVulkanLayer' }
        const gpu = await guards.gpuInfo()
        // Neither the card nor the driver is refused outright any more. Upstream
        // 0.2.0 says plainly that architectures older than Blackwell work with a
        // modded nvngx_dlssnr.dll, which the person supplies themselves - so this
        // is their decision to make, with both facts in front of them.
        const oldCard = gpu ? !guards.gpuModelSupported(gpu) : false
        const oldDriver = gpu ? !guards.driverSupported(gpu) : false
        const confirmation = await dialog.showMessageBox(win, {
          type: 'warning',
          title: 'OptiScaler DLSS-NR',
          message: featureText('optiConfirm'),
          detail: [
            gpu
              ? gpu.map((g) => `${g.name} — ${g.driver}`).join('\n')
              : featureText('errOptiHardware'),
            oldCard ? featureText('optiCardOld') : null,
            oldDriver ? featureText('optiDriverOld') : null,
            featureText('optiHint'),
            featureText('optiBridgeHint'),
            featureText('backendHint')
          ]
            .filter(Boolean)
            .join('\n\n'),
          buttons: [featureText('installOpti'), featureText('cancel')],
          defaultId: 1,
          cancelId: 1
        })
        if (confirmation.response !== 0) return { ok: false, cancelled: true }
        const missing = missingVCRuntime(64, path.dirname(target.path), process.env.SystemRoot, [
          'msvcp140_atomic_wait.dll'
        ])
        if (missing.length)
          return { ok: false, code: 'runtimeRequiredHint', message: missing.join(', ') }
        send({ code: 'optiDownloading', params: {} })
        // A game may name an older pinned build. #238: No Man's Sky runs on
        // 0.1.1.5 and crashes on 0.2.0-patch1, and until now the only way back was
        // to keep an old copy of the whole app.
        const wanted = (loadState().optiscalerVersion || {})[path.resolve(dir).toLowerCase()]
        const release = optiscaler.releaseFor(wanted)
        optiVersion = release.version
        try {
          optiRoot = await optiscaler.ensureOptiScaler(
            app.getPath('userData'),
            release.version,
            componentProgress(send, {})
          )
        } catch (err) {
          return { ok: false, code: componentCode(err, 'errOptiDownload'), message: err.message }
        }
        send({ code: 'optiVerified', params: { version: release.version } })
      }

      // Check before restoring or touching the game: these DLLs are imported by
      // Feeder and its helper. Never report a working installation if absent.
      if (route === 'feeder') {
        if (
          !p.source.feeder ||
          !(target.bitness === 32 ? p.source.feeder.ok32 : p.source.feeder.ok64)
        ) {
          return {
            ok: false,
            message:
              'Feeder payload is incomplete or from mixed releases. Reinstall the updated Swapper package.'
          }
        }
        const checks = [[target.bitness, path.dirname(target.path)]]
        if (target.bitness === 32) checks.push([64, path.join(path.dirname(target.path), 'host64')])
        for (const [bits, folder] of checks) {
          const missing = missingVCRuntime(bits, folder)
          if (missing.length) {
            const response = await dialog.showMessageBox(win, {
              type: 'warning',
              title: 'Microsoft Visual C++ Runtime',
              message: featureText('runtimeRequiredHint'),
              detail: `${bits === 32 ? 'x86' : 'x64'}\n${missing.join(', ')}\n${folder}`,
              buttons: [featureText('runtimeDownload'), featureText('cancel')],
              cancelId: 1,
              defaultId: 0
            })
            if (response.response === 0)
              await shell.openExternal(
                `https://aka.ms/vc14/vc_redist.${bits === 32 ? 'x86' : 'x64'}.exe`
              )
            return { ok: false, code: 'runtimeRequiredHint' }
          }
        }
        // DirectDraw goes through dgVoodoo exactly as DX8 and DX9 do - apply.js
        // refuses a ddraw install without it - and it was never downloaded for one,
        // so every DirectDraw install failed with errDgVoodooMissing (#292, #279).
        if (api === 'd3d8' || api === 'd3d9' || api === 'ddraw') {
          try {
            p.source.feeder.dgVoodooDir = await ensureDgVoodoo(
              app.getPath('userData'),
              componentProgress(send, {})
            )
            send({ code: 'legacyWrapperReady', params: { api, bitness: target.bitness } })
          } catch (error) {
            return {
              ok: false,
              code: componentCode(error, 'legacyDownloadHint'),
              message: error.message
            }
          }
        }
      }

      if (route === 'feeder') {
        try {
          send({ code: 'motionProviderDownloading', params: {} })
          p.source.feeder.lumeniteRoot = await ensureLumenite(
            app.getPath('userData'),
            componentProgress(send, {})
          )
          send({ code: 'motionProviderReady', params: { provider: 'LumeniteFX Kernel 2.0' } })
        } catch (err) {
          // VORT is bundled under MIT as an offline fallback. The install remains
          // usable even when GitHub is unavailable.
          p.source.feeder.lumeniteRoot = null
          send({ code: 'motionProviderFallback', params: { error: err.message } })
          send({
            code: 'componentProgress',
            params: {
              phase: 'fallback',
              name: 'LumeniteFX',
              message: '可选组件 LumeniteFX 未能准备，已改用内置运动估计组件。'
            }
          })
        }
      }

      // Only user-selected companion builds are installed. Leave unrelated
      // add-ons alone; all managed copies now participate in the transaction.
      const companions = route === 'native' && target.bitness === 64 ? companionAddons() : []

      try {
        // A game could have been launched while the component download ran.
        await guards.assertGameClosed(dir, target.path)
        send({ code: 'componentProgress', params: { phase: 'installing', name: 'DLSS5' } })
        // Preserve the previous snapshot before a repeat install changes it.
        history().list([{ dir, name: gameName(dir) }], (error) =>
          send({ code: 'historySaveWarning', params: { error: error.message } })
        )
        const manifest = await backends.install(
          {
            gameDir: dir,
            exePath: target.path,
            api,
            apiLabel: target.apiLabel,
            bitness: target.bitness,
            route,
            reshadeProxy: effectiveReShadeProxy(target, route, preference.reshadeProxy),
            antiCheatAcknowledged,
            emulator: target.emulator,
            source: p.source,
            componentPlan: {
              revision: deploymentRevision,
              consumer: consumerPlan && {
                ...consumerPlan,
                file: path.relative(
                  dir,
                  path.join(
                    path.dirname(target.path),
                    target.bitness === 32 ? 'host64' : '',
                    'renodx-dlss5.addon64'
                  )
                )
              },
              dependencies: (p.components || []).filter(
                (c) =>
                  route !== 'optiscaler' &&
                  (['reshade', 'sr', 'nr-legacy'].includes(c.id) ||
                    (c.id === 'feeder' && route === 'feeder') ||
                    (['renodx-sf', 'streamline'].includes(c.id) && route === 'renodx'))
              )
            },
            optiRoot,
            optiVersion,
            companions,
            reshadeSetup: p.reshadeSetup,
            setupRunner: proton ? createSetupRunner(proton) : undefined,
            vulkanLayerTarget: path.join(app.getPath('userData'), 'reshade-vulkan'),
            installReShade: true,
            addMissingDlss: true,
            addStreamline: false,
            upgradeReShade: false
          },
          send
        )
        saveOperation(dir, manifest, 'install', send)
        return { ok: true, replaced: manifest.replaced.length, added: manifest.added.length }
      } catch (err) {
        return { ok: false, code: err.code, message: err.message }
      }
    })
  )

  ipcMain.handle('restore', (event, dir) =>
    exclusiveMutation(async () => {
      let restoredManifest = null
      const send = (e) => {
        if (e.code === 'restoreDone') restoredManifest = e.params
        event.sender.send('job', e)
      }
      try {
        let old = null
        try {
          old = backends.readManifest(dir)
        } catch (error) {
          if (!fs.existsSync(journal.pendingPath(dir))) throw error
        }
        // Recovery belongs to the manifest/journal, not the graphics scanner.
        // A missing/updated/unrecognised executable must not strand our hooks.
        if (!old && !fs.existsSync(journal.pendingPath(dir)))
          return { ok: false, code: 'errNoBackup' }
        const exe = old ? journal.safePath(dir, old.game.exe) : null
        await guards.assertGameClosed(dir, exe)
        history().list([{ dir, name: gameName(dir) }], (error) =>
          send({ code: 'historySaveWarning', params: { error: error.message } })
        )
        if (!(await backends.restore(dir, send))) return { ok: false, code: 'errNoBackup' }
        saveOperation(dir, restoredManifest || {}, restoredManifest ? 'restore' : 'recovery', send)
        return { ok: true }
      } catch (err) {
        return { ok: false, code: err.code, message: err.message }
      }
    })
  )

  return Object.fromEntries(handlers)
}
