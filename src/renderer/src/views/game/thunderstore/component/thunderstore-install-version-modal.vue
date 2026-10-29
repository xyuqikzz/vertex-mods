<script setup>
import InstallConfirmDialog from '@views/game/component/install-confirm/InstallConfirmDialog.vue'
import { useVersionInstallDialog } from '@views/game/component/install-confirm/useVersionInstallDialog.js'

const props = defineProps({
  systemConfig: { type: Object, default: () => ({}) },
  open: {
    type: Boolean,
    default: false
  },
  modalState: {
    type: Object,
    default: () => ({})
  },
  activeProfileName: {
    type: String,
    default: ''
  },
  gameName: {
    type: String,
    default: ''
  }
})

const emit = defineEmits(['close', 'confirm', 'version-change'])

const { dialogProps, handleSelect, handleAction, handleClose } = useVersionInstallDialog(
  props,
  emit,
  {
    source: 'thunderstore',
    sourceLabel: 'Thunderstore',
    profileLabel: '配置',
    buildDependencies: buildThunderstoreDependencyPreviewItems,
    resolveName: (item, fullName) =>
      item?.name ||
      item?.displayName ||
      item?.packageName ||
      parseThunderstorePackageFullName(fullName).packageName ||
      '--',
    resolveOwner: (item, fullName) =>
      item?.owner ||
      item?.ownerName ||
      item?.namespace ||
      parseThunderstorePackageFullName(fullName).namespace ||
      ''
  }
)

function parseThunderstorePackageFullName(fullName = '') {
  const raw = String(fullName || '').trim()
  const match = raw.match(/^([^-]+)-(.+)$/)
  if (!match) {
    return {
      namespace: '',
      packageName: '',
      fullName: raw
    }
  }

  return {
    namespace: String(match[1] || '').trim(),
    packageName: String(match[2] || '').trim(),
    fullName: raw
  }
}

function normalizeThunderstoreFullName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
}

function parseThunderstoreDependency(depString = '') {
  const raw = String(depString || '').trim()
  if (!raw) {
    return {
      fullName: '',
      requiredVersion: ''
    }
  }

  const match = raw.match(/^(.+)-(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)$/)
  if (match) {
    return {
      fullName: String(match[1] || '').trim(),
      requiredVersion: String(match[2] || '').trim()
    }
  }

  return {
    fullName: raw,
    requiredVersion: ''
  }
}

function toThunderstoreDependencyReference(item) {
  if (typeof item === 'string') {
    return item.trim()
  }

  if (!item || typeof item !== 'object') {
    return ''
  }

  const fullName = String(item?.full_name || item?.fullName || '').trim()
  const requiredVersion = String(item?.version_number || item?.version || '').trim()
  if (fullName && requiredVersion) {
    return `${fullName}-${requiredVersion}`
  }
  return fullName
}

function buildThunderstoreDependencyPreviewItems(input = []) {
  const source = Array.isArray(input) ? input : []
  const result = []
  const seen = new Set()

  for (const item of source) {
    const raw = toThunderstoreDependencyReference(item)
    const { fullName, requiredVersion } = parseThunderstoreDependency(raw)
    if (!fullName) {
      continue
    }

    const normalizedKey = `${normalizeThunderstoreFullName(fullName)}@${String(
      requiredVersion || ''
    )
      .trim()
      .toLowerCase()}`
    if (seen.has(normalizedKey)) {
      continue
    }
    seen.add(normalizedKey)

    const parsed = parseThunderstorePackageFullName(fullName)
    result.push({
      key: normalizedKey,
      fullName,
      namespace: parsed.namespace,
      packageName: parsed.packageName || fullName,
      requiredVersion
    })
  }

  return result
}
</script>

<template>
  <InstallConfirmDialog
    v-bind="dialogProps"
    @update:selected-keys="handleSelect"
    @action="handleAction"
    @close="handleClose"
  />
</template>
