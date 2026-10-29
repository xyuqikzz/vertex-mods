import eslintConfig from '@electron-toolkit/eslint-config'
import eslintConfigPrettier from '@electron-toolkit/eslint-config-prettier'
import eslintPluginVue from 'eslint-plugin-vue'

export default [
  // Local test/build output and vendored audit references are not project source.
  { ignores: ['**/node_modules', '**/dist', '**/out', '.scratch/**', 'artifacts/**', 'electron.vite.config.*.mjs'] },
  eslintConfig,
  ...eslintPluginVue.configs['flat/recommended'],
  {
    files: [
      'src/shared/app/release-config.js',
      'src/shared/ai/config/ai-agent-definition.js',
      'src/main/services/dlss/swapper-payload.js',
      'src/main/services/dlss/component-catalog.js',
      'src/renderer/src/component/dlss/presentation.js',
      'scripts/prepare-dlss-payload.mjs'
    ],
    // JSON import attributes are required by Node when the build hook and
    // packaging tools load the same pinned manifest as the Electron bundle.
    languageOptions: { ecmaVersion: 2025, parserOptions: { ecmaVersion: 2025 } }
  },
  {
    files: ['**/*.{js,jsx,vue}'],
    rules: {
      'vue/require-default-prop': 'off',
      'vue/multi-word-component-names': 'off'
    }
  },
  eslintConfigPrettier
]
