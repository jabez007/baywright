/**
 * Offset bays: a bay moved half a bay south or east of the slot its key names,
 * so it sits against two bays of the next column or row at once.
 */
import { describe, expect, it } from 'vitest'
import { blockKey, cellAABB, cellInterior, resolveBlocks, validMergeGroupIds } from '../src/domain/geometry.js'
import { bestPatternFit, patternFitAt } from '../src/domain/connections.js'
import { validate } from '../src/domain/validate.js'
import type { Bay, Project } from '../src/domain/types.js'
import { bay, level, project, sockets } from './factory.js'

/**
 * Column B holds B1 (z 0 to 12) and B2 (z 12 to 24). C1 moves half a bay
 * south, to z 6 to 18, so its west wall meets B1 over z 6 to 12 and B2 over
 * z 12 to 18, and C2 stays empty. Coarse grain gives C1 one cell against each.
 * A three-wide doorway joins C1 cell 0 to B1 cell 3, and C1 cell 2 to B2
 * cell 1. Every B cell is a spine, so each builds its walls and connectivity
 * has somewhere to start.
 */
function staggered(c1: Partial<Bay> = { offset: 'south' }): Project {
  const doorway = { openingWidths: { e: 3 as const, w: 3 as const } }
  return project([
    level('L1', 0, {
      B1: bay('coarse', (index) => ({ module: 'spine', ...(index === 3 ? { sockets: sockets({ e: 'corridor' }), ...doorway } : {}) })),
      B2: bay('coarse', (index) => ({ module: 'spine', ...(index === 1 ? { sockets: sockets({ e: 'corridor' }), ...doorway } : {}) })),
      C1: {
        ...bay('coarse', (index) => (index === 0 || index === 2 ? { sockets: sockets({ w: 'corridor' }), ...doorway } : { module: 'empty' })),
        ...c1,
      },
    }),
  ])
}

describe('a bay offset half a bay south', () => {
  it('moves its cells 6 blocks south of its slot', () => {
    const subject = staggered()
    expect(cellAABB(subject, { levelId: 'L1', bayKey: 'C1', cellIndex: 0 })).toMatchObject({ x0: 24, x1: 30, z0: 6, z1: 12 })
    expect(cellInterior(subject, { levelId: 'L1', bayKey: 'C1', cellIndex: 2 })).toMatchObject({ x0: 25, x1: 29, z0: 13, z1: 17 })
  })

  it('opens a doorway into each of the two bays it stands against', () => {
    const blocks = resolveBlocks(staggered())
    // The shared wall is x 24. Each doorway is centred on its 5-wide cell.
    for (const z of [8, 9, 10, 14, 15, 16]) {
      for (let y = 1; y <= 3; y++) expect(blocks.has(blockKey(24, y, z)), `doorway at z ${z}, y ${y}`).toBe(false)
    }
    // The end of the wall between B1 and B2 stays, between the two doorways.
    expect(blocks.has(blockKey(24, 1, 12))).toBe(true)
    // C1's south wall is at z 18, and B1's wall north of the doorways is whole.
    expect(blocks.has(blockKey(27, 1, 18))).toBe(true)
    for (const z of [2, 3, 4]) expect(blocks.has(blockKey(24, 1, z)), `B1 wall at z ${z}`).toBe(true)
  })

  it('reaches the spines through both doorways', () => {
    expect(validate(staggered()).filter((issue) => issue.id === 'V3')).toEqual([])
  })

  it('stays where its key puts it without an offset', () => {
    expect(cellAABB(staggered({}), { levelId: 'L1', bayKey: 'C1', cellIndex: 0 })).toMatchObject({ z0: 0, z1: 6 })
  })
})

describe('validating offset bays', () => {
  const only = (subject: Project, id: string) => validate(subject).filter((issue) => issue.id === id)
  const spine = { module: 'spine' as const }

  it('rejects a bay in the slot an offset bay moves into', () => {
    const subject = staggered()
    subject.levels[0]!.bays['C2'] = bay('coarse')
    const issues = only(subject, 'V12')
    expect(issues).toHaveLength(1)
    expect(issues[0]!.severity).toBe('error')
    expect(issues[0]!.message).toMatch(/^C1 and C2 overlap on level 'L1'/)
    expect(issues[0]!.refs).toContainEqual({ levelId: 'L1', bayKey: 'C1', cellIndex: 0 })
    expect(issues[0]!.refs).toContainEqual({ levelId: 'L1', bayKey: 'C2', cellIndex: 0 })
  })

  it('rejects an offset east into a neighbouring bay', () => {
    const subject = project([level('L1', 0, { B1: { ...bay('coarse'), offset: 'east' }, C1: bay('coarse') })])
    expect(only(subject, 'V12')).toHaveLength(1)
  })

  it('lets bays that only share a wall stand side by side', () => {
    expect(only(staggered(), 'V12')).toEqual([])
    const pair = project([level('L1', 0, { C1: { ...bay('coarse'), offset: 'south' }, D1: { ...bay('coarse'), offset: 'south' } })])
    expect(only(pair, 'V12')).toEqual([])
  })

  it('finds a vault that collides with a bay of another key on the level above', () => {
    // C1 is 8 high from y 0 over z 6 to 18. C2 on the level at y 4 covers z 12 to 24.
    const subject = project([
      level('L1', 0, { C1: { ...bay('coarse', () => ({ ...spine, heightCells: 2 })), offset: 'south' } }),
      level('L2', 4, { C2: bay('coarse', () => spine) }),
    ])
    const issues = only(subject, 'V1')
    expect(issues.map((issue) => issue.refs)).toEqual([
      [
        { levelId: 'L1', bayKey: 'C1', cellIndex: 2 },
        { levelId: 'L2', bayKey: 'C2', cellIndex: 0 },
      ],
      [
        { levelId: 'L1', bayKey: 'C1', cellIndex: 3 },
        { levelId: 'L2', bayKey: 'C2', cellIndex: 1 },
      ],
    ])
  })

  it('lands a stair from an offset bay in the bay above it', () => {
    // C1 cell 2 covers x 24 to 30, z 12 to 18, the same columns as C2 cell 0.
    const subject = project([
      level('L1', 0, {
        C1: { ...bay('coarse', (index) => ({ ...spine, ...(index === 2 ? { sockets: sockets({ up: 'shaft' }) } : {}) })), offset: 'south' },
      }),
      level('L2', 4, { C2: bay('coarse', (index) => ({ ...spine, ...(index === 0 ? { sockets: sockets({ down: 'shaft' }) } : {}) })) }),
    ])
    expect(only(subject, 'V4')).toEqual([])
  })

  it('keeps a fine cell solid where an offset seam leaves no cell to line up with', () => {
    // B1 cell 8 spans z 8 to 12 inside, 9 to 11. C1's fine cells along the
    // seam span z 6 to 10 and 10 to 14, so the opening would meet a wall end.
    // B1 cell 2, at z 0 to 4, faces no bay at all.
    const subject = project([
      level('L1', 0, {
        B1: bay('fine', (index) => (index === 2 || index === 8 ? { sockets: sockets({ e: 'corridor' }) } : {})),
        C1: { ...bay('fine'), offset: 'south' },
      }),
    ])
    const issues = only(subject, 'V2')
    expect(issues).toHaveLength(1)
    expect(issues[0]!.refs).toEqual([
      { levelId: 'L1', bayKey: 'B1', cellIndex: 8 },
      { levelId: 'L1', bayKey: 'C1', cellIndex: 0 },
      { levelId: 'L1', bayKey: 'C1', cellIndex: 3 },
    ])
  })

  it('lets coarse bays meet across an offset seam', () => {
    expect(only(staggered(), 'V2')).toEqual([])
  })

  it('refuses to merge a bay with a neighbour in a different position', () => {
    const subject = project([
      level('L1', 0, {
        C1: { ...bay('coarse', (index) => (index % 2 === 1 ? { mergeGroup: 'g' } : {})), offset: 'south' },
        D1: bay('coarse', (index) => (index % 2 === 0 ? { mergeGroup: 'g' } : {})),
      }),
    ])
    expect(only(subject, 'V7').map((issue) => issue.message)).toEqual([
      "Merge group 'g' mixes offsets none and south: merged cells must share an offset",
    ])
    expect(validMergeGroupIds(subject).has('g')).toBe(false)
  })
})

describe('fitting a pattern to an offset bay', () => {
  it('meets both bays across the offset seam', () => {
    // A workshop bay opens both west cells, which C1 places at z 7 to 11 and
    // 13 to 17, against B1's doorway and B2's.
    expect(patternFitAt(staggered(), 'L1', 'C1', 'workshop-bay', 0)).toMatchObject({
      compatible: true,
      checkedNeighbours: 2,
      matchedOpenings: 4,
      conflicts: 0,
    })
    expect(bestPatternFit(staggered(), 'L1', 'C1', 'workshop-bay').quarterTurns).toBe(0)
  })

  it('refuses a fine doorway that only touches the doorways across an offset seam', () => {
    // C1's middle west cell spans z 11 to 13 inside. B1 cell 8 spans 9 to 11
    // and B2 cell 2 spans 13 to 15, so V2 would reject the stamp. The
    // passage's doorway goes unmatched against each bay, and each bay's too.
    const subject = project([
      level('L1', 0, {
        B1: bay('fine', (index) => (index === 8 ? { sockets: sockets({ e: 'corridor' }) } : {})),
        B2: bay('fine', (index) => (index === 2 ? { sockets: sockets({ e: 'corridor' }) } : {})),
        C1: { ...bay('fine'), offset: 'south' },
      }),
    ])
    expect(patternFitAt(subject, 'L1', 'C1', 'straight-passage', 0)).toMatchObject({ compatible: false, matchedOpenings: 0, conflicts: 4 })
  })

  it('ignores openings of a neighbour that face past the offset bay', () => {
    // B1's cell 1 opens east at z 1 to 5, where C1 does not reach.
    const subject = staggered()
    subject.levels[0]!.bays['B1']!.cells[1]!.sockets.e = 'corridor'
    expect(patternFitAt(subject, 'L1', 'C1', 'workshop-bay', 0).conflicts).toBe(0)
  })
})
