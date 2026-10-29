import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileHash, safeJoin, fail } from './files.js'
import { sessionConfiguration } from './configuration.js'

export async function prepareFileInstall(record, plan, assets) {
  const root = path.dirname(record.exePath)
  const files = (await assets.files(plan.components))
    // Vulkan layers have no role in a DirectX directory installation.
    .filter((file) => file.target !== 'VkLayer_feed_vk.dll')
    .map((file) => ({
      ...file,
      target: file.target === 'ReShade64.dll' ? 'dxgi.dll' : file.target
    }))
  files.push(
    ...sessionConfiguration({
      feeder: plan.backend === 'feeder',
      api: plan.api,
      profile: record.profile
    })
  )
  const targets = new Set(files.map((file) => file.target.toLowerCase()))
  for (const conflict of plan.existingLoaders || []) {
    const relative = path.relative(root, path.resolve(record.gameRoot, conflict))
    if (path.dirname(relative) !== '.' || !relative)
      fail('invalid_conflict_path', '已有加载器必须位于实际 EXE 所在目录')
    if (targets.has(relative.toLowerCase())) continue
    targets.add(relative.toLowerCase())
    files.unshift({ target: relative, component: 'previous-loader', operation: 'disable' })
  }
  // Activate the proxy last; restoring in reverse order removes it first.
  files.sort((a, b) => Number(a.target === 'dxgi.dll') - Number(b.target === 'dxgi.dll'))
  for (const file of files)
    file.expectedBeforeHash = await fileHash(await safeJoin(root, file.target))
  const token = createHash('sha256')
    .update(
      JSON.stringify({
        root,
        config: record.config,
        fingerprint: record.inspection.fingerprint.sha256,
        consent: plan.consentCodes,
        files: files.map((file) => [
          file.target,
          file.operation || 'write',
          file.expectedBeforeHash,
          file.sha256 || file.content
        ])
      })
    )
    .digest('hex')
  return {
    root,
    files,
    token,
    public: {
      directory: root,
      token,
      consentCodes: plan.consentCodes,
      warnings: plan.warnings
        .filter((item) => item.severity === 'consent')
        .map((item) => item.message),
      files: files.map((file) => ({
        path: file.target,
        action:
          file.operation === 'disable'
            ? 'backup-disable'
            : file.expectedBeforeHash
              ? 'backup-replace'
              : 'add'
      }))
    }
  }
}
