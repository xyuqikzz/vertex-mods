import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import {
  AI_AGENT_DEFINITION_MAX_BYTES,
  getDefaultAiAgentDefinition,
  setAiAgentDefinitionProvider,
  validateAiAgentDefinition
} from '../../../shared/ai/config/ai-agent-definition.js'

const revisionOf = (text) => createHash('sha256').update(text).digest('hex')

export function createAgentDefinitionStore(filePath, knownTools) {
  function read() {
    try {
      const size = fs.statSync(filePath).size
      if (size > AI_AGENT_DEFINITION_MAX_BYTES) throw new Error('智能体配置超过 256 KB')
      const text = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '')
      return {
        text,
        revision: revisionOf(text),
        config: validateAiAgentDefinition(JSON.parse(text), knownTools)
      }
    } catch (error) {
      if (error.code === 'ENOENT') {
        const text = JSON.stringify(getDefaultAiAgentDefinition(), null, 2) + '\n'
        return {
          text,
          revision: 'default',
          config: validateAiAgentDefinition(JSON.parse(text), knownTools)
        }
      }
      throw error
    }
  }
  function inspect() {
    try {
      return { success: true, ...read() }
    } catch (error) {
      let text = ''
      try {
        if (fs.statSync(filePath).size <= AI_AGENT_DEFINITION_MAX_BYTES)
          text = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '')
      } catch {
        /* 错误配置仍可在设置中修复。 */
      }
      return {
        success: false,
        errorCode: 'agent_config_invalid',
        message: error.message,
        text,
        revision: revisionOf(text)
      }
    }
  }
  function save(text, revision) {
    if (typeof text !== 'string' || Buffer.byteLength(text) > AI_AGENT_DEFINITION_MAX_BYTES)
      throw new Error('智能体配置超过 256 KB 或格式无效')
    const config = validateAiAgentDefinition(JSON.parse(text), knownTools)
    const current = inspect()
    if (revision !== current.revision)
      throw new Error('配置已被其他窗口或编辑器修改，请重新读取后再保存')
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    const temporary = `${filePath}.${randomUUID()}.tmp`
    try {
      fs.writeFileSync(temporary, JSON.stringify(config, null, 2) + '\n', { flag: 'wx' })
      fs.renameSync(temporary, filePath)
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
    }
    return inspect()
  }
  return { read, inspect, save, filePath }
}

let activeStore
export function initializeAgentDefinitionStore(filePath, knownTools) {
  activeStore = createAgentDefinitionStore(filePath, knownTools)
  setAiAgentDefinitionProvider(() => activeStore.read().config)
  return activeStore
}
