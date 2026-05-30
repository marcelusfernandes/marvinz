import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'electron',
          environment: 'node',
          include: [
            'electron/__tests__/**/*.spec.ts',
            'electron/agent/__tests__/**/*.spec.ts',
            'src/lib/__tests__/**/*.spec.ts',
          ],
          coverage: {
            provider: 'v8',
            include: ['electron/snapshot.ts', 'src/lib/marvinUrl.ts', 'electron/agent/permissions.ts'],
            reporter: ['text', 'lcov'],
            thresholds: { lines: 80, functions: 80, branches: 80 },
          },
        },
      },
      {
        test: {
          name: 'editor',
          environment: 'jsdom',
          include: [
            'src/components/__tests__/**/*.spec.{ts,tsx}',
            // src/lib/__tests__ convention: .spec.tsx → editor (jsdom); .spec.ts → electron (node).
            'src/lib/__tests__/**/*.spec.tsx',
          ],
          setupFiles: ['src/lib/chat/__tests__/setup.ts'],
        },
      },
      {
        test: {
          name: 'chat',
          environment: 'jsdom',
          include: [
            'src/lib/chat/__tests__/**/*.spec.{ts,tsx}',
            'src/components/chat/__tests__/**/*.spec.{ts,tsx}',
          ],
          setupFiles: ['src/lib/chat/__tests__/setup.ts'],
          coverage: {
            provider: 'v8',
            include: [
              'src/lib/chat/store.ts',
              'src/lib/chat/hooks.ts',
              'src/lib/chat/markdown.ts',
              'src/components/chat/UserBubble.tsx',
              'src/components/chat/TimelineItem.tsx',
              'src/components/chat/StreamingMarkdown.tsx',
              'src/components/chat/ToolBody*.tsx',
              'src/components/chat/ToolApprovalGate.tsx',
              'src/components/chat/ModesPicker.tsx',
              'src/components/chat/ModePill.tsx',
            ],
            reporter: ['text', 'lcov'],
            thresholds: { lines: 80, functions: 80, branches: 80 },
          },
        },
      },
      {
        test: {
          name: 'complexity',
          environment: 'node',
          include: ['scripts/complexity/__tests__/**/*.spec.ts'],
        },
      },
    ],
  },
})
