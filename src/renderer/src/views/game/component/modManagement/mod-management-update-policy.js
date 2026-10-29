import { clientI18n } from '../../../../i18n/index.js'
const uiText = (key, params) => clientI18n.i18n.global.t(key, params)
// Only an explicit, unambiguous successor chain may replace an installed Nexus file.
export function resolveNexusUpdateFile(files, updates, currentFileId, isUsable) {
  const currentId = Number(currentFileId)
  const byId = new Map(files.map((file) => [Number(file.fileId), file]))
  const nextIds = new Map()
  for (const update of Array.isArray(updates) ? updates : []) {
    const oldId = Number(update.old_file_id)
    const newId = Number(update.new_file_id)
    if (!(oldId > 0 && newId > 0) || oldId === newId) continue
    if (!nextIds.has(oldId)) nextIds.set(oldId, new Set())
    nextIds.get(oldId).add(newId)
  }
  const visited = new Set()
  const visiting = new Set()
  const leaves = new Set()
  const pending = [[currentId, false]]
  let cyclic = false
  while (pending.length) {
    const [id, exiting] = pending.pop()
    if (exiting) {
      visiting.delete(id)
      visited.add(id)
      continue
    }
    if (visiting.has(id)) { cyclic = true; break }
    if (visited.has(id)) continue
    visiting.add(id)
    pending.push([id, true])
    const children = nextIds.get(id)
    if (!children?.size) leaves.add(id)
    else for (const child of children) pending.push([child, false])
  }
  if (cyclic || leaves.size !== 1) {
    return { file: null, reason: uiText('ui.fileUpdateRelationshipsBranchOrCycleChooseAVersionOn') }
  }
  const id = [...leaves][0]
  const file = byId.get(id)
  if (file && isUsable(file)) return { file, reason: '' }
  return { file: null, reason: uiText('ui.theNextVersionOfThisFileCannotBeDeterminedChoose') }
}

export function summarizeUpdateCheck(records = []) {
  const failed = records.filter((item) => item.updateError).length
  const available = records.filter((item) => item.hasUpdate && !item.updateError).length
  const checked = records.length - failed
  return { failed, available, checked, total: records.length }
}
