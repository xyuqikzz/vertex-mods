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

// ficsit.app 没有配置方案，目标区只显示游戏。
const { dialogProps, handleSelect, handleAction, handleClose } = useVersionInstallDialog(
  props,
  emit,
  {
    source: 'ficsit',
    sourceLabel: 'ficsit.app',
    profileLabel: '',
    buildDependencies: buildFicsitDependencyPreviewItems,
    resolveName: (item, fullName) =>
      item?.name || item?.displayName || item?.packageName || fullName || '--',
    resolveOwner: (item) => item?.owner || item?.ownerName || item?.namespace || ''
  }
)

function normalizeFicsitReference(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
}

function toFicsitDependencyItem(item) {
  if (typeof item === 'string') {
    return {
      modReference: item.trim(),
      condition: ''
    }
  }

  if (!item || typeof item !== 'object') {
    return {
      modReference: '',
      condition: ''
    }
  }

  return {
    modReference: String(
      item?.mod_reference || item?.modReference || item?.full_name || item?.fullName || ''
    ).trim(),
    condition: String(item?.condition || item?.requiredVersion || item?.version || '').trim()
  }
}

function buildFicsitDependencyPreviewItems(input = []) {
  const source = Array.isArray(input) ? input : []
  const result = []
  const seen = new Set()

  for (const item of source) {
    const dependency = toFicsitDependencyItem(item)
    if (!dependency.modReference) {
      continue
    }

    const normalizedKey = `${normalizeFicsitReference(dependency.modReference)}@${String(
      dependency.condition || ''
    )
      .trim()
      .toLowerCase()}`
    if (seen.has(normalizedKey)) {
      continue
    }
    seen.add(normalizedKey)

    result.push({
      key: normalizedKey,
      fullName: dependency.modReference,
      namespace: '',
      packageName: dependency.modReference,
      requiredVersion: dependency.condition
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
