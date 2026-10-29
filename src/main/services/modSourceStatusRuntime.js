import { updateModSourceStatus } from '../db/mods/mods.js'

export function getRuntimeModSourceStatusWriter() {
  return updateModSourceStatus
}
