import { describe, expect, it } from 'vitest'

import { computeBom } from '../src/domain/bom.js'
import { interiorDetailBlocks } from '../src/domain/details.js'
import { blockKey, cellInterior, resolveBlocks } from '../src/domain/geometry.js'
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
    const cell = arena.levels[0]!.bays['A1']!.cells[0]!
    const details = interiorDetailBlocks(arena.levels[0]!.bays['A1']!, cell, cellInterior(arena, ref))

    expect(details.get('trim')?.size).toBe(24)
    expect(details.get('trim')).toContain(blockKey(3, 0, 3))
    expect(details.get('trim')).toContain(blockKey(9, 0, 9))
    expect(details.get('trim')).not.toContain(blockKey(2, 0, 3))
  })

  it('places four full-height pillars and one central ceiling light', () => {
    const cell = arena.levels[0]!.bays['A1']!.cells[0]!
    const details = interiorDetailBlocks(arena.levels[0]!.bays['A1']!, cell, cellInterior(arena, ref))

    expect(details.get('accent')?.size).toBe(44)
    expect(details.get('accent')).toContain(blockKey(3, 1, 3))
    expect(details.get('accent')).toContain(blockKey(9, 11, 9))
    expect(details.get('light')).toEqual(new Set([blockKey(6, 11, 6)]))
  })

  it('hangs the ceiling light from the ceiling in every shipped palette', () => {
    // The light sits on the top interior block with air below it, so a
    // lantern must hang and a torch cannot stand there at all.
    for (const palette of Object.values(PALETTES)) {
      const light = palette.blocks.light
      expect(light === 'minecraft:copper_bulb' || light.endsWith('[hanging=true]'), `${palette.id}: ${light}`).toBe(true)
    }
  })

  it('resolves detail roles through the room palette', () => {
    const blocks = resolveBlocks(arena)

    expect(blocks.get(blockKey(4, 0, 3))).toBe('minecraft:stone_brick_stairs')
    expect(blocks.get(blockKey(3, 5, 3))).toBe('minecraft:chiseled_stone_bricks')
    expect(blocks.get(blockKey(6, 11, 6))).toBe('minecraft:lantern[hanging=true]')
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
