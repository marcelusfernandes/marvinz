// @vitest-environment jsdom

import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useFrontmatterEditing } from '../useFrontmatterEditing'
import { replaceFrontmatter, serializeFrontmatter } from '../../lib/frontmatter'

const WITH_FM = '---\ntitle: Hello\n---\n\nbody text'
const NO_FM = 'just body\nno frontmatter'
const PREFIX = `---\n${serializeFrontmatter({ title: 'Hello' })}\n---\n\n`

describe('useFrontmatterEditing (#590)', () => {
  it('handleBodyChange keeps the frontmatter prefix and replaces only the body', () => {
    const scheduleSave = vi.fn()
    const latestValue = { current: WITH_FM }
    const { result } = renderHook(() => useFrontmatterEditing({ latestValue, scheduleSave }))

    act(() => result.current.handleBodyChange('new body'))
    expect(scheduleSave).toHaveBeenCalledWith(`${PREFIX}new body`)
  })

  it('handleBodyChange passes the body through unchanged when there is no frontmatter', () => {
    const scheduleSave = vi.fn()
    const latestValue = { current: NO_FM }
    const { result } = renderHook(() => useFrontmatterEditing({ latestValue, scheduleSave }))

    act(() => result.current.handleBodyChange('new body'))
    expect(scheduleSave).toHaveBeenCalledWith('new body')
  })

  it('handlePropertiesChange replaces the frontmatter and keeps the body', () => {
    const scheduleSave = vi.fn()
    const latestValue = { current: WITH_FM }
    const { result } = renderHook(() => useFrontmatterEditing({ latestValue, scheduleSave }))

    act(() => result.current.handlePropertiesChange({ title: 'Changed' }))
    expect(scheduleSave).toHaveBeenCalledWith(replaceFrontmatter(WITH_FM, { title: 'Changed' }))
  })

  it('exposes the fmCache state mirror once a body change parses frontmatter', () => {
    const scheduleSave = vi.fn()
    const latestValue = { current: WITH_FM }
    const { result } = renderHook(() => useFrontmatterEditing({ latestValue, scheduleSave }))

    expect(result.current.fmCache).toBeNull()
    act(() => result.current.handleBodyChange('x'))
    expect(result.current.fmCache).toMatchObject({ prefix: PREFIX, data: { title: 'Hello' } })
  })

  it('clears the fmCache mirror when the content loses its frontmatter', () => {
    const scheduleSave = vi.fn()
    const latestValue = { current: WITH_FM }
    const { result } = renderHook(() => useFrontmatterEditing({ latestValue, scheduleSave }))

    act(() => result.current.handleBodyChange('x'))
    expect(result.current.fmCache).not.toBeNull()

    latestValue.current = NO_FM
    act(() => result.current.handleBodyChange('y'))
    expect(result.current.fmCache).toBeNull()
  })
})
