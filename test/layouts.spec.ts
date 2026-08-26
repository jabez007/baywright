import { describe, expect, it } from 'vitest'

import { LAYOUT_PATTERN_LIST, rotatedLayout } from '../src/domain/layouts.js'

describe('layout patterns', () => {
  it('ships layouts with unique ids and in-bounds placements', () => {
    expect(new Set(LAYOUT_PATTERN_LIST.map((layout) => layout.id)).size).toBe(LAYOUT_PATTERN_LIST.length)
    for (const layout of LAYOUT_PATTERN_LIST) {
      for (const placement of layout.placements) {
        expect(placement.i).toBeGreaterThanOrEqual(0)
        expect(placement.i).toBeLessThan(layout.width)
        expect(placement.j).toBeGreaterThanOrEqual(0)
        expect(placement.j).toBeLessThan(layout.height)
      }
    }
  })

  it('rotates the footprint and each placed bay clockwise', () => {
    const rotated = rotatedLayout('library-wing', 1)

    expect(rotated).toMatchObject({ width: 1, height: 3 })
    expect(rotated.placements).toEqual([
      { i: 0, j: 0, patternId: 'library-hall', quarterTurns: 3 },
      { i: 0, j: 1, patternId: 'straight-passage', quarterTurns: 1 },
      { i: 0, j: 2, patternId: 'library-hall', quarterTurns: 1 },
    ])
  })

  it('preserves a sparse centre when rotating the stronghold loop', () => {
    const rotated = rotatedLayout('stronghold-loop', 1)

    expect(rotated.placements).toHaveLength(8)
    expect(rotated.placements.some(({ i, j }) => i === 1 && j === 1)).toBe(false)
  })
})
