import { describe, expect, it } from 'vitest'

import {
  BAY_PATTERNS,
  BAY_PATTERN_LIST,
  bayFromPattern,
  getBayPattern,
} from '../src/domain/patterns.js'
import { cellCount } from '../src/domain/types.js'

describe('bay patterns', () => {
  it('has a unique id and the right number of cells for every pattern', () => {
    expect(new Set(BAY_PATTERN_LIST.map((pattern) => pattern.id)).size).toBe(BAY_PATTERN_LIST.length)
    for (const pattern of BAY_PATTERN_LIST) {
      expect(pattern.cells).toHaveLength(cellCount(pattern.grain))
      expect(BAY_PATTERNS[pattern.id]).toBe(pattern)
    }
  })

  it('returns undefined for an unknown pattern', () => {
    expect(getBayPattern('maze')).toBeUndefined()
    expect(() => bayFromPattern('maze')).toThrow(/no bay pattern 'maze'/)
  })

  it('builds fresh cells on each use', () => {
    const first = bayFromPattern('straight-passage')
    const second = bayFromPattern('straight-passage')
    first.cells[3]!.sockets.n = 'window'
    expect(second.cells[3]!.sockets.n).toBe('solid')
  })

  it('rotates cell positions and horizontal sockets clockwise', () => {
    const original = bayFromPattern('corner-passage')
    const rotated = bayFromPattern('corner-passage', 1)

    expect(original.cells[1]!.module).toBe('corridor')
    expect(rotated.cells[5]!.module).toBe('corridor')
    expect(rotated.cells[5]!.sockets.e).toBe('corridor')
    expect(rotated.cells[5]!.sockets.w).toBe('corridor')
  })

  it('supports every quarter-turn orientation', () => {
    const center = bayFromPattern('t-junction', 3).cells[4]!
    expect(center.sockets).toMatchObject({ n: 'corridor', e: 'solid', s: 'corridor', w: 'corridor' })
  })
})
