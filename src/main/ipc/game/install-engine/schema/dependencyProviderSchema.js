/**
 * schema/dependencyProviderSchema.js — default_dependencies[*].provider 字段校验（H12）
 *
 * 校验 provider 的字段名错误（如 file_name_regex 写成 filename_regex），
 * 避免 nexus_file / github_release provider 因字段名错误静默失败回退默认优先级。
 */
import { isPlainObject, toSafeText } from '../contracts.js'
import { pushDiagnostic } from './diagnostics.js'
import { validateUnknownFields } from './fieldGuards.js'

const NEXUS_FILE_PROVIDER_FIELDS = new Set([
  'game_domain',
  'game_domain_name',
  'domain_name',
  'gameDomain',
  'gameDomainName',
  'domainName',
  'mod_id',
  'modId',
  'nexus_mod_id',
  'nexusModId',
  'id',
  'file_id',
  'fileId',
  'nexus_file_id',
  'nexusFileId',
  'category',
  'file_name',
  'fileName',
  'filename',
  'file_name_regex',
  'fileNameRegex',
  'file_name_contains',
  'fileNameContains',
  'name_contains',
  'nameContains',
  'prefer_latest',
  'preferLatest',
  'allow_archived',
  'allowArchived',
  'allow_old_files',
  'allowOldFiles',
  'strict'
])

const GITHUB_RELEASE_PROVIDER_FIELDS = new Set([
  'owner',
  'repo',
  'tag',
  'asset_name',
  'assetName',
  'asset_name_regex',
  'assetNameRegex',
  'asset_name_contains',
  'assetNameContains',
  'prefer_latest',
  'preferLatest',
  'download_url',
  'downloadUrl',
  'browser_download_url',
  'github_token',
  'githubToken',
  'token'
])

const DEPENDENCY_TOP_LEVEL_FIELDS = new Set([
  'id',
  'name',
  'source',
  'provider',
  'install',
  'blocking',
  'required',
  'optional',
  'version',
  'version_range',
  'versionRange',
  'min_version',
  'minVersion',
  'max_version',
  'maxVersion'
])

export function validateDependencyProvider(
  dependency = {},
  pathPrefix = '',
  diagnostics = [],
  ruleId = ''
) {
  if (!isPlainObject(dependency)) return

  // 校验顶层字段名（detect typos like 'provder'）
  validateUnknownFields(dependency, DEPENDENCY_TOP_LEVEL_FIELDS, pathPrefix, diagnostics, ruleId)

  const source = toSafeText(dependency.source).toLowerCase()
  const provider = dependency.provider
  if (provider === undefined || provider === null) return
  if (!isPlainObject(provider)) {
    pushDiagnostic(
      diagnostics,
      'error',
      'invalid_provider_type',
      `${pathPrefix}.provider`,
      'provider 必须是对象',
      { ruleId }
    )
    return
  }

  const allowedFields =
    source === 'nexus_file'
      ? NEXUS_FILE_PROVIDER_FIELDS
      : source === 'github_release'
        ? GITHUB_RELEASE_PROVIDER_FIELDS
        : null

  if (!allowedFields) {
    pushDiagnostic(
      diagnostics,
      'warning',
      'unknown_provider_source',
      `${pathPrefix}.source`,
      `未知 provider source: ${source || '(空)'}，字段校验跳过`,
      { ruleId }
    )
    return
  }

  // 校验 provider 字段名（detect typos like 'filename_regex' instead of 'file_name_regex'）
  validateUnknownFields(provider, allowedFields, `${pathPrefix}.provider`, diagnostics, ruleId)
}
