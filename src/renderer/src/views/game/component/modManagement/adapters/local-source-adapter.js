import { clientI18n } from '../../../../../i18n/index.js'
const uiText = (key, params) => clientI18n.i18n.global.t(key, params)
import { resolveSourcePlatformLabel } from '../../../../../../../shared/sources/source-platform-registry.js'
import { getManagedModSourceUrl } from '../../../../../../../shared/games/mod-management-location.js'

export const LOCAL_MANAGEMENT_SOURCES = Object.freeze(['steam-workshop', 'gamebanana', 'vamhub'])
export function localSourceCards(records, source, busy = false) {
  return records.map((record) => {
    const enabled = Number(record.is_active) === 1
    const name = String(record.name || '未命名模组')
    return {
      key: `${source}:${record.id}`,
      title: name,
      listTitle: name,
      subtitle: String(record.author || record.authorName || ''),
      description: String(record.description || record.summary || ''),
      source,
      raw: record,
      coverUrl: record.cover || record.cover_image || '',
      fallbackText: name.slice(0, 1),
      disabled: busy,
      prioritySortable: false,
      relationsKnown: false,
      status: { text: enabled ? uiText('ui.enabled') : uiText('ui.disabled'), tone: enabled ? 'success' : 'default' },
      toggle: { visible: true, checked: enabled, disabled: busy },
      uninstall: { visible: true, disabled: busy || enabled },
      metaGroups: [
        [
          { labelKey: 'taskCenter.toolbar.sourceLabel', get label() { return uiText('taskCenter.toolbar.sourceLabel') }, value: resolveSourcePlatformLabel(source) },
          { labelKey: 'tools.version', get label() { return uiText('tools.version') }, value: record.version || '--' }
        ]
      ],
      badges: [{ text: resolveSourcePlatformLabel(source), tone: 'default' }],
      actions: [{ key: 'open-source-page', labelKey: 'ui.sourcePage', get label() { return uiText('ui.sourcePage') }, disabled: busy || !getManagedModSourceUrl(record, source) }]
    }
  })
}
export function filterLocalSourceCards(cards, keyword = '', tab = 'all') {
  const words = String(keyword).trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  return cards.filter(
    (card) =>
      (tab === 'all' || card.toggle.checked === (tab === 'enabled')) &&
      words.every((word) =>
        `${card.title} ${card.subtitle} ${card.raw.version || ''}`
          .toLocaleLowerCase()
          .includes(word)
      )
  )
}
