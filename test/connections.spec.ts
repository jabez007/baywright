import { describe, expect, it } from 'vitest'

import { bestPatternFit, patternFitAt } from '../src/domain/connections.js'
import { BAY_PATTERN_LIST, bayFromPattern, type QuarterTurns } from '../src/domain/patterns.js'
import { validate } from '../src/domain/validate.js'
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

describe('the stamp catalog', () => {
  const faces = [
    { face: 'n', key: 'B1' },
    { face: 'e', key: 'C2' },
    { face: 's', key: 'B3' },
    { face: 'w', key: 'A2' },
  ] as const

  /** The faces where `patternId` meets a four-way junction centre to centre. */
  function openFaces(patternId: string, turns: QuarterTurns): string[] {
    const open: string[] = []
    for (const { face, key } of faces) {
      const p = project([level('L1', 0, { B2: bayFromPattern(patternId, turns), [key]: bayFromPattern('four-way-junction') })])
      const fit = patternFitAt(p, 'L1', 'B2', patternId, turns)
      // Closed, the junction's one opening goes unmatched. Open, it must match.
      if (fit.conflicts === 0) open.push(face)
      else expect(fit, `${patternId} turned ${turns}, ${face}`).toMatchObject({ conflicts: 1, matchedOpenings: 0 })
    }
    return open
  }

  it('offers exploration pieces that open where their names say', () => {
    expect(
      Object.fromEntries(
        [
          'balcony-landing',
          'dead-end',
          'side-chamber',
          'concealed-room',
          'service-junction',
          'mine-head',
          'cave-mouth',
          'compact-stair',
          'compact-landing',
        ].map((id) => [id, openFaces(id, 0)]),
      ),
    ).toEqual({
      'balcony-landing': ['e', 'w'],
      'dead-end': ['w'],
      'side-chamber': ['e', 'w'],
      'concealed-room': ['e', 'w'],
      'service-junction': ['e', 's', 'w'],
      'mine-head': ['w'],
      'cave-mouth': ['w'],
      'compact-stair': ['w'],
      'compact-landing': ['w'],
    })
  })

  it('meets a centred passage, or a closed face, on every side in every rotation', () => {
    for (const pattern of BAY_PATTERN_LIST) {
      for (const turns of [0, 1, 2, 3] as const) {
        expect(openFaces(pattern.id, turns).length, `${pattern.id} turned ${turns}`).toBeGreaterThan(0)
      }
    }
  })

  it('lets a spine next door reach every cell it builds, in every rotation', () => {
    for (const pattern of BAY_PATTERN_LIST) {
      for (const turns of [0, 1, 2, 3] as const) {
        const open = openFaces(pattern.id, turns)
        const bays: Record<string, ReturnType<typeof bayFromPattern>> = { B2: bayFromPattern(pattern.id, turns) }
        for (const { face, key } of faces) if (open.includes(face)) bays[key] = bayFromPattern('four-way-junction')
        const spineBay = bays[faces.find(({ face }) => open.includes(face))!.key]!
        spineBay.cells[4]!.module = 'spine'

        const unreached = validate(project([level('L1', 0, bays)]))
          .filter((issue) => issue.id === 'V3')
          .flatMap((issue) => issue.refs)
          .filter((ref) => ref.bayKey === 'B2')
        expect(unreached, `${pattern.id} turned ${turns}`).toEqual([])
      }
    }
  })
})
