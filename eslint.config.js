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
  'electron/main.ts',
  'src/App.tsx',
  'src/components/Editor.tsx',
  'src/components/FileTree.tsx',
  'src/components/LiveMarkdown.tsx',
  'src/components/AgentsPane.tsx',
  'src/lib/chat/store.ts',
  'electron/snapshot.ts',
  'electron/agent/adapter-claude.ts',
  'electron/agent/index.ts',
  'src/components/SettingsModal.tsx',
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
      '@typescript-eslint/naming-convention': [
        'error',
        { selector: 'typeLike', format: ['PascalCase'] },
      ],
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
])
