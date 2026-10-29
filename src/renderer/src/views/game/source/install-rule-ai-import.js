import { clientI18n } from '../../../i18n/index.js'
const uiText = (key, params) => clientI18n.i18n.global.t(key, params)
import ipcRenderer from '@renderer/common/ipcRenderer.js'
import { validateNexusRuleEditorText } from '../nexus/useNexusRuleConfigPage.js'
import { useSourceInstallConfigPage } from './useSourceInstallConfigPage.js'

const SAVE_SOURCES = new Set(['nexus', 'modio', 'ficsit', 'vamhub'])

export function canSaveImportedRule(context = {}) {
  return SAVE_SOURCES.has(context.sourcePlatform)
}

export function normalizeAiRuleJsonText(text = '') {
  const trimmed = String(text || '').trim()
  // Strip only a complete JSON fence; never extract a partial object from prose.
  return trimmed.match(/^```(?:json)?\s*\r?\n([\s\S]*?)\r?\n```$/i)?.[1].trim() || trimmed
}

export async function validateAiRuleInput(text, invoke = ipcRenderer.invoke.bind(ipcRenderer)) {
  const rawText = normalizeAiRuleJsonText(text)
  const syntax = validateNexusRuleEditorText(rawText)
  if (!syntax.valid) return syntax
  const result = await invoke('installRule:validate', { text: rawText })
  if (!result?.valid) return { valid: false, message: result?.message || uiText('ui.ruleValidationFailedPleaseTryAgain') }
  return {
    valid: true,
    parsed: result.compiled,
    formattedText: JSON.stringify(result.compiled, null, 2),
    warnings: result.warnings || []
  }
}

export function buildRuleImportPageOptions(context = {}) {
  const source = context.sourcePlatform
  if (!canSaveImportedRule(context)) throw new Error(uiText('ui.thisSourceOnlySupportsPastingAndValidatingJSON'))
  const id = String(
    source === 'nexus' ? context.domainName || '' : context.sourceGameId || ''
  ).trim()
  if (
    !id ||
    (['modio', 'ficsit'].includes(source) && (!Number.isSafeInteger(Number(id)) || Number(id) <= 0))
  ) {
    throw new Error(uiText('ui.aValidSourceGameIdentifierIsRequiredToSaveRules'))
  }
  return {
    sourcePlatform: source,
    routeId: id,
    routeQuery: {
      name: context.gameName || '',
      nameId: source === 'modio' ? context.sourceSlug || '' : '',
      sourceGameId: id,
      appId: Number(context.appId) || 0,
      gameId: Number(context.gameId) || 0,
      nexusGameId: source === 'nexus' ? Number(context.nexusGameId) || 0 : 0
    }
  }
}

export async function prepareAiRuleSave(context, text, createPage = useSourceInstallConfigPage) {
  const page = createPage(buildRuleImportPageOptions(context))
  await page.initializePage()
  const currentRules = page.currentRule.value?.ruleJson
  let saving = false
  return {
    requiresConfirmation: !!currentRules && Object.keys(currentRules).length > 0,
    async save() {
      if (saving) return null
      saving = true
      try {
        page.editorText.value = text
        const saved = await page.saveEditorRule()
        if (!saved) throw new Error(uiText('ui.rulesWereNotSavedPleaseTryAgain'))
        return saved
      } finally {
        saving = false
      }
    }
  }
}
