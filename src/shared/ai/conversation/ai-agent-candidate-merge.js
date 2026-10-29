const text = (value) => String(value ?? '').trim()
const first = (...values) => values.map(text).find(Boolean) || ''

function identity(candidate) {
  return {
    source: first(candidate.businessSource, candidate.source).toLowerCase(),
    mod: first(candidate.modId, candidate.id, candidate.packageFullName, candidate.fullName),
    slug: first(candidate.sourceSlug, candidate.domainName, candidate.community).toLowerCase(),
    game: first(candidate.sourceGameId, candidate.source_game_id, candidate.gameId),
    file: first(candidate.fileId, candidate.file_id, candidate.selectedFileId),
    version: first(candidate.version, candidate.modVersion)
  }
}

function sameCandidate(left, right) {
  const a = identity(left)
  const b = identity(right)
  if (!a.source || a.source !== b.source || !a.mod || a.mod !== b.mod) return false
  // 名字会翻译或改名；游戏、文件与版本才是不能混用的身份边界。
  for (const key of ['slug', 'game', 'file', 'version']) {
    if (a[key] && b[key] && a[key] !== b[key]) return false
  }
  const hasScope = a.slug || a.game || b.slug || b.game
  return !hasScope || Boolean((a.slug && a.slug === b.slug) || (a.game && a.game === b.game))
}

export function mergeAiAgentCandidates(groups = [], limit = 8) {
  const entries = []
  for (const [order, candidate] of groups.flat().entries()) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue
    if (!first(candidate.modId, candidate.id, candidate.name)) continue
    const matches = entries.filter((entry) => sameCandidate(entry.candidate, candidate))
    // 无文件信息的搜索项若能匹配多个版本，不能替用户选中其中一个。
    if (matches.length === 1) {
      const entry = matches[0]
      const patch = Object.fromEntries(Object.entries(candidate).filter(([, value]) =>
        value !== undefined && value !== null && value !== ''
      ))
      const wasDetail = entry.candidate._candidateOrigin === 'tool_detail'
      entry.candidate = { ...entry.candidate, ...patch }
      if (wasDetail && candidate._candidateOrigin === 'tool_search') {
        entry.candidate._candidateOrigin = 'tool_detail'
      }
      entry.order = order
    } else {
      entries.push({ candidate: { ...candidate }, order })
    }
  }
  const priority = ({ candidate }) => candidate.selected === true ? 2 : candidate._candidateOrigin === 'tool_detail' ? 1 : 0
  // 满额时保留明确选择/详情及新结果；同一批搜索的原始排序保持不变。
  const retained = new Set([...entries]
    .sort((a, b) => priority(b) - priority(a) || b.order - a.order)
    .slice(0, limit))
  return entries.filter((entry) => retained.has(entry)).map((entry) => entry.candidate)
}
