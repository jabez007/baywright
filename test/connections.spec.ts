import { describe, expect, it } from 'vitest'

import { bestPatternFit, patternFitAt } from '../src/domain/connections.js'
import { BAY_PATTERN_LIST, bayFromPattern, type QuarterTurns } from '../src/domain/patterns.js'
import { validate } from '../src/domain/validate.js'
import { bay, level, project, sockets } from './factory.js'

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

  it('refuses a fine doorway that straddles the joint between two coarse ones', () => {
    // The passage's middle east cell spans 5 to 7 inside. B1's doorways span
    // 1 to 5 and 7 to 11, so each shares one block with it and neither holds it.
    const p = project([
      level('L1', 0, {
        A1: bay('fine'),
        B1: bay('coarse', (index) => (index === 0 || index === 2 ? { sockets: sockets({ w: 'corridor' }) } : {})),
      }),
    ], { bayCols: 2, bayRows: 1 })
    expect(patternFitAt(p, 'L1', 'A1', 'straight-passage', 0)).toMatchObject({ compatible: false, matchedOpenings: 0, conflicts: 3 })
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

  /**
   * A neighbour with one centred opening on each face. A fine junction's middle
   * doorway straddles the joint between two coarse cells, which V2 rejects, so
   * a coarse pattern meets a merged chamber instead.
   */
  function partnerFor(patternId: string): string {
    return BAY_PATTERN_LIST.find((pattern) => pattern.id === patternId)!.grain === 'coarse' ? 'feature-chamber' : 'four-way-junction'
  }

  /** The faces where `patternId` meets its partner centre to centre. */
  function openFaces(patternId: string, turns: QuarterTurns): string[] {
    const open: string[] = []
    for (const { face, key } of faces) {
      const p = project([level('L1', 0, { B2: bayFromPattern(patternId, turns), [key]: bayFromPattern(partnerFor(patternId)) })])
      const fit = patternFitAt(p, 'L1', 'B2', patternId, turns)
      // Closed, the partner's one opening goes unmatched. Open, it must match.
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

  it('lets a spine next door reach every cell it builds, in every rotation, across seams V2 accepts', () => {
    for (const pattern of BAY_PATTERN_LIST) {
      for (const turns of [0, 1, 2, 3] as const) {
        const open = openFaces(pattern.id, turns)
        const bays: Record<string, ReturnType<typeof bayFromPattern>> = { B2: bayFromPattern(pattern.id, turns) }
        for (const { face, key } of faces) if (open.includes(face)) bays[key] = bayFromPattern(partnerFor(pattern.id))
        const spineBay = bays[faces.find(({ face }) => open.includes(face))!.key]!
        spineBay.cells[Math.floor(spineBay.cells.length / 2)]!.module = 'spine'

        const issues = validate(project([level('L1', 0, bays)]))
        const unreached = issues
          .filter((issue) => issue.id === 'V3')
          .flatMap((issue) => issue.refs)
          .filter((ref) => ref.bayKey === 'B2')
        expect(unreached, `${pattern.id} turned ${turns}`).toEqual([])
        expect(issues.filter((issue) => issue.id === 'V2'), `${pattern.id} turned ${turns}`).toEqual([])
      }
    }
  })
})
