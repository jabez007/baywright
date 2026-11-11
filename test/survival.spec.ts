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

  it('keeps the walls clear where a stair arrives from below', () => {
    const blocks = resolveBlocks(storage('merged', { sockets: { ...cellFromModule('storage').sockets, down: 'shaft' } }))
    expect(positionsNamed(blocks, 'barrel')).toEqual([])
  })
})

describe('a merged room', () => {
  /** Merged bays at `keys`, every cell one `module` in the group 'hall'. Bay A1 spans x and z 0 to 12. */
  const hall = (module: string, keys: readonly string[], make: (key: string) => Partial<Cell> = () => ({})): Project =>
    project([
      level('L1', 0, Object.fromEntries(keys.map((key) => [key, bay('merged', () => ({ module, mergeGroup: 'hall', ...make(key) }))]))),
    ])
  const SQUARE = ['A1', 'B1', 'A2', 'B2'] as const
  // A three-wide doorway in the middle of A1's north wall, at x 5 to 7.
  const door = (key: string): Partial<Cell> => (key === 'A1' ? { sockets: sockets({ n: 'corridor' }), openingWidths: { n: 3 } } : {})
  const nameAt = (blocks: Blocks, x: number, y: number, z: number) => parseBlockId(blocks.get(blockKey(x, y, z)) ?? 'minecraft:air').name

  it('lines the walls of a 2×2 library and leaves the carved walls bare', () => {
    const blocks = resolveBlocks(hall('library', SQUARE, door))
    // The 23×23 room has 88 wall columns, less the 3 in the doorway.
    expect(positionsNamed(blocks, 'bookshelf')).toHaveLength(85 * 3)
    expect(nameAt(blocks, 1, 1, 12)).toBe('bookshelf')
    expect(nameAt(blocks, 12, 1, 23)).toBe('bookshelf')
    for (const [x, z] of [[12, 6], [6, 12], [11, 11], [13, 13]] as const) expect(nameAt(blocks, x, 1, z), `${x},${z}`).toBe('air')
    for (const x of [5, 6, 7]) expect(nameAt(blocks, x, 1, 1), `doorway at ${x}`).toBe('air')
    expect(blocks.get(blockKey(12, 1, 12))).toBe('minecraft:lectern[facing=north]')
  })

  it('stands one enchanting table in the middle of a 2×2 workshop, with stations along the back', () => {
    const blocks = resolveBlocks(hall('workshop', SQUARE, door))
    const table = theTable(blocks)
    expect(table).toEqual({ x: 12, y: 1, z: 12 })
    expect(shelvesCounted(blocks, table)).toBeGreaterThanOrEqual(15)
    const crafting = positionsNamed(blocks, 'crafting_table')
    expect(crafting).toHaveLength(1)
    expect(crafting[0]!.z).toBe(23)
  })

  it('lines a two-bay storage hall with barrels, across the wall the merge removed', () => {
    const blocks = resolveBlocks(hall('storage', ['A1', 'B1']))
    // A 23×11 room: 64 wall columns, all solid.
    expect(positionsNamed(blocks, 'barrel')).toHaveLength(64 * 3)
    expect(nameAt(blocks, 12, 1, 1)).toBe('barrel')
    expect(nameAt(blocks, 12, 1, 6)).toBe('air')
  })

  it('waters a field that two coarse cells make, from its one centre', () => {
    // Cells 0 and 1 of a coarse bay: interiors x 1 to 5 and 7 to 11, z 1 to 5.
    const p = project([
      level('L1', 0, { A1: bay('coarse', (index) => (index < 2 ? { module: 'farm', mergeGroup: 'field' } : {})) }),
    ])
    const blocks = resolveBlocks(p)
    expect(positionsNamed(blocks, 'water')).toEqual([{ x: 6, y: 1, z: 3 }])
    expect(positionsNamed(blocks, 'farmland')).toHaveLength(9 * 3 - 1)
  })

  it('leaves a field too wide for one water block bare', () => {
    expect(positionsNamed(resolveBlocks(hall('farm', SQUARE)), 'farmland')).toEqual([])
  })

  it('fits a library into a room of four fine cells, though one fine cell is too small', () => {
    // Fine cells 0, 1, 3 and 4 make a 7×7 room at x and z 1 to 7.
    const p = project([
      level('L1', 0, { A1: bay('fine', (index) => ([0, 1, 3, 4].includes(index) ? { module: 'library', mergeGroup: 'nook' } : {})) }),
    ])
    const blocks = resolveBlocks(p)
    expect(positionsNamed(blocks, 'bookshelf')).toHaveLength(24 * 3)
    expect(blocks.get(blockKey(4, 1, 4))).toBe('minecraft:lectern[facing=north]')
  })

  it('details nothing when the members disagree on what the room is', () => {
    const p = project([
      level('L1', 0, {
        A1: bay('merged', () => ({ module: 'library', mergeGroup: 'hall' })),
        B1: bay('merged', () => ({ module: 'storage', mergeGroup: 'hall' })),
      }),
    ])
    const blocks = resolveBlocks(p)
    expect(positionsNamed(blocks, 'bookshelf')).toEqual([])
    expect(positionsNamed(blocks, 'barrel')).toEqual([])
  })
})

describe('a library balcony', () => {
  /** A 7-high library on merged bays at `keys`, entered by a three-wide doorway in the middle of A1's north wall, at x 5 to 7. */
  const tall = (keys: readonly string[], grain: 'merged' | 'coarse' = 'merged'): Project =>
    project([
      level(
        'L1',
        0,
        Object.fromEntries(
          keys.map((key) => [
            key,
            bay(grain, (index) => ({
              module: 'library',
              heightCells: 2,
              ...(keys.length > 1 ? { mergeGroup: 'hall' } : {}),
              ...(key === 'A1' && index === 0 ? { sockets: sockets({ n: 'corridor' }), openingWidths: { n: 3 } } : {}),
            })),
          ]),
        ),
      ),
    ])
  const nameAt = (blocks: Blocks, x: number, y: number, z: number) => parseBlockId(blocks.get(blockKey(x, y, z)) ?? 'minecraft:air').name
  const darkFloors = (subject: Project) => validate(subject).filter((issue) => issue.id === 'V9')

  it('runs a walkway four wide round an 11×11 room, halfway up', () => {
    // The interior spans x and z 1 to 11 and y 1 to 7. The balcony floor is at y 4.
    const blocks = resolveBlocks(tall(['A1']))
    for (const x of [1, 4, 8, 11]) expect(nameAt(blocks, x, 4, 6), `floor at x ${x}`).not.toBe('air')
    // The room's lamp hangs down to y 4 at the middle, x 6, lighting both floors.
    for (const x of [5, 7]) expect(nameAt(blocks, x, 4, 6), `open at x ${x}`).toBe('air')
    expect(nameAt(blocks, 6, 4, 4)).not.toBe('air')
    expect(nameAt(blocks, 6, 4, 5)).toBe('air')
    // A one-high rail on the walkway's inner edge, and nothing else on it.
    expect(nameAt(blocks, 4, 5, 6)).not.toBe('air')
    expect(nameAt(blocks, 4, 6, 6)).toBe('air')
    expect(nameAt(blocks, 3, 5, 6)).toBe('air')
    expect(nameAt(blocks, 6, 5, 5)).toBe('air')
  })

  it('shelves the walls three high on both floors and leaves the doorway clear', () => {
    const blocks = resolveBlocks(tall(['A1']))
    for (const y of [1, 2, 3, 5, 6, 7]) expect(nameAt(blocks, 1, y, 6), `y ${y}`).toBe('bookshelf')
    expect(nameAt(blocks, 1, 4, 6)).not.toBe('bookshelf')
    for (const x of [5, 6, 7]) {
      for (let y = 1; y <= 7; y++) expect(nameAt(blocks, x, y, 1), `doorway at ${x},${y}`).toBe('air')
    }
  })

  it('climbs to the balcony by a ladder on the back wall', () => {
    const blocks = resolveBlocks(tall(['A1']))
    for (let y = 1; y <= 4; y++) expect(blocks.get(blockKey(6, y, 11)), `y ${y}`).toBe('minecraft:ladder[facing=north]')
    for (const y of [5, 6]) expect(nameAt(blocks, 6, y, 11), `headroom at y ${y}`).toBe('air')
    expect(nameAt(blocks, 6, 1, 10)).toBe('air')
  })

  it('stands an enchanting table under the open middle in place of the lectern', () => {
    const blocks = resolveBlocks(tall(['A1']))
    const table = theTable(blocks)
    expect(table).toEqual({ x: 6, y: 1, z: 6 })
    expect(shelvesCounted(blocks, table)).toBeGreaterThanOrEqual(15)
    expect(positionsNamed(blocks, 'lectern')).toEqual([])
  })

  it('widens the walkway to five round a 23×23 room', () => {
    const blocks = resolveBlocks(tall(['A1', 'B1', 'A2', 'B2']))
    for (const x of [5, 19]) expect(nameAt(blocks, x, 4, 12), `floor at x ${x}`).not.toBe('air')
    for (const x of [6, 18]) expect(nameAt(blocks, x, 4, 12), `open at x ${x}`).toBe('air')
    expect(nameAt(blocks, 5, 5, 12)).not.toBe('air')
    for (let y = 1; y <= 4; y++) expect(nameAt(blocks, 12, y, 23), `ladder at y ${y}`).toBe('ladder')
    expect(theTable(blocks)).toEqual({ x: 12, y: 1, z: 12 })
  })

  it('asks for the ladder and the enchanting table in the bill of materials', () => {
    const counts = new Map(computeBom(tall(['A1'])).blocks.map((entry) => [entry.blockId, entry.count]))
    expect(counts.get('minecraft:ladder')).toBe(4)
    expect(counts.get('minecraft:enchanting_table')).toBe(1)
    expect(counts.get('minecraft:lectern')).toBeUndefined()
  })

  it('leaves no floor dark enough for mobs, above or below', () => {
    expect(darkFloors(tall(['A1']))).toEqual([])
    expect(darkFloors(tall(['A1', 'B1', 'A2', 'B2']))).toEqual([])
  })

  /** One 11×11×7 library bay at A1 with these wall sockets, every opening full width. */
  const walled = (open: Parameters<typeof sockets>[0]) =>
    project([level('L1', 0, { A1: bay('merged', () => ({ module: 'library', heightCells: 2, sockets: sockets(open) })) })])

  it('moves the ladder to a side wall when the back wall is all doorway', () => {
    const blocks = resolveBlocks(walled({ n: 'corridor', s: 'corridor' }))
    const ladders = positionsNamed(blocks, 'ladder')
    expect(ladders).toHaveLength(4)
    expect(new Set(ladders.map(({ x, z }) => `${x},${z}`))).toEqual(new Set(['11,6']))
    expect(blocks.get(blockKey(11, 1, 6))).toBe('minecraft:ladder[facing=west]')
  })

  it('builds no balcony it cannot climb to', () => {
    const blocks = resolveBlocks(walled({ n: 'arch', e: 'arch', s: 'arch', w: 'arch' }))
    expect(positionsNamed(blocks, 'ladder')).toEqual([])
    for (const [x, z] of [[2, 2], [10, 10]] as const) expect(nameAt(blocks, x, 4, z), `${x},${z}`).toBe('air')
    expect(positionsNamed(blocks, 'lectern')).toHaveLength(1)
  })

  it("builds each member's part of a merged balcony from that member's palette", () => {
    const room = tall(['A1', 'B1', 'A2', 'B2'])
    const b2 = room.levels[0]!.bays['B2']!
    b2.cells = b2.cells.map((cell) => ({ ...cell, paletteOverride: 'dark-oak' }))
    const blocks = resolveBlocks(room)
    const [stone, oak] = [PALETTES['stone-brick']!.blocks, PALETTES['dark-oak']!.blocks]
    expect(blocks.get(blockKey(3, 4, 3))).toBe(stone.floor)
    expect(blocks.get(blockKey(21, 4, 21))).toBe(oak.floor)
    expect(blocks.get(blockKey(19, 5, 19))).toBe(oak.accent)
    expect(blocks.get(blockKey(5, 5, 5))).toBe(stone.accent)
  })

  it('keeps a tall room narrower than 11 to one floor', () => {
    const blocks = resolveBlocks(tall(['A1'], 'coarse'))
    expect(positionsNamed(blocks, 'ladder')).toEqual([])
    expect(positionsNamed(blocks, 'lectern')).toHaveLength(4)
  })
})
