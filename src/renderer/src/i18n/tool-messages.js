import { toolMessageCatalog } from './tool-message-catalog.js'

// Named parameters keep numbers, paths and source-provided names as data.
const namedParams = (text) =>
  text.replace(/\{(\d+)\}/g, '{p$1}').replace(/[|@]/g, (value) => `{'${value}'}`)
export const toolMessages = {
  'zh-CN': Object.fromEntries(toolMessageCatalog.map(([key, zh]) => [key, namedParams(zh)])),
  'en-US': Object.fromEntries(toolMessageCatalog.map(([key, , en]) => [key, namedParams(en)]))
}
export const toolMessageKeys = new Map(toolMessageCatalog.map(([key, zh]) => [zh, `tools.${key}`]))
