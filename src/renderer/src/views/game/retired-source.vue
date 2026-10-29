<script setup>
import PageBody from '@renderer/component/page-body.vue'
import { VxButton } from '@renderer/component/vertex-ui'
import { useRouter } from 'vue-router'
import { getRetiredSourceFailure } from '../../../../shared/sources/retired-source-policy.js'
const router = useRouter()
const message = getRetiredSourceFailure().message
</script>

<template>
  <PageBody>
    <section class="retired-source-page">
      <h1>{{ $t('ui.theVertexModSourceHasBeenRetired') }}</h1>
      <p>{{ message }}</p>
      <div class="retired-source-actions">
        <VxButton @click="router.push('/app/game/repository')">{{ $t('ui.manageInstalledMods') }}</VxButton>
        <VxButton @click="router.push('/app/game')">{{ $t('ui.browseThirdPartySources') }}</VxButton>
      </div>
    </section>
  </PageBody>
</template>

<style scoped>
.retired-source-page {
  padding: var(--space-6, 24px);
  color: var(--color-text-primary);
}
h1 {
  font-size: 20px;
  margin-bottom: var(--space-4, 16px);
}
p {
  color: var(--color-text-secondary);
  line-height: 1.7;
}
.retired-source-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3, 12px);
  margin-top: var(--space-6, 24px);
}
</style>
