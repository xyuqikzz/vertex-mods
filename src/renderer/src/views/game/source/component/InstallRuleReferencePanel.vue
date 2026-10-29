<!-- eslint-disable vue/no-v-html -->
<script setup>
import { computed } from 'vue'
import hljs from 'highlight.js/lib/core'
import jsonLanguage from 'highlight.js/lib/languages/json'
import { Renderer, marked } from 'marked'
import 'highlight.js/styles/github.css'
import installRuleUserGuideMarkdown from '@renderer/docs/source-install-rule-user-guide.md?raw'

defineOptions({
  inheritAttrs: false
})

hljs.registerLanguage('json', jsonLanguage)

function escapeHtml(text = '') {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const markdownRenderer = new Renderer()
markdownRenderer.code = function ({ text, lang }) {
  const language = String(lang || '')
    .trim()
    .toLowerCase()
  const highlighted =
    language && hljs.getLanguage(language)
      ? hljs.highlight(String(text || ''), { language, ignoreIllegals: true }).value
      : escapeHtml(String(text || ''))
  const languageClass = language ? ` language-${language}` : ''
  return `<pre><code class="hljs${languageClass}">${highlighted}</code></pre>`
}

const renderedReferenceHtml = computed(() => {
  return marked.parse(installRuleUserGuideMarkdown, {
    gfm: true,
    breaks: true,
    renderer: markdownRenderer
  })
})
</script>

<template>
  <div class="install-rule-reference-panel" v-bind="$attrs">
    <!-- 仅在非抽屉/嵌入模式下才显示提示条 -->
    <div class="install-rule-reference-panel__hint">
      {{ $t('ui.forInstallationConfigurationAuthorsPreferTheInstallRulesSyntax') }}
    </div>
    <!-- eslint-disable-next-line vue/no-v-html -->
    <div class="install-rule-reference-panel__body" v-html="renderedReferenceHtml"></div>
  </div>
</template>

<style scoped lang="scss">
.install-rule-reference-panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  height: 100%;
  min-height: 0;
  color: var(--color-text-secondary);
  font-family: var(--font-family-base);
}

.install-rule-reference-panel__hint {
  flex: 0 0 auto;
  padding: var(--space-2) var(--space-3);
  color: var(--color-accent-strong);
  font-size: var(--font-size-xs);
  line-height: 1.6;
  background: color-mix(in srgb, var(--color-accent-soft) 55%, var(--color-white));
  border-radius: var(--radius-md);
}

.install-rule-reference-panel__body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  line-height: 1.75;
  overflow-wrap: anywhere;

  &::-webkit-scrollbar {
    width: 7px;
    height: 7px;
  }
  &::-webkit-scrollbar-track {
    background: var(--scrollbar-track-color);
    border-radius: 4px;
    margin: 8px 0;
  }
  &::-webkit-scrollbar-thumb {
    background: var(--scrollbar-thumb-color);
    border-radius: 4px;
    min-height: 40px;
  }
  &::-webkit-scrollbar-thumb:hover {
    background: var(--scrollbar-thumb-hover);
  }

  :deep(h1),
  :deep(h2),
  :deep(h3) {
    color: var(--color-text);
    font-weight: var(--font-weight-semibold);
    line-height: 1.4;
  }

  :deep(h1) {
    margin: 0 0 var(--space-2);
    font-size: var(--font-size-lg);
  }

  :deep(h2) {
    margin: var(--space-5) 0 var(--space-2);
    padding-bottom: 6px;
    font-size: var(--font-size-md);
    border-bottom: 1px solid var(--color-border);
  }

  :deep(h3) {
    margin: var(--space-4) 0 var(--space-1);
    font-size: var(--font-size-sm);
  }

  :deep(p) {
    margin: var(--space-2) 0;
  }

  :deep(pre) {
    overflow: auto;
    background: var(--color-surface-soft);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
  }

  :deep(pre code) {
    display: block;
    padding: 10px 12px;
    color: var(--color-text);
    font-size: var(--font-size-xs);
    line-height: 1.7;
    background: transparent;
  }

  :deep(code) {
    padding: 1px 5px;
    color: var(--color-text);
    font-family: var(--font-family-mono);
    font-size: var(--font-size-xs);
    background: var(--color-surface-hover);
    border-radius: var(--radius-xs);
  }

  :deep(table) {
    width: 100%;
    margin: var(--space-2) 0;
    border-collapse: collapse;
  }

  :deep(th),
  :deep(td) {
    padding: 6px var(--space-2);
    vertical-align: top;
    border: 1px solid var(--color-border);
  }

  :deep(th) {
    color: var(--color-text);
    font-weight: var(--font-weight-semibold);
    background: var(--color-surface-soft);
  }

  :deep(ul),
  :deep(ol) {
    padding-left: 20px;
  }

  :deep(li) {
    margin: 4px 0;
  }
}
</style>
