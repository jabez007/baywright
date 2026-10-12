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
import { computeBom } from '../src/domain/bom.js'
import { blockKey, parseBlockKey, resolveBlocks, resolveLight } from '../src/domain/geometry.js'
import { canSpawnOn, lightEmission, parseBlockId } from '../src/domain/lighting.js'
import { cellFromModule } from '../src/domain/modules.js'
import { PALETTES } from '../src/domain/palettes.js'
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

const farm = (grain: 'coarse' | 'merged', overrides: Partial<Project> = {}): Project =>
  project([level('L1', 0, { A1: bay(grain, (index) => (index === 0 ? cellFromModule('farm') : {})) }, { name: 'Fields' })], overrides)

/** Farmland is wet when water sits within four blocks across, level with it or one higher. */
function isHydrated(blocks: Blocks, land: Point): boolean {
  for (let dy = 0; dy <= 1; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      for (let dz = -4; dz <= 4; dz++) {
        if (blocks.get(blockKey(land.x + dx, land.y + dy, land.z + dz)) === 'minecraft:water') return true
      }
    }
  }
  return false
}

describe('farm kit', () => {
  it('fills a merged farm with a 9×9 field that one water block keeps wet', () => {
    const blocks = resolveBlocks(farm('merged'))
    const land = positionsNamed(blocks, 'farmland')
    expect(land).toHaveLength(80)
    expect(positionsNamed(blocks, 'water')).toEqual([{ x: 6, y: 1, z: 6 }])
    for (const block of land) expect(isHydrated(blocks, block), `farmland at ${block.x},${block.z}`).toBe(true)
    // A walkway one block wide runs round the walls, so the door is clear and no one tramples the field.
    for (let i = 1; i <= 11; i++) {
      for (const [x, z] of [[i, 1], [i, 11], [1, i], [11, i]] as const) expect(blocks.get(blockKey(x, 1, z)), `walkway ${x},${z}`).toBeUndefined()
    }
  })

  it('lights every crop enough to grow, with headroom over the walkway', () => {
    const p = farm('merged')
    const light = resolveLight(p)
    for (const block of positionsNamed(resolveBlocks(p), 'farmland')) {
      expect(light.lightAt(block.x, block.y + 1, block.z), `crop over ${block.x},${block.z}`).toBeGreaterThanOrEqual(9)
    }
    const issues = validate(p)
    expect(issues.filter((issue) => issue.id === 'V9' || issue.id === 'V11')).toEqual([])
  })

  it('fits a 3×3 field in a coarse farm', () => {
    const p = farm('coarse')
    const blocks = resolveBlocks(p)
    expect(positionsNamed(blocks, 'farmland')).toHaveLength(8)
    expect(positionsNamed(blocks, 'water')).toEqual([{ x: 3, y: 1, z: 3 }])
    // The field's corner lamps would hang in front of the north doorway, so only the back two do.
    for (let x = 1; x <= 5; x++) {
      for (const y of [1, 2, 3]) expect(blocks.get(blockKey(x, y, 1)), `doorway at ${x},${y}`).toBeUndefined()
    }
    expect(validate(p).filter((issue) => issue.id === 'V9' || issue.id === 'V11')).toEqual([])
  })

  it('warns when the palette light leaves the crops too dark to grow', () => {
    const unlit = { ...PALETTES['stone-brick']!, blocks: { ...PALETTES['stone-brick']!.blocks, light: 'minecraft:copper_bulb' } }
    const issues = validate(farm('merged', { palettes: { ...PALETTES, 'stone-brick': unlit } })).filter((issue) => issue.id === 'V11')
    expect(issues).toHaveLength(1)
    expect(issues[0]!.severity).toBe('warning')
    expect(issues[0]!.message).toBe("Level 'Fields' has 80 farmland blocks too dark for crops, which need light 9 to grow")
    expect(issues[0]!.refs).toEqual([{ levelId: 'L1', bayKey: 'A1', cellIndex: 0 }])
  })

  it('counts a crop in light 8 as too dark, and one in light 9 as lit', () => {
    // A soul lantern gives 10, so only the crop right under each of the four lamps gets 9.
    const soul = { ...PALETTES['stone-brick']!, blocks: { ...PALETTES['stone-brick']!.blocks, light: 'minecraft:soul_lantern[hanging=true]' } }
    const issues = validate(farm('merged', { palettes: { ...PALETTES, 'stone-brick': soul } })).filter((issue) => issue.id === 'V11')
    expect(issues.map((issue) => issue.message)).toEqual(["Level 'Fields' has 76 farmland blocks too dark for crops, which need light 9 to grow"])
  })

  it('lists dirt and a water bucket for the field, not blocks no one can carry', () => {
    const bom = computeBom(farm('merged'))
    const raw = (blockId: string) => bom.rawInputs.find((entry) => entry.blockId === blockId)?.count
    expect(raw('minecraft:dirt')).toBe(80)
    expect(raw('minecraft:water_bucket')).toBe(1)
    expect(raw('minecraft:farmland')).toBeUndefined()
    expect(raw('minecraft:water')).toBeUndefined()
    expect(canSpawnOn('minecraft:water')).toBe(false)
  })
})

describe('storage kit', () => {
  const storage = (grain: 'fine' | 'merged', overrides: Partial<Cell> = {}): Project =>
    project([level('L1', 0, { A1: bay(grain, (index) => (index === (grain === 'fine' ? 4 : 0) ? { ...cellFromModule('storage'), ...overrides } : {})) })])

  /** Interior columns along the walls of a room spanning `lo` to `hi` on both axes. */
  const wallColumns = (lo: number, hi: number) => {
    const columns: Array<[number, number]> = []
    for (let x = lo; x <= hi; x++) for (let z = lo; z <= hi; z++) if (x === lo || x === hi || z === lo || z === hi) columns.push([x, z])
    return columns
  }

  it('lines every wall of a merged storage room with barrels three high, clear of the door', () => {
    const blocks = resolveBlocks(storage('merged'))
    const barrels = positionsNamed(blocks, 'barrel')
    // 40 wall columns, less the 11 along the open north side.
    expect(barrels).toHaveLength(29 * 3)
    for (const [x, z] of wallColumns(1, 11)) {
      for (const y of [1, 2, 3]) {
        const name = parseBlockId(blocks.get(blockKey(x, y, z)) ?? 'minecraft:air').name
        expect(name, `${x},${y},${z}`).toBe(z === 1 ? 'air' : 'barrel')
      }
    }
  })

  it('opens each barrel toward the room', () => {
    const blocks = resolveBlocks(storage('merged'))
    expect(parseBlockId(blocks.get(blockKey(6, 1, 11))!).state.facing).toBe('north')
    expect(parseBlockId(blocks.get(blockKey(1, 1, 6))!).state.facing).toBe('east')
    expect(parseBlockId(blocks.get(blockKey(11, 1, 6))!).state.facing).toBe('west')
  })

  it('stops at three high in a taller room, within reach from the floor, and lights it', () => {
    const p = storage('merged', { heightCells: 2 })
    const barrels = positionsNamed(resolveBlocks(p), 'barrel')
    expect(barrels).toHaveLength(29 * 3)
    expect(Math.max(...barrels.map((barrel) => barrel.y))).toBe(3)
    expect(validate(p).filter((issue) => issue.id === 'V9')).toEqual([])
  })

  it('fits a fine storage room around its doorway', () => {
    // Cell 4 of a fine bay has its interior at x and z 5 to 7.
    const blocks = resolveBlocks(storage('fine', { openingWidths: { n: 3 } }))
    expect(positionsNamed(blocks, 'barrel')).toHaveLength(5 * 3)
    for (const x of [5, 6, 7]) expect(blocks.get(blockKey(x, 1, 5)), `doorway at ${x}`).toBeUndefined()
  })

  it('leaves a merged hall bare rather than wall off its members from each other', () => {
    const hall = project([
      level('L1', 0, {
        A1: bay('merged', () => ({ ...cellFromModule('storage'), mergeGroup: 'hall' })),
        B1: bay('merged', () => ({ ...cellFromModule('storage'), mergeGroup: 'hall' })),
      }),
    ])
    expect(positionsNamed(resolveBlocks(hall), 'barrel')).toEqual([])
  })

  it('keeps the walls clear where a stair arrives from below', () => {
    const blocks = resolveBlocks(storage('merged', { sockets: { ...cellFromModule('storage').sockets, down: 'shaft' } }))
    expect(positionsNamed(blocks, 'barrel')).toEqual([])
  })
})
