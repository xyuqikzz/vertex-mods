import dbInstance from '../../../db/dbInstance.js'
import {
  createAgentPermissionGrantFromConfirmationInDatabase,
  createAgentPermissionGrantInDatabase,
  ensureAgentPermissionGrantSchemaForDatabase,
  findActiveAgentPermissionGrantInDatabase,
  listAgentPermissionGrantsFromDatabase,
  revokeAgentPermissionGrantInDatabase
} from './permissionGrantDbStore.js'

export function ensureAgentPermissionGrantSchema() {
  ensureAgentPermissionGrantSchemaForDatabase(dbInstance)
}

export function createAgentPermissionGrant(payload = {}) {
  return createAgentPermissionGrantInDatabase(dbInstance, payload)
}

export function createAgentPermissionGrantFromConfirmation(payload = {}) {
  return createAgentPermissionGrantFromConfirmationInDatabase(dbInstance, payload)
}

export function findActiveAgentPermissionGrant(payload = {}) {
  return findActiveAgentPermissionGrantInDatabase(dbInstance, payload)
}

export function listAgentPermissionGrants(payload = {}) {
  return listAgentPermissionGrantsFromDatabase(dbInstance, payload)
}

export function revokeAgentPermissionGrant(payload = {}) {
  return revokeAgentPermissionGrantInDatabase(dbInstance, payload)
}
