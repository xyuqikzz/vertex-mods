<script setup>
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { VxInput, VxSegmented } from '@renderer/component/vertex-ui'
import { ToolIcon } from '@renderer/component/tool-page'
import projects from '../../../../../shared/app/third-party-projects.json'
import SettingGroup from './SettingGroup.vue'

// 关于页列出随应用分发的项目：集成工具和运行时依赖；开发与构建工具不随应用分发。
const GROUPS = ['integrations', 'runtime']

const { t, locale } = useI18n()
const query = ref('')
const activeGroup = ref('integrations')

const projectsByGroup = Object.fromEntries(
  GROUPS.map((group) => [group, projects.filter((project) => project.group === group)])
)
const licenseText = (project) => (project.licenseKey ? t(project.licenseKey) : project.license)
const formatCount = (count) => count.toLocaleString(locale.value)
const keyword = computed(() => query.value.trim().toLowerCase())
const matches = (project) =>
  !keyword.value ||
  `${project.name} ${project.license} ${licenseText(project)} ${project.repository}`
    .toLowerCase()
    .includes(keyword.value)

const filteredByGroup = computed(() =>
  Object.fromEntries(GROUPS.map((group) => [group, projectsByGroup[group].filter(matches)]))
)
const filteredProjects = computed(() => filteredByGroup.value[activeGroup.value])
const groupOptions = computed(() =>
  GROUPS.map((group) => ({
    value: group,
    label: t('settings.aboutProjects.groupOption', {
      name: t(`settings.aboutProjects.groups.${group}`),
      count: formatCount(filteredByGroup.value[group].length)
    })
  }))
)
const projectCount = computed(() =>
  t('settings.aboutProjects.count', { count: formatCount(filteredProjects.value.length) })
)
const licenseSummary = computed(() => {
  const counts = new Map()
  for (const project of projectsByGroup.runtime)
    counts.set(project.license, (counts.get(project.license) || 0) + 1)
  return [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([license, count]) => `${license} ${formatCount(count)}`)
    .join(' · ')
})
const repositoryName = (project) => project.repository.replace('https://github.com/', '')
</script>

<template>
  <SettingGroup class="third-party-projects" :title="t('settings.aboutProjects.title')">
    <template #actions>
      <span class="setting-group__meta">{{ t('settings.aboutProjects.description') }}</span>
    </template>
    <div class="third-party-projects__toolbar">
      <VxSegmented
        v-model="activeGroup"
        class="third-party-projects__groups"
        role="group"
        :aria-label="t('settings.aboutProjects.typeLabel')"
        :options="groupOptions"
      />
      <VxInput
        v-model="query"
        class="third-party-projects__search"
        :placeholder="t('settings.aboutProjects.search')"
        :aria-label="t('settings.aboutProjects.search')"
        clearable
      />
      <span class="third-party-projects__count" role="status">{{ projectCount }}</span>
    </div>
    <p v-if="activeGroup === 'runtime' && !keyword" class="third-party-projects__summary">
      {{ t('settings.aboutProjects.licenseSummary', { summary: licenseSummary }) }}
    </p>
    <table v-if="filteredProjects.length" class="third-party-projects__table">
      <caption>
        {{
          t(`settings.aboutProjects.groups.${activeGroup}`)
        }}
      </caption>
      <colgroup>
        <col class="project-column" />
        <col class="license-column" />
        <col />
      </colgroup>
      <thead>
        <tr>
          <th scope="col">{{ t('settings.aboutProjects.project') }}</th>
          <th scope="col">{{ t('settings.aboutProjects.license') }}</th>
          <th scope="col">{{ t('settings.aboutProjects.repository') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="project in filteredProjects" :key="project.name">
          <th scope="row">
            <span class="third-party-projects__name">{{ project.name }}</span>
            <span v-if="project.purposeKey" class="third-party-projects__purpose">{{
              t(project.purposeKey)
            }}</span>
          </th>
          <td>
            <span class="third-party-projects__license">{{ licenseText(project) }}</span>
            <p v-if="project.noteKey" class="third-party-projects__note">
              {{ t(project.noteKey) }}
              <a
                v-if="project.licenseUrl"
                :href="project.licenseUrl"
                target="_blank"
                rel="noopener noreferrer"
                :aria-label="t('settings.aboutProjects.licenseDetails', { name: project.name })"
                >{{ t('settings.aboutProjects.details') }}</a
              >
            </p>
          </td>
          <td>
            <a
              class="third-party-projects__repo"
              :href="project.repository"
              target="_blank"
              rel="noopener noreferrer"
              :aria-label="t('settings.aboutProjects.openRepository', { name: project.name })"
            >
              <span>{{ repositoryName(project) }}</span>
              <ToolIcon name="external" :size="12" />
            </a>
          </td>
        </tr>
      </tbody>
    </table>
    <div v-else class="third-party-projects__empty" role="status">
      <p class="third-party-projects__empty-title">{{ t('settings.aboutProjects.empty') }}</p>
      <p class="third-party-projects__empty-hint">{{ t('settings.aboutProjects.emptyHint') }}</p>
    </div>
    <p class="third-party-projects__footnote">{{ t('settings.aboutProjects.footnote') }}</p>
  </SettingGroup>
</template>

<style scoped lang="scss">
.third-party-projects :deep(.setting-group__panel) {
  overflow: hidden;
}

.third-party-projects__toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
}

.third-party-projects__groups {
  flex: 0 1 auto;
  width: auto;
  min-width: 0;
  max-width: 100%;
}

.third-party-projects__search {
  flex: 1 1 220px;
  min-width: 0;
  max-width: 300px;
  margin-left: auto;
}

.third-party-projects__count {
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.third-party-projects__summary {
  margin: 0;
  padding: 0 var(--space-5) var(--space-3);
  color: var(--color-text-muted);
  font-family: var(--font-family-mono);
  font-size: var(--font-size-xs);
  line-height: var(--line-height-base);
}

.third-party-projects__table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  color: var(--color-text);
  font-size: var(--font-size-sm);
  line-height: var(--line-height-base);

  caption {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }

  th,
  td {
    padding: var(--space-3) var(--space-5);
    border-top: 1px solid var(--color-surface-strong);
    text-align: left;
    vertical-align: top;
    overflow-wrap: anywhere;
  }

  thead th {
    padding-top: var(--space-2);
    padding-bottom: var(--space-2);
    color: var(--color-text-muted);
    font-size: var(--font-size-xs);
    font-weight: var(--font-weight-medium);
    background: var(--color-surface-soft);
  }

  tbody th {
    font-weight: var(--font-weight-regular);
  }

  a {
    color: var(--color-accent-strong);
    text-underline-offset: 3px;

    &:hover {
      text-decoration-thickness: 2px;
    }

    &:active {
      color: var(--color-text);
    }

    &:focus-visible {
      outline: 2px solid var(--color-accent);
      outline-offset: 2px;
      border-radius: var(--radius-sm);
    }
  }
}

.project-column {
  width: 34%;
}

.license-column {
  width: 30%;
}

.third-party-projects__name {
  display: block;
  font-weight: var(--font-weight-medium);
}

.third-party-projects__purpose {
  display: block;
  margin-top: 2px;
  color: var(--color-text-muted);
  font-size: 12.5px;
}

.third-party-projects__license {
  display: inline-block;
  max-width: 100%;
  padding: 1px var(--space-2);
  color: var(--color-text-secondary);
  font-family: var(--font-family-mono);
  font-size: var(--font-size-xs);
  background: var(--color-surface-hover);
  border: 1px solid var(--color-surface-strong);
  border-radius: var(--radius-sm);
}

.third-party-projects__note {
  margin: var(--space-2) 0 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-xs);
  line-height: var(--line-height-base);
}

.third-party-projects__repo {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  max-width: 100%;

  span {
    min-width: 0;
    overflow-wrap: anywhere;
  }
}

.third-party-projects__empty {
  padding: var(--space-6) var(--space-5);
  text-align: center;
  border-top: 1px solid var(--color-surface-strong);

  p {
    margin: 0;
  }
}

.third-party-projects__empty-title {
  color: var(--color-text);
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-medium);
}

.third-party-projects__empty .third-party-projects__empty-hint {
  margin-top: var(--space-1);
  color: var(--color-text-muted);
  font-size: 12.5px;
}

.third-party-projects__footnote {
  margin: 0;
  padding: var(--space-3) var(--space-5);
  color: var(--color-text-muted);
  font-size: 12.5px;
  line-height: 1.6;
  background: var(--color-surface-soft);
  border-top: 1px solid var(--color-surface-strong);
}

@media (max-width: 760px) {
  .third-party-projects__search {
    max-width: none;
    margin-left: 0;
  }

  .project-column,
  .license-column {
    width: auto;
  }
}
</style>
