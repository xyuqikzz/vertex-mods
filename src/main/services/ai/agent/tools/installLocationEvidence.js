import { load } from 'cheerio'
import { sanitizeForModel } from '../../../../../shared/ai/tools/ai-agent-tool-loop.js'

const INSTALL_ACTION =
  /install|extract|unzip|copy|place|put|drop|location|folder|directory|path|安装|解压|复制|放入|放到|目录|路径/i
const NEGATIVE_ACTION =
  /do\s+not|don't|never|uninstall|remove|delete|不要|不能|禁止|卸载|删除|移除/i
const FILE_SUFFIX = /\.(?:pak|utoc|ucas|dll|ini|json|xml|toml|cfg|txt|exe)$/i
const ROOT_MARKER =
  /(?:<\s*game\s*(?:root|folder|directory)\s*>|\{gameRoot\}|\[game\s*(?:root|folder|directory)\]|game\s*(?:root|folder|directory)|游戏(?:根目录|安装目录|目录))/gi

export function installationText(value = '') {
  if (typeof value !== 'string') return ''
  let text = value.slice(0, 128000).replace(ROOT_MARKER, 'VERTEX_GAME_ROOT')
  text = text.replace(
    /\[(?:\/?(?:b|i|u|size|color|font|center|url|img|code|quote|list)|\*)(?:=[^\]]*)?\]/gi,
    '\n'
  )
  const $ = load(text.replace(/<(?:br\s*\/?|\/p|\/div|\/li|\/h[1-6]|\/pre|\/tr)>/gi, '\n'))
  $('script,style,noscript,template,svg').remove()
  return $.root()
    .text()
    .replace(/\r/g, '')
    .replace(/\u00a0/g, ' ')
    .trim()
}

function relativePath(value) {
  if (/(?:^|[\\/])\.\.(?:[\\/]|$|[\s"'`.,;])/.test(value)) return ''
  const cleaned = value
    .trim()
    .replace(/^["'`\s]+|["'`\s.,;；。]+$/g, '')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '')
  if (
    !cleaned ||
    /^(?:\/|[a-z]:|~(?:\/|$))/i.test(cleaned) ||
    /[:%<>|?*]/.test(cleaned) ||
    [...cleaned].some((character) => character.charCodeAt(0) < 32)
  )
    return ''
  const parts = cleaned.split('/')
  if (parts.some((part) => !part.trim() || part === '.' || part === '..' || /[. ]$/.test(part)))
    return ''
  return cleaned
}

function trimPathProse(value) {
  return value.split(
    /\s+(?:and|then|folder|directory|for|to|after|before|where|with|into|is)\b|\.\s|[，。；]|(?:即可|文件夹|目录中|中即可)/i
  )[0]
}

function archiveEntries(summary = {}) {
  const entries = summary.entries || summary.files || summary.structure || []
  return (Array.isArray(entries) ? entries : [])
    .slice(0, 200)
    .filter(
      (item) => typeof item === 'string' || (item && item.type !== 'directory' && !item.isDirectory)
    )
    .map((item) =>
      relativePath(
        typeof item === 'string' ? item : item.relativePath || item.path || item.name || ''
      )
    )
    .filter(Boolean)
}

function suggestedRule(hint, entries, truncated) {
  if (hint.requiresReview || truncated || !entries.length) return null
  const targetPath = hint.target.path || ''
  const prefix =
    targetPath &&
    entries.find((entry) => entry.toLowerCase().startsWith(`${targetPath.toLowerCase()}/`))
  let source
  let pattern
  if (
    prefix &&
    entries.every(
      (entry) =>
        entry.toLowerCase().startsWith(`${targetPath.toLowerCase()}/`) ||
        /(?:^|\/)(?:readme|license|changelog)/i.test(entry)
    )
  ) {
    source = {
      type: 'fixed_subdir',
      path: prefix.slice(0, targetPath.length),
      preserve_candidate_dir: false
    }
    pattern = `${targetPath}/**/*`
  } else if (entries.every((entry) => !entry.includes('/'))) {
    // 仅为明确的平铺内容生成草案；保留 PAK 配套文件，不能只抽出一个 .pak。
    const files = entries.filter(
      (entry) =>
        !/^(?:readme|license|changelog)/i.test(entry) &&
        (!hint.fileName || entry.toLowerCase() === hint.fileName.toLowerCase())
    )
    if (!files.length) return null
    source = { type: 'file_by_pattern', patterns: files, preserve_candidate_dir: false }
    pattern = files[0]
  } else {
    return null
  }
  return {
    id: 'ai_detail_location_preview',
    priority: 60,
    // 兼容规则预演与统一安装规划器，并避免模型结果的深度裁剪丢失 match 条件。
    match: { any_file_patterns: [pattern] },
    source,
    target: hint.target
  }
}

// 详情是证据而非指令。只产生受控路径与草案，不创建目录、不保存规则、不提交安装。
export function analyzeInstallLocationEvidence(documents = [], archiveSummary = {}) {
  const hints = new Map()
  const gameDetectionCandidates = []
  const excerpts = []
  const warnings = []
  function addHint(rawPath, base, document, line, confidence = 85) {
    let path = relativePath(trimPathProse(rawPath))
    if (!path) return
    const fileName = FILE_SUFFIX.test(path) ? path.split('/').pop() : ''
    if (/\.exe$/i.test(fileName)) return
    if (fileName) path = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
    if (!path) return
    const target = base
      ? { type: 'user_relative', base_type: base, path }
      : { type: 'game_relative', path }
    const key = `${target.type}:${base}:${path.toLowerCase()}`
    const evidence = { source: document.source, text: sanitizeForModel(line).slice(0, 400) }
    const current = hints.get(key)
    if (current) {
      if (
        !current.evidence.some(
          (item) => item.source === evidence.source && item.text === evidence.text
        )
      )
        current.evidence.push(evidence)
      current.confidence = Math.max(current.confidence, confidence)
      return
    }
    hints.set(key, {
      kind: 'target_path',
      target,
      confidence,
      source: document.source,
      evidence: [evidence],
      fileName
    })
  }

  for (const document of documents.slice(0, 12)) {
    const text = installationText(document.text)
    const lines = text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
    let negativeSection = false
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]
      if (
        /^(?:#{1,6}\s*)?(?:uninstall(?:ation)?|removal|卸载(?:方法|步骤|说明)?)[\s:：]*$/i.test(
          line
        )
      )
        negativeSection = true
      if (
        /^(?:#{1,6}\s*)?(?:install(?:ation)?|manual installation|安装(?:方法|步骤|说明)?)[\s:：]*$/i.test(
          line
        )
      )
        negativeSection = false
      if (negativeSection || NEGATIVE_ACTION.test(line)) continue
      const isInstruction =
        INSTALL_ACTION.test(line) ||
        /%LOCALAPPDATA%|%APPDATA%|VERTEX_GAME_ROOT/i.test(line) ||
        INSTALL_ACTION.test(lines[index - 1] || '')
      if (!isInstruction) continue
      if (excerpts.length < 10 && /[/\\]|\.exe\b|安装|install/i.test(line)) {
        excerpts.push({ source: document.source, text: sanitizeForModel(line).slice(0, 600) })
      }
      // 绝对示例路径无法证明这台机器的实际目录，拒绝截取其中的尾部冒充相对路径。
      const safeLine = line.replace(
        /https?:\/\/\S+|[A-Za-z]:[\\/][^\r\n"'`<>]+|\\\\[^\r\n"'`<>]+/gi,
        '[external-path]'
      )
      const pathTail = '([^\\r\\n"\'`<>|，。；]+)'
      for (const match of safeLine.matchAll(
        new RegExp('%(LOCALAPPDATA|APPDATA)%[\\\\/]+' + pathTail, 'gi')
      )) {
        addHint(
          match[2],
          match[1].toUpperCase() === 'LOCALAPPDATA' ? 'local_appdata' : 'roaming_appdata',
          document,
          line,
          90
        )
      }
      for (const match of safeLine.matchAll(
        new RegExp('VERTEX_GAME_ROOT[\\\\/]+' + pathTail, 'gi')
      )) {
        addHint(match[1], '', document, line, 90)
      }
      // 保留 Content/Paks 前的游戏目录段，避免 Pal/Content/... 被错误裁成 Content/...。
      for (const match of safeLine.matchAll(
        /(?:[\p{L}\p{N}_~.()+-]+[\\/])*(?:Content[\\/]Paks(?:[\\/]~?mods)?|BepInEx[\\/]plugins|Data[\\/](?:SKSE[\\/]Plugins|F4SE[\\/]Plugins)|red4ext[\\/]plugins|archive[\\/]pc[\\/]mod)(?:[\\/][\p{L}\p{N}_~.()+-]+)*/giu
      )) {
        if (/^VERTEX_GAME_ROOT[\\/]/i.test(match[0])) continue
        const before = safeLine.slice(0, match.index)
        if (/(?:VERTEX_GAME_ROOT|%APPDATA%|%LOCALAPPDATA%)[\\/][^\n]*$/i.test(before)) continue
        addHint(match[0], '', document, line, 85)
      }
      for (const match of safeLine.matchAll(
        /(?:VERTEX_GAME_ROOT[\\/])?((?:[A-Za-z0-9_.()-]+[\\/])*([A-Za-z0-9_.()-]+\.exe))\b/gi
      )) {
        const exeName = match[2]
        if (/^(?:game|setup|install|uninstall|launcher|example)\.exe$/i.test(exeName)) continue
        const relativeExe = relativePath(match[1])
        if (!relativeExe) continue
        const hasRootAnchor = /^VERTEX_GAME_ROOT/i.test(match[0])
        const up = hasRootAnchor ? relativeExe.split('/').length - 1 : 0
        if (!hasRootAnchor && relativeExe.includes('/')) continue
        if (
          gameDetectionCandidates.some(
            (candidate) => candidate.exe_globs[0] === exeName && candidate.root_from.up === up
          )
        )
          continue
        gameDetectionCandidates.push({
          name: `detail_${exeName.replace(/\W/g, '_')}`,
          type: 'exe_search',
          confidence: 75,
          exe_globs: [exeName],
          root_from: { type: 'exe_dir', up },
          markers: { all_paths: [relativeExe] }
        })
      }
    }
  }

  const entries = archiveEntries(archiveSummary)
  if (!hints.size) {
    for (const entry of entries) {
      const match = entry.match(/^((?:[^/]+\/)*(?:BepInEx\/plugins|Content\/Paks\/~?mods))\//i)
      if (match) addHint(match[1], '', { source: 'archive_structure' }, entry, 60)
    }
    if (entries.some((entry) => /\.pak$/i.test(entry)) && !hints.size) {
      warnings.push(
        '压缩包含 PAK 文件，但文件类型不能确定游戏内部目录；需要详情页安装说明或已验证规则。'
      )
    }
  }
  const results = [...hints.values()].sort((a, b) => b.confidence - a.confidence).slice(0, 12)
  const ambiguous = results.length > 1
  const truncated =
    archiveSummary?.summary?.truncated === true || archiveSummary?.truncated === true
  for (const hint of results) {
    hint.requiresReview = ambiguous || hint.source === 'archive_structure'
    hint.suggestedRule = suggestedRule(hint, entries, truncated)
    hint.validationRequired = true
  }
  if (ambiguous)
    warnings.push('发现多个目标目录，可能属于不同版本或不同组件；需核对适用条件，不自动选择。')
  return {
    hints: results,
    hintCount: results.length,
    ambiguous,
    gameDetectionCandidates: gameDetectionCandidates.slice(0, 6),
    evidence: excerpts,
    warnings,
    validationRequired: true,
    nextSteps: [
      '核对游戏版本与文件版本',
      '使用 game.detect_root 验证游戏目录',
      'archive.inspect',
      'rule.match_preview',
      'inspect_plan',
      '用户确认后提交任务中心'
    ]
  }
}
