import fs from 'node:fs/promises'
import path from 'node:path'
import { hashFile } from './files.js'
import core from './swapper/apply.js'
import journal from './swapper/file-journal.js'

const key = (value) => path.normalize(value).toLowerCase()
const allowed = (rel) =>
  path.basename(rel) === 'vertex-dlss-panel-zh.addon64' ||
  (path.basename(path.dirname(rel)) === 'vertex-dlss-licenses' &&
    ['ReShade-LICENSE.txt', 'DearImGui-LICENSE.txt'].includes(path.basename(rel)))

// Retain only the migration for existing installations. No localization binary,
// build pipeline, font modification or UI interception ships with Vertex now.
export async function retireLegacyPanel(gameDir, manifest, log = () => {}) {
  const legacy = manifest.components?.panelLocalization
  if (!legacy) return
  for (const file of legacy.files || []) {
    if (!allowed(file.path) || !/^[a-f0-9]{64}$/.test(file.sha256))
      throw Object.assign(new Error('Invalid retired component record'), {
        code: 'errBackupInvalid'
      })
    const target = journal.safePath(gameDir, file.path)
    const replacement = manifest.replaced.find((item) => key(item.rel) === key(file.path))
    const added = manifest.added.some((rel) => key(rel) === key(file.path))
    if (!replacement && !added)
      throw Object.assign(new Error('Invalid retired component ownership'), {
        code: 'errBackupInvalid'
      })
    let digest
    try {
      digest = await hashFile(target)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    if (digest === file.sha256) {
      await journal.capture(gameDir, target)
      await fs.chmod(target, 0o666)
      if (replacement) await fs.copyFile(core.originalPath(gameDir, manifest, file.path), target)
      else await fs.unlink(target)
    } else if (digest) {
      log({ code: 'retiredComponentKept', params: { rel: file.path } })
    }
    // The file is restored, absent, or now owned by the user. A later full
    // restore must not remove it using the obsolete added-file ledger.
    manifest.added = manifest.added.filter((rel) => key(rel) !== key(file.path))
    manifest.replaced = manifest.replaced.filter((item) => key(item.rel) !== key(file.path))
    manifest.deployedFiles = manifest.deployedFiles?.filter((rel) => key(rel) !== key(file.path))
  }
  delete manifest.components.panelLocalization
  await core.saveActiveManifest(gameDir, manifest)
  log({ code: 'retiredComponentRemoved', params: {} })
}
