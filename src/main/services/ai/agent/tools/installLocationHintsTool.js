import {
  SOURCE_PLATFORM_ERROR_CODES,
  assertSourceCapability,
  normalizeSourcePlatform
} from '../../../../../shared/sources/source-platform-registry.js'
import { analyzeInstallLocationEvidence } from './installLocationEvidence.js'
import { assertToolExecutionActive, isAgentToolAbortError } from './toolAbortUtils.js'

const text = (value) => String(value ?? '').trim()

export function collectInstallDetailDocuments(record = {}, source = 'mod_detail', fileId = '') {
  const fields = [
    'description',
    'description_plaintext',
    'full_description',
    'installation',
    'installInstructions',
    'readme',
    'readmeText',
    'summary'
  ]
  const documents = fields
    .filter((key) => typeof record[key] === 'string' && record[key].trim())
    .map((key) => ({ source: source + '.' + key, text: record[key] }))
  const file = record.primaryFile || record.modfile || record.selectedFile
  if (file && (!fileId || text(file.file_id || file.fileId || file.id) === text(fileId))) {
    for (const key of ['description', 'changelog', 'installation']) {
      if (typeof file[key] === 'string')
        documents.push({ source: source + '.selected_file.' + key, text: file[key] })
    }
  }
  return documents
}

export async function getInstallLocationHintsTool(args = {}, ctx = {}, deps = {}) {
  assertToolExecutionActive(ctx.signal)
  const source = normalizeSourcePlatform(args.sourcePlatform || args.source || args.businessSource)
  const capability = assertSourceCapability(source, 'installRuleConfig')
  if (!capability.ok || !['nexus', 'modio'].includes(source)) {
    return {
      success: false,
      errorCode:
        source === 'aggregate'
          ? SOURCE_PLATFORM_ERROR_CODES.INVALID_AGGREGATE_SOURCE
          : capability.errorCode || SOURCE_PLATFORM_ERROR_CODES.SOURCE_CAPABILITY_DISABLED,
      source,
      message: '安装位置线索解析支持 Nexus / Mod.io，请提供真实业务来源。'
    }
  }

  const page = ctx.pageContext || args.context || {}
  const pageSource = normalizeSourcePlatform(
    page.businessSource || page.page?.businessSource || page.page?.source || page.game?.source
  )
  const sameSource = pageSource === source
  const modId = text(args.modId || (sameSource ? page.mod?.modId || page.mod?.id : ''))
  const domainName = text(
    args.domainName ||
      args.sourceSlug ||
      (sameSource ? page.game?.domainName || page.game?.sourceSlug || page.sourceSlug : '')
  )
  // gameId 在本工具中是 Mod.io 的来源游戏 ID，绝不能退回本地 games.id。
  const gameId = text(
    args.sourceGameId ||
      args.gameId ||
      (sameSource ? page.game?.sourceGameId || page.sourceGameId : '')
  )
  const fileId = text(args.fileId)
  const identity = {
    source,
    modId,
    ...(source === 'nexus' ? { domainName } : { gameId }),
    ...(fileId ? { fileId } : {})
  }
  const documents = ['detailText', 'description', 'readmeText', 'readme', 'installation']
    .filter((key) => typeof args[key] === 'string')
    .map((key) => ({ source: 'provided.' + key, text: args[key] }))
  const samePageMod =
    sameSource &&
    modId &&
    modId === text(page.mod?.modId || page.mod?.id) &&
    (source === 'nexus'
      ? domainName === text(page.game?.domainName || page.game?.sourceSlug || page.sourceSlug)
      : gameId === text(page.game?.sourceGameId || page.sourceGameId))
  if (samePageMod) documents.push(...collectInstallDetailDocuments(page.mod, 'page_detail', fileId))

  let detailStatus = args.fetchDetail === false ? 'not_requested' : 'missing_identity'
  const warnings = []
  if (args.fetchDetail !== false && modId && (source === 'nexus' ? domainName : gameId)) {
    try {
      const getDetail =
        deps.getModSourceDetail ||
        (await import('../../../mod-source/runtime.js')).getModSourceDetail
      const result = await getDetail(identity)
      assertToolExecutionActive(ctx.signal)
      if (result?.success && result.record) {
        const returnedId = text(result.record.modId || result.record.mod_id || result.record.id)
        const returnedGame =
          source === 'nexus'
            ? text(result.record.domainName || result.record.domain_name)
            : text(result.record.gameId || result.record.game_id)
        if (
          (returnedId && returnedId !== modId) ||
          (returnedGame && returnedGame !== (source === 'nexus' ? domainName : gameId))
        ) {
          detailStatus = 'identity_mismatch'
          warnings.push('详情返回的模组或游戏身份不匹配，已忽略该页面的安装线索。')
        } else {
          documents.unshift(...collectInstallDetailDocuments(result.record, 'mod_detail', fileId))
          detailStatus = 'fetched'
        }
      } else {
        detailStatus = 'unavailable'
        warnings.push('未能读取对应模组详情，请检查来源授权或稍后重试；仍可分析已提供的说明。')
      }
    } catch (error) {
      if (isAgentToolAbortError(error)) throw error
      assertToolExecutionActive(ctx.signal)
      detailStatus = 'unavailable'
      warnings.push('对应模组详情读取失败；不会把失败当作详情中没有安装说明。')
    }
  }
  assertToolExecutionActive(ctx.signal)
  const analysis = analyzeInstallLocationEvidence(
    documents,
    args.archiveSummary || args.archive || {}
  )
  return {
    success: true,
    sourcePlatform: source,
    identity,
    detailStatus,
    ...analysis,
    warnings: [...warnings, ...analysis.warnings],
    message: analysis.hintCount
      ? '已从安装说明提取路径线索；需结合游戏目录与包结构预演验证，尚未保存或执行规则。'
      : detailStatus === 'missing_identity'
        ? '尚无明确路径。请从当前模组取得 modId 和来源游戏标识，以读取对应详情安装说明。'
        : '尚无明确安装目标。请核对详情中的手动安装段落、对应版本 README 和压缩包结构，不按文件扩展名猜目录。'
  }
}
