/**
 * Offset bays: a bay moved half a bay south or east of the slot its key names,
 * so it sits against two bays of the next column or row at once.
 */
import { describe, expect, it } from 'vitest'
import { blockKey, cellAABB, cellInterior, resolveBlocks } from '../src/domain/geometry.js'
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
