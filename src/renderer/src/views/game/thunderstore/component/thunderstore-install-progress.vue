<script setup>
defineProps({
  progress: {
    type: Object,
    default: () => ({})
  },
  status: {
    type: String,
    default: 'active'
  },
  progressText: {
    type: String,
    default: ''
  }
})

function formatFileSize(bytes) {
  const value = Number(bytes || 0)
  if (!Number.isFinite(value) || value <= 0) {
    return '0 B'
  }
  if (value < 1024) {
    return `${value} B`
  }
  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(value >= 10240 ? 0 : 1)} KB`
  }
  return `${(value / 1024 / 1024).toFixed(value >= 1024 * 1024 * 10 ? 0 : 1)} MB`
}
</script>

<template>
  <div class="install-progress">
    <div class="progress-head">
      <span>{{ $t('tools.installationProgress') }}</span>
      <span v-if="progress.packageFullName">{{ progress.packageFullName }}</span>
    </div>
    <a-progress :percent="progress.percent" :status="status" />
    <div class="progress-meta">
      <span>{{ progressText }}</span>
      <span v-if="progress.totalCount > 0"
        >{{ $t('ui.packages') }} {{ progress.currentIndex }}/{{ progress.totalCount }}</span
      >
      <span v-if="progress.totalBytes > 0">
        {{ $t('tools.download') }} {{ formatFileSize(progress.downloadedBytes) }} /
        {{ formatFileSize(progress.totalBytes) }}
      </span>
    </div>
  </div>
</template>

<style scoped lang="scss">
.install-progress {
  margin-top: 14px;
  padding: 12px;
  border-radius: 10px;
  border: 1px solid #c7d2fe;
  background: #f8faff;
}

.progress-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  color: #1e293b;
  font-size: 13px;
  gap: 10px;
}

.progress-meta {
  margin-top: 8px;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 14px;
  color: #475569;
  font-size: 12px;
}
</style>
