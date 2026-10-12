import pluginVue from 'eslint-plugin-vue'
import tseslint from 'typescript-eslint'
import vueParser from 'vue-eslint-parser'

// typescript-eslint's rules for .ts files cover the TypeScript in .vue files
// too. Every component uses `<script setup lang="ts">`, and none of these
// rules need type information, so no file has to be found before linting.
const typescript = tseslint.configs.recommended.map((config) =>
  config.files ? { ...config, files: [...config.files, '**/*.vue'] } : config,
)

export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'playwright-report/**', 'test-results/**'],
  },
  ...pluginVue.configs['flat/essential'],
  ...typescript,
  // typescript-eslint's base sets its own parser for every file, so .vue files
  // need the Vue parser back, with TypeScript for their scripts.
  ...pluginVue.configs['flat/base'],
  {
    files: ['**/*.vue'],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        // The template takes its parser from `<script lang>`, so TypeScript
        // works in template expressions too.
        parser: { js: 'espree', jsx: 'espree', ts: tseslint.parser, tsx: tseslint.parser },
        ecmaVersion: 2024,
        ecmaFeatures: { jsx: false },
        extraFileExtensions: ['.vue'],
      },
    },
    rules: {
      'vue/block-lang': ['error', { script: { lang: ['ts'], allowNoLang: false } }],
    },
  },
  {
    rules: {
      'vue/multi-word-component-names': 'off',
    },
  },
]
