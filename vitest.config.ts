import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'electron',
          environment: 'node',
          include: ['electron/__tests__/**/*.spec.ts'],
          coverage: {
            provider: 'v8',
            include: ['electron/snapshot.ts'],
            reporter: ['text', 'lcov'],
            thresholds: { lines: 80, functions: 80, branches: 80 },
          },
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
            ],
            reporter: ['text', 'lcov'],
            thresholds: { lines: 80, functions: 80, branches: 80 },
          },
        },
      },
    ],
  },
})
