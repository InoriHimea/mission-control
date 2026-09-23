import { describe, it, expect } from 'vitest'
import { resolveWithin } from '../paths'
import path from 'node:path'

describe('resolveWithin', () => {
  const base = path.join(path.parse(process.cwd()).root, 'tmp', 'sandbox')

  it('resolves a simple relative path within base', () => {
    const result = resolveWithin(base, 'file.txt')
    expect(result).toBe(path.join(base, 'file.txt'))
  })

  it('resolves nested relative path', () => {
    const result = resolveWithin(base, path.join('subdir', 'file.txt'))
    expect(result).toBe(path.join(base, 'subdir', 'file.txt'))
  })

  it('throws when path escapes base with ..', () => {
    expect(() => resolveWithin(base, path.join('..', 'escape.txt'))).toThrow('Path escapes base directory')
  })

  it('throws when path tries deep escape', () => {
    expect(() => resolveWithin(base, path.join('..', '..', 'etc', 'passwd'))).toThrow('Path escapes base directory')
  })

  it('throws for absolute path outside base', () => {
    expect(() => resolveWithin(base, path.resolve(path.parse(base).root, 'etc', 'passwd'))).toThrow('Path escapes base directory')
  })

  it('allows an absolute path within the base', () => {
    const expected = path.join(base, 'file.txt')
    const result = resolveWithin(base, expected)
    expect(result).toBe(expected)
  })

  it('handles double separators and normalizes', () => {
    const result = resolveWithin(base, `subdir${path.sep}${path.sep}file.txt`)
    expect(result).toBe(path.join(base, 'subdir', 'file.txt'))
  })

  it('does not allow sibling directory access', () => {
    expect(() => resolveWithin(base, path.join('..', 'other', 'file.txt'))).toThrow()
  })

  it('handles base dir with trailing separator', () => {
    const result = resolveWithin(`${base}${path.sep}`, 'file.txt')
    expect(result).toBe(path.join(base, 'file.txt'))
  })
})
