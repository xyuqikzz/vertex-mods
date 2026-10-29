import { access, readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { INSTALL_RULE_REFERENCE_FILE, INSTALL_RULE_GUIDE_FILE, getInstallRuleDocumentationContract, buildInstallRuleAuthoringSummary } from '../../../../../shared/installation/install-rule-documentation.js'

const DOCS = Object.freeze({
  'install-rule-reference': Object.freeze({
    id: 'install-rule-reference',
    title: '安装规则参考',
    fileName: INSTALL_RULE_REFERENCE_FILE
  }),
  'nexus-rule-reference': Object.freeze({
    id: 'nexus-rule-reference',
    title: '安装规则参考',
    fileName: INSTALL_RULE_REFERENCE_FILE
  }),
  'source-install-rule-user-guide': Object.freeze({
    id: 'source-install-rule-user-guide',
    title: '安装规则编写指南',
    fileName: INSTALL_RULE_GUIDE_FILE
  })
})

const DEFAULT_DOC_IDS = Object.freeze(['install-rule-reference', 'source-install-rule-user-guide'])
const DEFAULT_MAX_SECTIONS = 24
const SECTION_CONTENT_CHUNK_LENGTH = 1800

function toSafeText(value = '', fallback = '') {
  const text = String(value ?? '').trim()
  return text || String(fallback ?? '').trim()
}

function toSafeNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function getCurrentFileDir() {
  return path.dirname(fileURLToPath(import.meta.url))
}

function getProjectRootFromCurrentFile() {
  return path.resolve(getCurrentFileDir(), '../../../../../..')
}

async function pathExists(targetPath = '') {
  try {
    await access(targetPath)
    return true
  } catch {
    return false
  }
}

async function resolveDocsRoot(deps = {}) {
  const explicitRoot = toSafeText(deps.docsRoot)
  const candidates = [
    explicitRoot,
    path.resolve(process.cwd(), 'src/renderer/src/docs'),
    path.resolve(getProjectRootFromCurrentFile(), 'src/renderer/src/docs'),
    process.resourcesPath ? path.resolve(process.resourcesPath, 'renderer-docs') : '',
    process.resourcesPath ? path.resolve(process.resourcesPath, 'src/renderer/src/docs') : ''
  ].filter(Boolean)

  for (const candidate of candidates) {
    if (await pathExists(candidate)) {
      return candidate
    }
  }

  return ''
}

function resolveRequestedDocIds(args = {}) {
  const document = toSafeText(args.document || 'all')
  if (!document || document === 'all') {
    return [...DEFAULT_DOC_IDS]
  }
  return DOCS[document] ? [document] : []
}

function pushSection(result, section = {}, keyword = '', maxSections = DEFAULT_MAX_SECTIONS) {
  if (result.length >= maxSections) return

  const heading = toSafeText(section.heading || '文档开头')
  const content = toSafeText(section.content)
  const haystack = `${heading}\n${content}`.toLowerCase()
  const normalizedKeyword = toSafeText(keyword).toLowerCase()
  if (normalizedKeyword && !haystack.includes(normalizedKeyword)) return
  if (!content && heading === '文档开头') return

  if (!content) {
    result.push({
      heading,
      level: section.level || 0,
      content: ''
    })
    return
  }

  for (
    let offset = 0;
    offset < content.length && result.length < maxSections;
    offset += SECTION_CONTENT_CHUNK_LENGTH
  ) {
    const chunk = content.slice(offset, offset + SECTION_CONTENT_CHUNK_LENGTH)
    result.push({
      heading,
      level: section.level || 0,
      part: Math.floor(offset / SECTION_CONTENT_CHUNK_LENGTH) + 1,
      content: chunk
    })
  }
}

function parseMarkdownSections(markdown = '', options = {}) {
  const pageSize = Math.max(
    1,
    Math.min(30, Math.floor(toSafeNumber(options.maxSections, DEFAULT_MAX_SECTIONS)))
  )
  const sectionOffset = Math.max(0, Math.trunc(Number(options.sectionOffset) || 0))
  const maxSections = sectionOffset + pageSize + 1
  const keyword = toSafeText(options.keyword)
  const result = []
  const lines = String(markdown || '').split(/\r?\n/)
  let current = {
    heading: '文档开头',
    level: 0,
    lines: []
  }

  function flushCurrent() {
    pushSection(
      result,
      {
        heading: current.heading,
        level: current.level,
        content: current.lines.join('\n').trim()
      },
      keyword,
      maxSections
    )
  }

  for (const line of lines) {
    const match = line.match(/^(#{1,6})\s+(.+)$/)
    if (match) {
      flushCurrent()
      if (result.length >= maxSections) break
      current = {
        heading: match[2].trim(),
        level: match[1].length,
        lines: []
      }
      continue
    }
    current.lines.push(line)
  }

  if (result.length < maxSections) {
    flushCurrent()
  }

  return { sections: result.slice(sectionOffset, sectionOffset + pageSize), sectionOffset,
    nextSectionOffset: result.length > sectionOffset + pageSize ? sectionOffset + pageSize : null }
}

async function readReferenceDocument(docId = '', docsRoot = '', args = {}) {
  const doc = DOCS[docId]
  if (!doc) {
    return null
  }

  const filePath = path.join(docsRoot, doc.fileName)
  const [content, fileStat] = await Promise.all([readFile(filePath, 'utf8'), stat(filePath)])
  const contract = getInstallRuleDocumentationContract()
  if (!content.includes(`<!-- install-engine:${contract.engineVersion} schema:${contract.schemaVersion} -->`) ||
      contract.capabilities.some((capability) => !content.includes(capability))) {
    throw new Error('安装规则文档尚未同步当前引擎，不能作为最新能力说明使用')
  }

  return {
    id: doc.id,
    title: doc.title,
    fileName: doc.fileName,
    path: filePath,
    updatedAt: fileStat.mtime.toISOString(),
    length: content.length,
    ...parseMarkdownSections(content, args)
  }
}

export async function getInstallRuleReferenceDocsTool(args = {}, deps = {}) {
  const docIds = resolveRequestedDocIds(args)
  if (!docIds.length) {
    return {
      success: false,
      errorCode: 'invalid_reference_document',
      message:
        '不支持的安装规则参考文档。可用值：all / install-rule-reference / source-install-rule-user-guide / nexus-rule-reference；nexus-rule-reference 为兼容旧 ID，不推荐继续使用。'
    }
  }

  const docsRoot = await resolveDocsRoot(deps)
  if (!docsRoot) {
    return {
      success: false,
      errorCode: 'reference_docs_root_not_found',
      message: '未找到前端安装规则参考文档目录。'
    }
  }

  const documents = []
  const missing = []
  for (const docId of docIds) {
    try {
      const document = await readReferenceDocument(docId, docsRoot, args)
      if (document) {
        documents.push(document)
      }
    } catch (error) {
      missing.push({
        id: docId,
        message: toSafeText(error?.message, '读取失败')
      })
    }
  }

  return {
    success: documents.length === docIds.length,
    contract: getInstallRuleDocumentationContract(),
    authoringSummary: buildInstallRuleAuthoringSummary(),
    source: 'frontend_docs',
    docsRoot,
    documentCount: documents.length,
    documents,
    missing,
    usage:
      'contract 与 authoringSummary 来自当前引擎代码；sections 来自同版本文档。先按当前能力选择写法，再用 keyword 补读具体字段和预算；missing 非空或 success=false 时不能宣称文档已同步，不编造未支持能力。'
  }
}
