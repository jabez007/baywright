/**
 * Kits for the rooms a survival player uses every session.
 *
 * The checks apply the game's own rules to the resolved blocks rather than
 * reading back where the kit meant to put things. An enchanting table counts
 * a bookshelf exactly two blocks out along one axis and up to two along the
 * other, level with the table or one higher, when the block halfway between
 * them at the shelf's height is air. Java takes that halfway block by
 * rounding each offset toward zero. Bedrock needs air at both heights.
 */
import { describe, expect, it } from 'vitest'
import { blockKey, parseBlockKey, resolveBlocks } from '../src/domain/geometry.js'
import { canSpawnOn, lightEmission, parseBlockId } from '../src/domain/lighting.js'
import { cellFromModule } from '../src/domain/modules.js'
import { validate } from '../src/domain/validate.js'
import type { Cell, Project } from '../src/domain/types.js'
import { bay, level, project, sockets } from './factory.js'

type Blocks = Map<string, string>
interface Point {
  x: number
  y: number
  z: number
}

/** Every position holding a block named `name`, ignoring block states. */
function positionsNamed(blocks: Blocks, name: string): Point[] {
  return [...blocks]
    .filter(([, blockId]) => parseBlockId(blockId).name === name)
    .map(([at]) => parseBlockKey(at))
}

/** The bookshelves an enchanting table at `table` counts, before the cap of 15. */
function shelvesCounted(blocks: Blocks, table: Point): number {
  let count = 0
  for (let dy = 0; dy <= 1; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== 2) continue
        const shelf = blocks.get(blockKey(table.x + dx, table.y + dy, table.z + dz))
        const between = blocks.get(blockKey(table.x + Math.trunc(dx / 2), table.y + dy, table.z + Math.trunc(dz / 2)))
        if (shelf === 'minecraft:bookshelf' && between === undefined) count++
      }
    }
  }
  return count
}

/** The one enchanting table in the plan, which must exist. */
function theTable(blocks: Blocks): Point {
  const tables = positionsNamed(blocks, 'enchanting_table')
  expect(tables).toHaveLength(1)
  return tables[0]!
}

const workshop = (grain: 'coarse' | 'merged', overrides: Partial<Cell> = {}): Project =>
  project([level('L1', 0, { A1: bay(grain, (index) => (index === 0 ? { ...cellFromModule('workshop'), ...overrides } : {})) })])

describe('workshop kit', () => {
  describe('in a merged workshop', () => {
    it('rings an enchanting table with the 15 bookshelves level 30 enchantments need', () => {
      const blocks = resolveBlocks(workshop('merged'))
      const table = theTable(blocks)
      expect(table).toEqual({ x: 6, y: 1, z: 6 })
      expect(shelvesCounted(blocks, table)).toBe(15)
      // Every shelf placed is one the table counts.
      expect(positionsNamed(blocks, 'bookshelf')).toHaveLength(15)
    })

    it('keeps the ring between table and shelves clear at both heights, and leaves a way in from the door', () => {
      const blocks = resolveBlocks(workshop('merged'))
      const table = theTable(blocks)
      for (let dy = 0; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          for (let dz = -1; dz <= 1; dz++) {
            if (dx === 0 && dz === 0) continue
            expect(blocks.get(blockKey(table.x + dx, table.y + dy, table.z + dz)), `gap at ${dx},${dy},${dz}`).toBeUndefined()
          }
        }
        // The door is on the north side, so the shelf ring opens to the north.
        expect(blocks.get(blockKey(table.x, table.y + dy, table.z - 2))).toBeUndefined()
      }
    })

    it('stands the crafting stations along the wall opposite the door', () => {
      const blocks = resolveBlocks(workshop('merged'))
      const back = [4, 5, 6, 7, 8].map((x) => parseBlockId(blocks.get(blockKey(x, 1, 11)) ?? 'minecraft:air').name)
      expect(back).toEqual(['crafting_table', 'smithing_table', 'anvil', 'grindstone', 'stonecutter'])
      expect(parseBlockId(blocks.get(blockKey(7, 1, 11))!).state.face).toBe('floor')
    })

    it('leaves no floor dark enough for mobs', () => {
      expect(validate(workshop('merged')).filter((issue) => issue.id === 'V9')).toEqual([])
    })
  })

  it('gives the enchanting table its light of 7, and spawns nothing on blocks short of a full one', () => {
    expect(lightEmission('minecraft:enchanting_table')).toBe(7)
    for (const name of ['enchanting_table', 'anvil', 'grindstone', 'stonecutter']) expect(canSpawnOn(`minecraft:${name}`), name).toBe(false)
    for (const name of ['bookshelf', 'crafting_table', 'smithing_table']) expect(canSpawnOn(`minecraft:${name}`), name).toBe(true)
  })

  describe('in a coarse workshop, where the shelf ring meets the walls', () => {
    it('keeps the doorway clear and lifts the shelves it displaces to the back of the ring', () => {
      const blocks = resolveBlocks(workshop('coarse', { openingWidths: { n: 3 } }))
      const table = theTable(blocks)
      expect(table).toEqual({ x: 3, y: 1, z: 3 })
      expect(shelvesCounted(blocks, table)).toBe(15)
      for (const x of [2, 3, 4]) {
        for (const y of [1, 2, 3]) expect(blocks.get(blockKey(x, y, 1)), `doorway at ${x},${y}`).toBeUndefined()
      }
      const upper = positionsNamed(blocks, 'bookshelf').filter((shelf) => shelf.y === 2)
      expect(upper.every((shelf) => shelf.z === 5)).toBe(true)
    })

    it('places no enchanting table when doorways leave too few places for 15 shelves', () => {
      const open = { n: 'corridor', e: 'corridor', s: 'corridor', w: 'corridor' } as const
      const blocks = resolveBlocks(workshop('coarse', { sockets: sockets(open), openingWidths: { n: 3, e: 3, s: 3, w: 3 } }))
      expect(positionsNamed(blocks, 'enchanting_table')).toEqual([])
      expect(positionsNamed(blocks, 'bookshelf')).toEqual([])
    })
  })
})
