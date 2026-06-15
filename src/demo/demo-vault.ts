// In-memory demo vault for the embedded web demo (issue #441). No disk access —
// the window.marvin mock reads file content and the tree from here.

import type { FileNode } from '../types'

export const DEMO_VAULT_ROOT = '/demo-vault'

type DemoFile = { path: string; content: string }

const RESEARCH_NOTES = `# Snapshot restore — decision log

## Context

Exploring two restore strategies after an agent turn:

- **Full vault replace** — simpler, but destroys concurrent edits
- **File-level patch** — surgical, requires conflict detection

## Decision

Go with file-level patch (see \`.marvin/snapshots/<turn-id>\`). Rationale: the vault may have unsaved work in open tabs.

## Open questions

- How to handle binary files in a snapshot?
- Conflict UX when the agent and the user edit the same file
`

const PROJECT_PLAN = `# Project plan — Q3

## Milestones

- [x] Snapshot engine
- [ ] Restore UX
- [ ] Approvable tool calls

## Notes

Restore UX blocks on the decision logged in research-notes.md.
`

const MEETING = `# Meeting — 2026-06-08

## Attendees

- Felipe
- Claude Code

## Topics

- Snapshot restore strategy (see research-notes.md)
- Approval gate copy
`

export const DEMO_FILES: DemoFile[] = [
  { path: `${DEMO_VAULT_ROOT}/research-notes.md`, content: RESEARCH_NOTES },
  { path: `${DEMO_VAULT_ROOT}/project-plan.md`, content: PROJECT_PLAN },
  { path: `${DEMO_VAULT_ROOT}/meeting-2026-06-08.md`, content: MEETING },
]

export const DEMO_TREE: FileNode[] = [
  { name: 'research-notes.md', path: `${DEMO_VAULT_ROOT}/research-notes.md`, isDir: false },
  { name: 'project-plan.md', path: `${DEMO_VAULT_ROOT}/project-plan.md`, isDir: false },
  { name: 'meeting-2026-06-08.md', path: `${DEMO_VAULT_ROOT}/meeting-2026-06-08.md`, isDir: false },
  {
    name: '.marvin',
    path: `${DEMO_VAULT_ROOT}/.marvin`,
    isDir: true,
    children: [
      {
        name: 'snapshots',
        path: `${DEMO_VAULT_ROOT}/.marvin/snapshots`,
        isDir: true,
        children: [],
      },
    ],
  },
]
