import { clientI18n } from '../../../i18n/index.js'
const uiText = (key, params) => clientI18n.i18n.global.t(key, params)
// 整合包分类：模组中心左栏「整合包」分组和整合包面板标题共用这一份定义。
// 「订阅更新」不是独立分类，它是「我的订阅」里的「有更新」筛选（内部视图 id 为 updates）。
export const SOURCE_MODPACK_VIEWS = Object.freeze([
  Object.freeze({ id: 'public', get label() { return uiText('ui.publicModpacks') }, requiresLogin: true }),
  Object.freeze({ id: 'local', get label() { return uiText('ui.localModpacksVariant2') }, requiresLogin: false }),
  Object.freeze({ id: 'mine', get label() { return uiText('ui.myShares') }, requiresLogin: true }),
  Object.freeze({ id: 'favorites', get label() { return uiText('ui.myFavorites') }, requiresLogin: true }),
  Object.freeze({ id: 'subscriptions', get label() { return uiText('ui.mySubscriptions') }, requiresLogin: true })
])

const SOURCE_MODPACK_VIEW_ID_SET = new Set(SOURCE_MODPACK_VIEWS.map((view) => view.id))

export function isSourceModpackView(value) {
  return SOURCE_MODPACK_VIEW_ID_SET.has(String(value || ''))
}

export function getSourceModpackViewLabel(value) {
  return SOURCE_MODPACK_VIEWS.find((view) => view.id === value)?.label || uiText('ui.modpacks')
}
