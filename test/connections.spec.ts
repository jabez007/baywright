import { describe, expect, it } from 'vitest'

import { bestPatternFit, patternFitAt } from '../src/domain/connections.js'
import { bayFromPattern } from '../src/domain/patterns.js'
import { level, project } from './factory.js'

describe('connection-aware bay patterns', () => {
  it('keeps the catalog orientation when no present neighbour constrains it', () => {
    const p = project([level('L1', 0, { B2: bayFromPattern('straight-passage') })])
    expect(bestPatternFit(p, 'L1', 'B2', 'corner-passage')).toMatchObject({
      quarterTurns: 0,
      compatible: true,
      checkedNeighbours: 0,
    })
  })

  it('rotates a straight passage to meet a north neighbour', () => {
    const p = project([
      level('L1', 0, {
        B1: bayFromPattern('straight-passage', 1),
        B2: bayFromPattern('feature-chamber'),
      }),
    ])
    expect(bestPatternFit(p, 'L1', 'B2', 'straight-passage')).toMatchObject({
      quarterTurns: 1,
      compatible: true,
      checkedNeighbours: 1,
      matchedOpenings: 2,
      conflicts: 0,
    })
  })

  it('marks a rotation that closes an existing connection as incompatible', () => {
    const p = project([
      level('L1', 0, {
        A1: bayFromPattern('straight-passage'),
        B1: bayFromPattern('feature-chamber'),
      }),
    ], { bayCols: 2, bayRows: 1 })

    expect(patternFitAt(p, 'L1', 'B1', 'corner-passage', 0).compatible).toBe(true)
    expect(patternFitAt(p, 'L1', 'B1', 'corner-passage', 1)).toMatchObject({
      compatible: false,
      conflicts: 1,
    })
  })
})
