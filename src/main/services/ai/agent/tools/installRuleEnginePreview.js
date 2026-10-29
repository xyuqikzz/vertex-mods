import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { inspectSourceInstallPlanByEngine } from '../../../../ipc/game/install-engine/index.js'
import { compileInstallRule } from '../../../../ipc/game/install-engine/compiler.js'
import { assertToolExecutionActive } from './toolAbortUtils.js'

// The planner may materialize nested archives and route sources. Keep these writes in
// disposable storage; never turn a diagnostic preview into a live deployment.
export async function previewInstallRuleWithEngine(payload = {}, ctx = {}) {
  assertToolExecutionActive(ctx.signal)
  let scratch
  try {
    for (const [key, code] of [
      ['stagingPath', 'staging'],
      ['gameRoot', 'game_root']
    ]) {
      if (key === 'stagingPath' && payload.archivePath) continue
      if (!payload[key])
        return {
          success: false,
          matched: false,
          errorCode: `missing_${code}_path`,
          message: `缺少 ${key}。`
        }
      if (!(await fs.stat(payload[key])).isDirectory()) throw new Error(`${key} 必须是目录`)
    }
    const compiled = compileInstallRule(payload.ruleJson)
    if (compiled.schemaDiagnostics?.errors?.length) {
      return {
        success: false,
        matched: false,
        errorCode: 'install_engine.schema_invalid',
        diagnostics: compiled.schemaDiagnostics.errors,
        message: '规则校验失败，请按字段诊断修正。'
      }
    }
    scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'vertex-agent-rule-preview-'))
    const stagingPath = path.join(scratch, 'package')
    let count = 0
    const started = Date.now()
    if (payload.archivePath) {
      const { extractArchiveByNodeApi } = await import('../../../../api/file/index.js')
      await fs.mkdir(stagingPath)
      const extraction = await extractArchiveByNodeApi(payload.archivePath, stagingPath)
      if (extraction?.success === false) throw new Error(extraction.message || '压缩包解包失败')
    } else
      await fs.cp(payload.stagingPath, stagingPath, {
        recursive: true,
        preserveTimestamps: true,
        filter: async (source) => {
          assertToolExecutionActive(ctx.signal)
          if (++count > 60000 || Date.now() - started > 30000)
            throw Object.assign(
              new Error('预演副本超过条目或时间预算，请通过安装任务中心预检该包。'),
              { code: 'preview_budget_exceeded' }
            )
          if (/^__vertex_/i.test(path.basename(source))) return false
          if ((await fs.lstat(source)).isSymbolicLink())
            throw Object.assign(new Error('预演包包含符号链接，不能作为安装证据。'), {
              code: 'install_engine.path_unsafe'
            })
          return true
        }
      })
    const plan = await inspectSourceInstallPlanByEngine({
      stagingPath,
      gameRoot: payload.gameRoot,
      packageFolderName: payload.packageFolderName,
      source: payload.source || 'local',
      installRule: payload.ruleJson,
      data: {
        ...payload.data,
        ...(payload.installChoices ? { installChoices: payload.installChoices } : {})
      },
      installedCapabilities: payload.installedCapabilities,
      managedConfigContext: payload.managedConfigContext
    })
    assertToolExecutionActive(ctx.signal)
    if (!plan)
      return {
        success: true,
        matched: false,
        message: '当前规则或事实条件未匹配；请检查包结构、条件及能力声明。',
        diagnostics: compiled.schemaDiagnostics
      }
    const operations = (plan.operations || []).filter((item) => item.kind === 'file')
    const offset = Math.max(0, Math.trunc(Number(payload.offset) || 0))
    const limit = Math.max(1, Math.min(200, Number(payload.maxResults) || 50))
    return {
      success: true,
      matched: true,
      engineVersion: plan.engineVersion,
      selected: {
        ruleId: plan.ruleId || plan.explain?.matchedRuleId,
        matched: true,
        reason: '统一引擎已完成规划',
        target: { targetRelativePath: plan.targetRelativePath, targetBaseType: plan.targetBaseType }
      },
      mappings: operations
        .slice(offset, offset + limit)
        .map((item) => ({
          source:
            item.sourceRelativePath ||
            path.relative(stagingPath, item.sourcePath || '').replace(/\\/g, '/'),
          target: item.relativeTargetPath,
          operation: item.operation || item.action,
          routeId: item.routeId
        })),
      summary: {
        total: operations.length,
        offset,
        returned: Math.min(limit, Math.max(0, operations.length - offset)),
        nextOffset: offset + limit < operations.length ? offset + limit : null,
        truncated: operations.length > offset + limit
      },
      coverage: plan.coverageSummary,
      unhandledFiles: (plan.coverageLedger || [])
        .filter((item) => item.status === 'unmatched')
        .map((item) => item.sourceRelativePath),
      dependencyResult: plan.dependencyResult,
      conflictResult: plan.conflictResult,
      diagnostics: compiled.schemaDiagnostics,
      explain: plan.explain,
      components: plan.replayContext?.declarative?.selected,
      configChanges: plan.replayContext?.declarative?.config || [],
      configEvidence: plan.replayContext?.declarative?.configEvidence || [],
      message: '统一引擎规划完成；尚未安装。实际安装仍需任务中心预检、事务执行及写后核验。'
    }
  } catch (error) {
    if (error.name === 'AbortError') throw error
    return {
      success: false,
      matched: false,
      errorCode: error.code || 'install_rule_preview_failed',
      message: error.message,
      selectionRequest: error.detail?.selectionRequest,
      dependencyResult: error.detail?.dependencyResult,
      unhandledFiles: error.detail?.files,
      diagnostics: error.detail || {}
    }
  } finally {
    if (scratch) await fs.rm(scratch, { recursive: true, force: true })
  }
}
