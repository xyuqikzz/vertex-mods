// In-memory drafts survive route changes and KeepAlive eviction, without persisting paths to disk.
const drafts = new Map()
export const getRuleEditorDraft = key => drafts.get(key)
export function setRuleEditorDraft(key, text, baseline) {
  if (text === baseline) drafts.delete(key)
  else drafts.set(key, text)
}
export const clearRuleEditorDraft = key => drafts.delete(key)
