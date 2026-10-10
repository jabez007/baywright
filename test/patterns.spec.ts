import { describe, expect, it } from 'vitest'

import {
  BAY_PATTERNS,
  BAY_PATTERN_LIST,
  bayFromPattern,
  getBayPattern,
} from '../src/domain/patterns.js'
import { cellCount } from '../src/domain/types.js'
import { validate } from '../src/domain/validate.js'
import { level, project } from './factory.js'

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

  it('gives the feature chamber centred five-wide openings', () => {
    expect(bayFromPattern('feature-chamber').cells[0]!.openingWidths).toEqual({ n: 5, e: 5, s: 5, w: 5 })
  })

  it('offers transport and item-service infrastructure bays', () => {
    expect(bayFromPattern('rail-line-bay').cells[4]!.module).toBe('rail-line')
    expect(bayFromPattern('ice-highway-bay').cells[4]!.module).toBe('ice-highway')
    expect(bayFromPattern('item-trunk-bay').cells[4]!.module).toBe('item-trunk')
  })

  it('stacks a compact stair under a compact landing 8 blocks up with no errors', () => {
    const p = project([
      level('ground', 0, { A1: bayFromPattern('compact-stair', 2) }),
      level('upper', 8, { A1: bayFromPattern('compact-landing', 2) }),
    ])
    expect(validate(p).filter((issue) => issue.severity === 'error')).toEqual([])
  })

  it('leaves building notes on the concealed room and the mine head', () => {
    expect(bayFromPattern('concealed-room').cells[7]!.note).toMatch(/^Concealed room\. Hide the north arch/)
    expect(bayFromPattern('concealed-room', 1).cells[3]!.sockets.e).toBe('arch')
    expect(bayFromPattern('mine-head').cells[4]!.note).toMatch(/^Mine head\./)
  })
})

