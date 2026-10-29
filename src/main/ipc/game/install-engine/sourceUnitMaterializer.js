import fs from 'fs-extra'
import path from 'path'
import { randomUUID } from 'node:crypto'
import { collectDirectorySnapshot } from './fsSnapshot.js'
import { isRealPathInside, resolveSafeRelativeChildPath } from './pathSafety.js'
import { InstallEngineError, INSTALL_ENGINE_ERROR_CODES } from './installEngineError.js'

const isInternalEntry = (entry) => /^__vertex_(?:install_plan_v3|install_rule|nexus_rule)__(?:\/|$)/i.test(entry.relativePath.replace(/\\/g, '/'))

// 只在引擎私有暂存区生成部署树，原始解包内容保持不变。
// 生成的标记文件与其他文件使用同一部署、归属、更新和卸载流程。
export async function materializeSourceUnits(units, sourceRule, stagingPath, context) {
  const container = resolveSafeRelativeChildPath(
    stagingPath,
    '__vertex_install_plan_v3__/units'
  ).fullPath
  if (!isRealPathInside(stagingPath, container)) {
    throw new InstallEngineError(INSTALL_ENGINE_ERROR_CODES.PATH_UNSAFE, '安装单元暂存目录不安全')
  }
  const root = path.join(container, randomUUID())
  await fs.ensureDir(root)
  const occupied = new Set()
  const unitNames = new Set()
  const snapshots = []
  try {
    for (const unit of units) {
      const prefix = unit.preserveSourceRootName || ''
      const unitId = (prefix || path.basename(unit.sourceRoot)).toLowerCase()
      if (unitNames.has(unitId)) throw new InstallEngineError(INSTALL_ENGINE_ERROR_CODES.RULE_SOURCE_AMBIGUOUS, '多个安装单元名称相同，无法确定独立归属')
      unitNames.add(unitId)
      const unitRoot = prefix ? resolveSafeRelativeChildPath(root, prefix).fullPath : root
      await fs.ensureDir(unitRoot)
      const original = await collectDirectorySnapshot(
        unit.sourceRoot,
        context.snapshotCache || new Map(),
        { boundaryRoot: unit.sourceRoot }
      )
      for (const entry of original.allFiles || []) {
        if (isInternalEntry(entry)) continue
        const target = resolveSafeRelativeChildPath(unitRoot, entry.relativePath).fullPath
        const key = target.toLowerCase()
        if (occupied.has(key)) {
          throw new InstallEngineError(
            INSTALL_ENGINE_ERROR_CODES.RULE_SOURCE_AMBIGUOUS,
            '多个安装单元映射到相同文件，必须明确拆分目标'
          )
        }
        occupied.add(key)
        if (
          !isRealPathInside(unit.sourceRoot, entry.fullPath) ||
          (await fs.lstat(entry.fullPath)).isSymbolicLink()
        ) {
          throw new InstallEngineError(
            INSTALL_ENGINE_ERROR_CODES.PATH_UNSAFE,
            '安装单元源文件不安全'
          )
        }
        await fs.ensureDir(path.dirname(target))
        await fs
          .link(entry.fullPath, target)
          .catch(() =>
            fs.copy(entry.fullPath, target, {
              dereference: false,
              overwrite: false,
              errorOnExist: true
            })
          )
      }
      // 保留包内空目录，例如 PalSchema 的 mods 数据目录。
      for (const entry of original.allDirs || []) {
        if (isInternalEntry(entry)) continue
        await fs.ensureDir(resolveSafeRelativeChildPath(unitRoot, entry.relativePath).fullPath)
      }
      const generated = []
      for (const file of sourceRule.ensure_files || []) {
        if (/[<>:"|?*]/.test(file.path))
          throw new InstallEngineError(
            INSTALL_ENGINE_ERROR_CODES.PATH_UNSAFE,
            '生成文件名包含不安全字符'
          )
        const destination = resolveSafeRelativeChildPath(unitRoot, file.path).fullPath
        if (await fs.pathExists(destination)) {
          if (!(await fs.lstat(destination)).isFile())
            throw new InstallEngineError(
              INSTALL_ENGINE_ERROR_CODES.RULE_SOURCE_AMBIGUOUS,
              '生成文件的路径已被目录占用'
            )
          continue
        }
        await fs.ensureDir(path.dirname(destination))
        await fs.writeFile(destination, file.text || '', { encoding: 'utf8', flag: 'wx' })
        generated.push(file.path)
      }
      snapshots.push({
        id: prefix || path.basename(unit.sourceRoot),
        sourceRelativePath: path.relative(stagingPath, unit.sourceRoot).replace(/\\/g, '/'),
        targetPrefix: prefix,
        markerPath: unit.markerRelativePath,
        generatedFiles: generated
      })
    }
    return { sourceRoot: root, units: snapshots }
  } catch (error) {
    // root 为本次独占创建的 UUID 目录，删除前再次核对边界。
    if (isRealPathInside(container, root)) await fs.remove(root)
    throw error
  }
}
