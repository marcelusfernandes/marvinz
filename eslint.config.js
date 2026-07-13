import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

// Legacy files grandfathered from complexity and max-lines gates.
// Remove from these lists as they are refactored. Tracked in #472.
const GRANDFATHERED_COMPLEXITY = [
  'electron/agent/adapter-claude.ts',
  'electron/agent/adapter-codex.ts',
  'electron/agent/index.ts',
  'electron/search-content.ts',
  'src/App.tsx',
  'src/components/DocxViewer.tsx',
  'src/components/Editor.tsx',
  'src/components/FileTree.tsx',
  'src/components/LiveMarkdown.tsx',
  'src/components/SettingsModal.tsx',
  'src/components/SnapshotPanel.tsx',
  'src/components/XlsxViewer.tsx',
  'src/components/chat/tool-bodies/EditCard.tsx',
  'src/components/chat/tool-bodies/WriteCard.tsx',
  'src/lib/chat/store.ts',
  'src/lib/cmLanguage.ts',
  'src/lib/pmMentionTrigger.ts',
  'src/lib/settingsStore.ts',
  'src/lib/useFileClipboardShortcuts.ts',
]

const GRANDFATHERED_MAX_LINES = [
  'src/App.tsx',
  'src/components/Editor.tsx',
  'src/components/FileTree.tsx',
  'src/components/LiveMarkdown.tsx',
  'src/components/AgentsPane.tsx',
  'src/components/Icon.tsx',
  'src/lib/chat/store.ts',
  'electron/snapshot.ts',
  'electron/agent/adapter-claude.ts',
  'electron/agent/index.ts',
  'src/components/SettingsModal.tsx',
]

// Legacy no-param-reassign offenders: CodeMirror StateField reducers that
// reassign their `value` accumulator (idiomatic CM, but flagged). Grandfathered
// so the rule is a hard error for new/touched code; remove as refactored (#594).
const GRANDFATHERED_NO_PARAM_REASSIGN = [
  'src/lib/cmJustInsertedHighlight.ts',
  'src/lib/cmJustReplacedHighlight.ts',
]

export default defineConfig([
  globalIgnores(['dist', 'coverage/**', '.claude/worktrees/**', '.marvin/**']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      complexity: ['error', 15],
      'max-lines': ['error', { max: 500, skipBlankLines: true, skipComments: true }],
      // Enforce the CRITICAL immutability rule (coding-style.md) as a hard
      // failure for new/touched code. Legacy offenders are grandfathered in
      // GRANDFATHERED_NO_PARAM_REASSIGN below; remove as refactored (#594).
      'no-param-reassign': 'error',
      '@typescript-eslint/naming-convention': [
        'error',
        { selector: 'typeLike', format: ['PascalCase'] },
      ],
      // Allow intentional unused vars/args with a leading underscore.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          args: 'all',
          argsIgnorePattern: '^_',
          caughtErrors: 'all',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
      // react-hooks v7 added several rules that flag patterns in the existing
      // codebase. Downgrade to warn so the lint gate passes while the team can
      // refactor incrementally. Tracked in #474.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/static-components': 'warn',
    },
  },
  // Test and e2e files are naturally long (many test cases); max-lines is not
  // a useful signal there. E2e tests frequently cast DOM/page globals to `any`
  // because Playwright types are loose — disable no-explicit-any there.
  {
    files: ['**/__tests__/**/*.spec.{ts,tsx}', 'e2e/**/*.spec.ts', '**/*.test.{ts,tsx}'],
    rules: {
      'max-lines': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  // Grandfather legacy complexity offenders — remove as refactored (#472)
  {
    files: GRANDFATHERED_COMPLEXITY,
    rules: {
      complexity: 'off',
    },
  },
  // Grandfather legacy max-lines offenders — remove as refactored (#472)
  {
    files: GRANDFATHERED_MAX_LINES,
    rules: {
      'max-lines': 'off',
    },
  },
  // Grandfather legacy no-param-reassign offenders — remove as refactored (#594)
  {
    files: GRANDFATHERED_NO_PARAM_REASSIGN,
    rules: {
      'no-param-reassign': 'off',
    },
  },
  // electron/main.ts (#573/#580/#613): reduced from 2116 to 679 raw lines (501
  // counted by this rule's skipBlankLines/skipComments) after extracting
  // every ipcMain.handle/on call into electron/ipc/*. 1 line over the 500
  // default (prettier wraps one import list across multiple lines) — a small
  // numeric cap replaces the #580 grandfather entry rather than force an
  // unrelated code change just to dodge the threshold.
  {
    files: ['electron/main.ts'],
    rules: {
      'max-lines': ['error', { max: 520, skipBlankLines: true, skipComments: true }],
    },
  },
])
