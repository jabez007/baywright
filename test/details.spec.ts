import { describe, expect, it } from 'vitest'

import { computeBom } from '../src/domain/bom.js'
import { interiorDetailBlocks } from '../src/domain/details.js'
import { blockKey, cellInterior, resolveBlocks } from '../src/domain/geometry.js'
import { lightEmission } from '../src/domain/lighting.js'
import { cellFromModule } from '../src/domain/modules.js'
import { PALETTES } from '../src/domain/palettes.js'
import type { Cell, CellRef } from '../src/domain/types.js'
import { bay, level, project, sockets } from './factory.js'

const arena = project([
  level('L1', 0, { A1: bay('merged', () => cellFromModule('arena')) }),
])
const ref: CellRef = { levelId: 'L1', bayKey: 'A1', cellIndex: 0 }

describe('arena core and circulation ring', () => {
  it('marks a centred 7×7 core inside the 11×11 interior', () => {
    const trim = positionsOf(resolveBlocks(arena), 'minecraft:stone_brick_stairs')

    expect(trim).toHaveLength(24)
    expect(trim).toContain(blockKey(3, 0, 3))
    expect(trim).toContain(blockKey(9, 0, 9))
    expect(trim).not.toContain(blockKey(2, 0, 3))
  })

  it('faces every trim stair toward the core, with outer corners', () => {
    // The step rises on the core side, as the game shapes a ring placed by hand.
    const blocks = resolveBlocks(arena)
    const at = (x: number, z: number) => blocks.get(blockKey(x, 0, z))

    expect(at(6, 3)).toBe('minecraft:stone_brick_stairs[facing=south]')
    expect(at(6, 9)).toBe('minecraft:stone_brick_stairs[facing=north]')
    expect(at(3, 6)).toBe('minecraft:stone_brick_stairs[facing=east]')
    expect(at(9, 6)).toBe('minecraft:stone_brick_stairs[facing=west]')
    expect(at(3, 3)).toBe('minecraft:stone_brick_stairs[facing=south,shape=outer_left]')
    expect(at(9, 3)).toBe('minecraft:stone_brick_stairs[facing=south,shape=outer_right]')
    expect(at(3, 9)).toBe('minecraft:stone_brick_stairs[facing=north,shape=outer_right]')
    expect(at(9, 9)).toBe('minecraft:stone_brick_stairs[facing=north,shape=outer_left]')
  })

  it('keeps a palette trim that is not a stair as the palette names it', () => {
    const withTrim = (trim: string) =>
      resolveBlocks(
        project([level('L1', 0, { A1: bay('merged', () => cellFromModule('arena')) })], {
          palettes: { ...PALETTES, 'stone-brick': { ...PALETTES['stone-brick']!, blocks: { ...PALETTES['stone-brick']!.blocks, trim } } },
        }),
      ).get(blockKey(6, 0, 3))

    expect(withTrim('minecraft:chiseled_stone_bricks')).toBe('minecraft:chiseled_stone_bricks')
    expect(withTrim('minecraft:oak_stairs[half=top]')).toBe('minecraft:oak_stairs[facing=south,half=top]')
  })

  it('places four full-height pillars and leaves the light to the resolver', () => {
    const cell = arena.levels[0]!.bays['A1']!.cells[0]!
    const details = interiorDetailBlocks(arena.levels[0]!.bays['A1']!, cell, cellInterior(arena, ref))

    expect(details.get('accent')?.size).toBe(44)
    expect(details.get('accent')).toContain(blockKey(3, 1, 3))
    expect(details.get('accent')).toContain(blockKey(9, 11, 9))
    expect(details.has('light')).toBe(false)
  })

  it('ships a light in every palette that hangs and gives light', () => {
    // The light hangs with air below it, so a lantern must hang and a torch
    // cannot be placed at all. A copper bulb is a full block, but it must be
    // lit and waxed to give full light that stays.
    for (const palette of Object.values(PALETTES)) {
      const light = palette.blocks.light
      expect(light === 'minecraft:waxed_copper_bulb[lit=true]' || light.endsWith('[hanging=true]'), `${palette.id}: ${light}`).toBe(true)
      expect(lightEmission(light), `${palette.id}: ${light}`).toBe(15)
    }
  })

  it('resolves detail roles through the room palette', () => {
    const blocks = resolveBlocks(arena)

    expect(blocks.get(blockKey(4, 0, 3))).toBe('minecraft:stone_brick_stairs[facing=south]')
    expect(blocks.get(blockKey(3, 5, 3))).toBe('minecraft:chiseled_stone_bricks')
    // The 11-high arena lowers its lantern to y 4 on a chain.
    expect(blocks.get(blockKey(6, 4, 6))).toBe('minecraft:lantern[hanging=true]')
    expect(blocks.get(blockKey(6, 11, 6))).toBe('minecraft:chain')
  })

  it('does not detail modules without a kit, or a subdivided arena', () => {
    const storage = cellFromModule('storage')
    expect(interiorDetailBlocks(bay('merged'), storage, cellInterior(arena, ref)).size).toBe(0)
    expect(interiorDetailBlocks(bay('fine'), cellFromModule('arena'), cellInterior(arena, ref)).size).toBe(0)
  })
})

/** Every block position in the map that holds `blockId`, ignoring block states. */
function positionsOf(blocks: Map<string, string>, blockId: string): string[] {
  return [...blocks].filter(([, id]) => id.split('[')[0] === blockId).map(([key]) => key)
}

describe('library kit', () => {
  // A merged bay at A1 has an 11×11 interior at x and z 1 to 11, floor at y 0.
  const library = (overrides: Partial<Cell> = {}) =>
    project([level('L1', 0, { A1: bay('merged', () => ({ ...cellFromModule('library'), ...overrides })) })])

  it('lines the walls with bookshelves three high and leaves the doorway clear', () => {
    const blocks = resolveBlocks(library({ openingWidths: { n: 3 } }))
    const shelves = positionsOf(blocks, 'minecraft:bookshelf')

    // 40 wall-side positions, less the 3 in front of the arch, three high.
    expect(shelves).toHaveLength(37 * 3)
    expect(blocks.get(blockKey(1, 1, 1))).toBe('minecraft:bookshelf')
    expect(blocks.get(blockKey(11, 3, 11))).toBe('minecraft:bookshelf')
    expect(blocks.has(blockKey(11, 4, 11))).toBe(false)
    expect(blocks.has(blockKey(6, 1, 1))).toBe(false)
    expect(blocks.get(blockKey(4, 1, 1))).toBe('minecraft:bookshelf')
  })

  it('stands a lectern at the centre, readable from the entrance', () => {
    expect(resolveBlocks(library()).get(blockKey(6, 1, 6))).toBe('minecraft:lectern[facing=north]')

    const turned = library({ sockets: { ...cellFromModule('library').sockets, n: 'solid', w: 'arch' } })
    expect(resolveBlocks(turned).get(blockKey(6, 1, 6))).toBe('minecraft:lectern[facing=west]')
  })

  it('counts the shelves and the lectern in the bill of materials', () => {
    // The default arch is the full 11-block north wall, so 29 columns remain.
    const counts = new Map(computeBom(library()).blocks.map((entry) => [entry.blockId, entry.count]))
    expect(counts.get('minecraft:bookshelf')).toBe(29 * 3)
    expect(counts.get('minecraft:lectern')).toBe(1)
  })

  it('fits a coarse room, and skips fine cells, merged rooms, and wells', () => {
    const shelvesIn = (grain: 'fine' | 'coarse' | 'merged', overrides: Partial<Cell> = {}) =>
      positionsOf(
        resolveBlocks(project([level('L1', 0, { A1: bay(grain, () => ({ ...cellFromModule('library'), ...overrides })) })])),
        'minecraft:bookshelf',
      ).length

    // Four 5×5 interiors, each with 16 wall-side columns less its 5-wide arch.
    expect(shelvesIn('coarse')).toBe(4 * 11 * 3)
    expect(shelvesIn('fine')).toBe(0)
    expect(shelvesIn('merged', { sockets: { ...cellFromModule('library').sockets, down: 'shaft' } })).toBe(0)

    const hall = project(
      [level('L1', 0, {
        A1: bay('merged', () => ({ ...cellFromModule('library'), mergeGroup: 'hall' })),
        B1: bay('merged', () => ({ ...cellFromModule('library'), mergeGroup: 'hall' })),
      })],
    )
    expect(positionsOf(resolveBlocks(hall), 'minecraft:bookshelf')).toEqual([])
  })

  describe('over a gallery well', () => {
    // A tall library at y 0 opens into a fine gallery at y 8 whose centre
    // cell, interior x and z 5 to 7, is the well.
    const gallery = (mergeGroup: string | undefined) =>
      project([
        level('L0', 0, { A1: bay('merged', () => ({ ...cellFromModule('library'), sockets: { ...cellFromModule('library').sockets, up: 'shaft' } })) }),
        level('L8', 8, {
          A1: bay('fine', (index) => ({
            ...cellFromModule('library'),
            sockets: { ...cellFromModule('library').sockets, n: 'solid', down: index === 4 ? 'shaft' : 'solid' },
            ...(mergeGroup ? { mergeGroup } : {}),
          })),
        }),
      ])

    it('rings the well with a one-high accent rail on the gallery floor', () => {
      const blocks = resolveBlocks(gallery('gallery'))
      const rim = [...blocks].filter(([key, id]) => key.split(',')[1] === '9' && id === 'minecraft:chiseled_stone_bricks')

      expect(rim).toHaveLength(16)
      expect(blocks.get(blockKey(4, 9, 4))).toBe('minecraft:chiseled_stone_bricks')
      expect(blocks.get(blockKey(8, 9, 6))).toBe('minecraft:chiseled_stone_bricks')
      expect(blocks.has(blockKey(4, 10, 6))).toBe(false)
      expect(blocks.has(blockKey(6, 8, 6))).toBe(false) // the well itself
    })

    it('does not replace the walls of a well that is not part of a larger room', () => {
      const blocks = resolveBlocks(gallery(undefined))
      expect(blocks.get(blockKey(4, 9, 6))).toBe('minecraft:stone_bricks')
    })
  })
})

describe('rail line kit', () => {
  /**
   * The rail line bay: the middle row of a fine bay at A1, open east and west.
   * Its interiors run x 1 to 3, 5 to 7, and 9 to 11, at z 5 to 7 and y 1 to 3.
   */
  const railBay = (others: Record<string, ReturnType<typeof bay>> = {}) =>
    project([
      level('L1', 0, {
        A1: bay('fine', (index) =>
          index >= 3 && index <= 5
            ? { ...cellFromModule('rail-line'), sockets: sockets({ e: 'corridor', w: 'corridor' }) }
            : { module: 'empty' },
        ),
        ...others,
      }),
    ])

  it('lays one unbroken track down the middle, through every open seam', () => {
    const blocks = resolveBlocks(railBay())
    const track = positionsOf(blocks, 'minecraft:rail')

    expect(track).toHaveLength(13)
    for (let x = 0; x <= 12; x++) expect(blocks.get(blockKey(x, 1, 6))).toBe('minecraft:rail[shape=east_west]')
  })

  it('stops at a wall rather than cutting through it', () => {
    const blocks = resolveBlocks(railBay({ B1: bay('fine') }))
    expect(blocks.get(blockKey(12, 1, 6))).toBe('minecraft:stone_bricks')
    expect(positionsOf(blocks, 'minecraft:rail')).toHaveLength(12)
  })

  it('frames each cell with one support: two posts and a beam across the track', () => {
    const blocks = resolveBlocks(railBay())
    // Cell 4 spans x 1 to 3, so its support stands at x 2.
    expect(blocks.get(blockKey(2, 1, 5))).toBe('minecraft:chiseled_stone_bricks')
    expect(blocks.get(blockKey(2, 2, 7))).toBe('minecraft:chiseled_stone_bricks')
    for (let z = 5; z <= 7; z++) expect(blocks.get(blockKey(2, 3, z))).toBe('minecraft:stone_bricks')
    expect(blocks.has(blockKey(1, 1, 5))).toBe(false)
  })

  it('runs north to south in a cell open on those faces', () => {
    const blocks = resolveBlocks(project([level('L1', 0, { A1: bay('merged', () => cellFromModule('rail-line')) })]))
    expect(blocks.get(blockKey(6, 1, 1))).toBe('minecraft:rail[shape=north_south]')
  })
})

describe('ice highway kit', () => {
  /** The ice highway bay: the middle row of a fine bay at A1, open east and west. */
  const iceBay = () =>
    project([
      level('L1', 0, {
        A1: bay('fine', (index) =>
          index >= 3 && index <= 5
            ? { ...cellFromModule('ice-highway'), sockets: sockets({ e: 'corridor', w: 'corridor' }) }
            : { module: 'empty' },
        ),
      }),
    ])

  it('sets a blue ice lane into the floor, unbroken across the seams', () => {
    const blocks = resolveBlocks(iceBay())
    for (let x = 0; x <= 12; x++) expect(blocks.get(blockKey(x, 0, 6))).toBe('minecraft:blue_ice')
    expect(positionsOf(blocks, 'minecraft:blue_ice')).toHaveLength(13)
    expect(blocks.get(blockKey(2, 0, 5))).toBe('minecraft:stone_bricks')
  })

  it('walls the lane on both sides with a one-high accent barrier', () => {
    const blocks = resolveBlocks(iceBay())
    for (let x = 0; x <= 12; x++) {
      expect(blocks.get(blockKey(x, 1, 5))).toBe('minecraft:chiseled_stone_bricks')
      expect(blocks.get(blockKey(x, 1, 7))).toBe('minecraft:chiseled_stone_bricks')
    }
    expect(blocks.has(blockKey(2, 2, 5))).toBe(false)
    expect(blocks.has(blockKey(2, 1, 6))).toBe(false)
  })

  it('lists the ice as placed and leaves it raw, since icebergs drop it', () => {
    const bom = computeBom(iceBay())
    expect(bom.blocks.find((entry) => entry.blockId === 'minecraft:blue_ice')?.count).toBe(13)
    expect(bom.rawInputs.find((entry) => entry.blockId === 'minecraft:blue_ice')?.count).toBe(13)
  })
})

describe('nether portal kit', () => {
  const portalRoom = (grain: 'fine' | 'coarse' | 'merged', overrides: Partial<Cell> = {}) =>
    project([level('L1', 0, { A1: bay(grain, () => ({ ...cellFromModule('nether-portal'), ...overrides })) })])

  it('stands a cornerless obsidian frame across the room, facing the entrance', () => {
    const blocks = resolveBlocks(portalRoom('merged'))
    const frame = positionsOf(blocks, 'minecraft:obsidian').sort()

    // A 3×3 opening at x 5 to 7 and y 2 to 4, in the plane z 6.
    expect(frame).toEqual(
      [
        ...[5, 6, 7].flatMap((x) => [blockKey(x, 1, 6), blockKey(x, 5, 6)]),
        ...[2, 3, 4].flatMap((y) => [blockKey(4, y, 6), blockKey(8, y, 6)]),
      ].sort(),
    )
    expect(blocks.has(blockKey(6, 3, 6))).toBe(false)
    expect(blocks.has(blockKey(4, 1, 6))).toBe(false)
  })

  it('turns the frame to face a west entrance', () => {
    const blocks = resolveBlocks(portalRoom('merged', { sockets: sockets({ w: 'arch' }) }))
    expect(blocks.get(blockKey(6, 1, 5))).toBe('minecraft:obsidian')
    expect(blocks.get(blockKey(6, 3, 4))).toBe('minecraft:obsidian')
  })

  it('needs a room at least five blocks wide and high', () => {
    expect(positionsOf(resolveBlocks(portalRoom('coarse')), 'minecraft:obsidian')).toHaveLength(4 * 12)
    expect(positionsOf(resolveBlocks(portalRoom('fine')), 'minecraft:obsidian')).toEqual([])
    expect(positionsOf(resolveBlocks(portalRoom('merged', { heightCells: 1 })), 'minecraft:obsidian')).toEqual([])
  })
})

describe('super smelter kit', () => {
  const smelter = (grain: 'fine' | 'merged', overrides: Partial<Cell> = {}) =>
    project([level('L1', 0, { A1: bay(grain, () => ({ ...cellFromModule('super-smelter'), ...overrides })) })])

  it('backs a furnace row against the wall opposite the entrance, fed from above and in front', () => {
    const blocks = resolveBlocks(smelter('merged'))
    // The entrance is north, so the row stands at z 11, the back interior row.
    for (let x = 1; x <= 11; x++) {
      expect(blocks.get(blockKey(x, 1, 11))).toBe('minecraft:hopper[facing=down]')
      expect(blocks.get(blockKey(x, 2, 11))).toBe('minecraft:furnace[facing=north]')
      expect(blocks.get(blockKey(x, 3, 11))).toBe('minecraft:hopper[facing=down]')
      expect(blocks.get(blockKey(x, 2, 10))).toBe('minecraft:hopper[facing=south]')
      // Feed clearance: the space above the input hoppers stays open.
      expect(blocks.has(blockKey(x, 4, 11))).toBe(false)
    }
    expect(blocks.has(blockKey(6, 1, 10))).toBe(false)
  })

  it('counts furnaces and hoppers, and rolls furnaces back to cobblestone', () => {
    const bom = computeBom(smelter('fine'))
    const placed = new Map(bom.blocks.map((entry) => [entry.blockId, entry.count]))
    // Nine 3×3 cells, each with a three-furnace row.
    expect(placed.get('minecraft:furnace')).toBe(27)
    expect(placed.get('minecraft:hopper')).toBe(81)
    expect(bom.rawInputs.find((entry) => entry.blockId === 'minecraft:furnace')).toBeUndefined()
  })

  it('needs room for the feed above the input hoppers', () => {
    expect(positionsOf(resolveBlocks(smelter('merged', { heightCells: 1 })), 'minecraft:furnace')).toEqual([])
  })
})

describe('trading hall kit', () => {
  const hall = (grain: 'fine' | 'coarse' | 'merged', overrides: Partial<Cell> = {}) =>
    project([level('L1', 0, { A1: bay(grain, () => ({ ...cellFromModule('trading-hall'), ...overrides })) })])

  it('divides both side walls into one-wide stalls two deep, around a clear aisle', () => {
    const blocks = resolveBlocks(hall('merged'))
    // The entrance is the full north wall, so the side walls are x 1 and 11
    // and dividers stand every other block from z 3; z 1 is the doorway row.
    for (const z of [3, 5, 7, 9, 11]) {
      for (const x of [1, 2, 10, 11]) {
        expect(blocks.get(blockKey(x, 1, z))).toBe('minecraft:chiseled_stone_bricks')
        expect(blocks.get(blockKey(x, 2, z))).toBe('minecraft:chiseled_stone_bricks')
        expect(blocks.has(blockKey(x, 3, z))).toBe(false)
      }
    }
    expect(positionsOf(blocks, 'minecraft:chiseled_stone_bricks')).toHaveLength(5 * 4 * 2)
    expect(blocks.has(blockKey(1, 1, 4))).toBe(false) // a stall
    expect(blocks.has(blockKey(3, 1, 5))).toBe(false) // the aisle
    expect(blocks.has(blockKey(1, 1, 1))).toBe(false) // in front of the arch
  })

  it('runs the stalls along the walls either side of a west entrance', () => {
    const blocks = resolveBlocks(hall('merged', { sockets: sockets({ w: 'arch' }) }))
    expect(blocks.get(blockKey(3, 1, 1))).toBe('minecraft:chiseled_stone_bricks')
    expect(blocks.get(blockKey(3, 1, 10))).toBe('minecraft:chiseled_stone_bricks')
    expect(blocks.has(blockKey(1, 1, 1))).toBe(false)
  })

  it('needs room for two stall rows and an aisle', () => {
    expect(positionsOf(resolveBlocks(hall('coarse')), 'minecraft:chiseled_stone_bricks')).toHaveLength(4 * 2 * 4 * 2)
    expect(positionsOf(resolveBlocks(hall('fine')), 'minecraft:chiseled_stone_bricks')).toEqual([])
  })
})

describe('item trunk kit', () => {
  const trunk = (open: Partial<Record<'n' | 'e' | 's' | 'w', 'corridor'>>): Partial<Cell> => ({
    ...cellFromModule('item-trunk'),
    sockets: sockets(open),
  })
  const spine = (open: Partial<Record<'n' | 'e' | 's' | 'w', 'corridor'>>): Partial<Cell> => ({
    module: 'spine',
    heightCells: 2,
    sockets: sockets(open),
  })
  /** The item trunk bay: the middle row of a fine bay, open east and west. */
  const trunkRow = () => bay('fine', (index) => (index >= 3 && index <= 5 ? trunk({ e: 'corridor', w: 'corridor' }) : { module: 'empty' }))

  it('chains hoppers along the plenum floor toward a spine to the east', () => {
    const p = project(
      [level('L1', 0, { A1: trunkRow(), B1: bay('merged', () => spine({ w: 'corridor' })) })],
      { bayCols: 2, bayRows: 1 },
    )
    const blocks = resolveBlocks(p)
    // The plenum runs y 5 to 7 above the dropped ceiling at y 4.
    for (let x = 1; x <= 12; x++) expect(blocks.get(blockKey(x, 5, 6))).toBe('minecraft:hopper[facing=east]')
    expect(positionsOf(blocks, 'minecraft:hopper')).toHaveLength(12)
    expect(blocks.get(blockKey(0, 5, 6))).not.toBe('minecraft:hopper[facing=east]')
  })

  it('turns the chain round when the spine is to the west', () => {
    const p = project(
      [level('L1', 0, { A1: bay('merged', () => spine({ e: 'corridor' })), B1: trunkRow() })],
      { bayCols: 2, bayRows: 1 },
    )
    const blocks = resolveBlocks(p)
    for (let x = 12; x <= 23; x++) expect(blocks.get(blockKey(x, 5, 6))).toBe('minecraft:hopper[facing=west]')
    expect(positionsOf(blocks, 'minecraft:hopper')).toHaveLength(12)
  })

  it('leaves out the chain when no line of trunk cells reaches a spine', () => {
    const p = project([level('L1', 0, { A1: trunkRow() })], { bayCols: 1, bayRows: 1 })
    expect(positionsOf(resolveBlocks(p), 'minecraft:hopper')).toEqual([])
  })

  it('turns a corner at the centre of a cell', () => {
    // A2's west and centre cells carry the trunk east, then north through its
    // top cell into a spine at A1.
    const p = project(
      [level('L1', 0, {
        A1: bay('merged', () => spine({ s: 'corridor' })),
        A2: bay('fine', (index) =>
          index === 1 ? trunk({ n: 'corridor', s: 'corridor' })
            : index === 3 ? trunk({ e: 'corridor', w: 'corridor' })
              : index === 4 ? trunk({ n: 'corridor', w: 'corridor' })
                : { module: 'empty' },
        ),
      })],
      { bayCols: 1, bayRows: 2 },
    )
    const blocks = resolveBlocks(p)
    for (let x = 1; x <= 5; x++) expect(blocks.get(blockKey(x, 5, 18))).toBe('minecraft:hopper[facing=east]')
    for (let z = 12; z <= 18; z++) expect(blocks.get(blockKey(6, 5, z))).toBe('minecraft:hopper[facing=north]')
    expect(blocks.has(blockKey(7, 5, 18))).toBe(false)
    expect(positionsOf(blocks, 'minecraft:hopper')).toHaveLength(12)
  })
})
