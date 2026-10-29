<script setup>
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { VxButton, VxCheckbox } from '@renderer/component/vertex-ui'

const props = defineProps({ items: { type: Array, default: () => [] }, operating: Boolean })
const emit = defineEmits(['submit'])
const { t } = useI18n()
const choices = ref({})
watch(
  () => JSON.stringify(props.items.map((item) => [item.item_id, item.metadata.selectionRequest])),
  () => {
    choices.value = Object.fromEntries(
      props.items.map((item) => [
        item.item_id,
        [...(item.metadata.selectionRequest.selected || [])]
      ])
    )
  },
  { immediate: true }
)
function toggle(item, group, option, checked) {
  let selected = [...(choices.value[item.item_id] || [])]
  if (checked && group.max === 1)
    selected = selected.filter(
      (id) => !group.options.some((entry) => entry.id === id && !entry.required)
    )
  choices.value[item.item_id] = checked
    ? [...new Set([...selected, option.id])]
    : selected.filter((id) => id !== option.id)
}
function groupError(item, group) {
  const selected = choices.value[item.item_id] || []
  const count = group.options.filter((option) => selected.includes(option.id)).length
  if (count >= group.min && count <= group.max) return ''
  return group.min === group.max
    ? t('taskCenter.components.pickExact', { count: group.min })
    : t('taskCenter.components.pickRange', { min: group.min, max: group.max })
}
// 选项名称和说明来自安装包（FOMOD 等），按原文展示。
function optionLabel(option = {}) {
  const label = option.label || option.id
  if (option.required) return t('taskCenter.components.required', { label })
  if (!option.available) return t('taskCenter.components.unavailable', { label })
  return label
}
const valid = computed(() =>
  props.items.every((item) =>
    item.metadata.selectionRequest.groups.every((group) => !groupError(item, group))
  )
)
function submit() {
  if (!valid.value || props.operating) return
  emit(
    'submit',
    Object.fromEntries(
      props.items.map((item) => [
        item.item_id,
        {
          binding: item.metadata.selectionRequest.binding,
          selected: choices.value[item.item_id] || []
        }
      ])
    )
  )
}
</script>

<template>
  <form
    class="install-components"
    :aria-label="t('taskCenter.components.label')"
    @submit.prevent="submit"
  >
    <div class="install-components__head">
      <h3>{{ t('taskCenter.components.title') }}</h3>
      <p>{{ t('taskCenter.components.hint') }}</p>
    </div>
    <section v-for="item in items" :key="item.item_id" class="install-components__item">
      <h4 v-if="items.length > 1">{{ item.title }}</h4>
      <fieldset
        v-for="group in item.metadata.selectionRequest.groups"
        :key="group.id"
        :disabled="operating"
      >
        <legend>{{ group.label || group.id }}</legend>
        <div v-for="option in group.options" :key="option.id" class="install-components__option">
          <VxCheckbox
            :label="optionLabel(option)"
            :model-value="(choices[item.item_id] || []).includes(option.id)"
            :disabled="operating || !option.available || option.required"
            @update:model-value="toggle(item, group, option, $event)"
          />
          <p v-if="option.description">{{ option.description }}</p>
        </div>
        <p v-if="groupError(item, group)" role="status" class="install-components__error">
          {{ groupError(item, group) }}
        </p>
      </fieldset>
    </section>
    <VxButton type="submit" variant="primary" :disabled="!valid" :loading="operating">{{
      t('taskCenter.components.submit')
    }}</VxButton>
  </form>
</template>

<style scoped>
.install-components {
  display: grid;
  gap: var(--space-3);
  color: var(--color-text);
}
.install-components__head {
  display: grid;
  gap: var(--space-1);
}
.install-components__item {
  display: grid;
  gap: var(--space-3);
}
fieldset {
  display: grid;
  gap: var(--space-1);
  margin: 0;
  padding: var(--space-2) var(--space-3) var(--space-3);
  border: 1px solid var(--color-surface-strong);
  border-radius: var(--radius-md);
}
legend {
  padding: 0 var(--space-1);
  color: var(--color-text-secondary);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-semibold);
}
h3,
h4,
p {
  margin: 0;
}
h3 {
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-semibold);
}
h4 {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-semibold);
}
p {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  line-height: var(--line-height-base);
}
.install-components__option p {
  padding-left: calc(var(--choice-size) + var(--space-2));
  margin-top: -6px;
}
.install-components__error {
  color: var(--color-danger-strong);
}
.install-components > :deep(.vx-button) {
  justify-self: start;
}
</style>
