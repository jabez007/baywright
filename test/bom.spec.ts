/**
 * PRD §9 — Bill of materials.
 *
 * The block counts below come from the F9 shell: a single merged bay at y 0,
 * heightCells 2, all sockets solid. 674 blocks — a 13 x 13 floor plane (169),
 * a 13 x 13 ceiling plane (169), and 336 of wall.
 */
import { describe, expect, it } from 'vitest'
import { bomFromBlocks, computeBom, formatDuration, formatStacks, rollUpRawInputs, toStacks } from '../src/domain/bom.js'
import { cellFromModule } from '../src/domain/modules.js'
import { bay, level, project } from './factory.js'

const shell = (paletteId: string) =>
  project([level('L1', 0, { A1: bay('merged', () => ({ heightCells: 2 })) }, { paletteId })])

const countOf = (entries: { blockId: string; count: number }[], blockId: string) =>
  entries.find((entry) => entry.blockId === blockId)?.count

describe('stacks', () => {
  it('formats as the PRD writes it', () => {
    expect(formatStacks(2636)).toBe('41 stacks + 12')
  })

  it('drops the remainder on a whole number of stacks', () => {
    expect(formatStacks(128)).toBe('2 stacks')
    expect(formatStacks(64)).toBe('1 stack')
  })

  it('drops the stacks below a full one', () => {
    expect(formatStacks(12)).toBe('12')
    expect(formatStacks(0)).toBe('0')
    expect(formatStacks(65)).toBe('1 stack + 1')
  })

  it('reports slots separately from full stacks', () => {
    // 41 full stacks and 12 loose, but 42 inventory slots to hold them.
    expect(toStacks(2636)).toEqual({ total: 2636, stacks: 41, remainder: 12, slots: 42, label: '41 stacks + 12' })
  })
})

describe('block totals', () => {
  const bom = computeBom(shell('stone-brick'))

  it('totals every placed block', () => {
    // The shell, plus a lantern hung at y 4 on three chain blocks.
    expect(bom.totalBlocks).toBe(674 + 4)
    expect(countOf(bom.blocks, 'minecraft:lantern')).toBe(1)
    expect(countOf(bom.blocks, 'minecraft:chain')).toBe(3)
  })

  it('splits the shell across the palette roles', () => {
    expect(countOf(bom.blocks, 'minecraft:stone_bricks')).toBe(505) // floor 169 + wall 336
    expect(countOf(bom.blocks, 'minecraft:polished_andesite')).toBe(169) // ceiling
  })

  it('sorts the biggest pile first and carries its stack label', () => {
    expect(bom.blocks[0]!.blockId).toBe('minecraft:stone_bricks')
    expect(bom.blocks[0]!.stacks.label).toBe('7 stacks + 57')
  })

  it('includes the arena core trim, pillars, and light', () => {
    const arena = project([
      level('L1', 0, { A1: bay('merged', () => cellFromModule('arena')) }, { paletteId: 'tuff-copper' }),
    ])
    const detailed = computeBom(arena)

    expect(countOf(detailed.blocks, 'minecraft:tuff_brick_stairs')).toBe(24)
    expect(countOf(detailed.blocks, 'minecraft:oxidized_copper')).toBe(44)
    // The 11-high room lowers its bulb to y 4 on a chain filling y 5 to 11.
    expect(countOf(detailed.blocks, 'minecraft:waxed_copper_bulb')).toBe(1)
    expect(countOf(detailed.blocks, 'minecraft:chain')).toBe(7)
  })
})

describe('raw input rollup', () => {
  it('walks stone bricks back to cobblestone', () => {
    const bom = computeBom(shell('stone-brick'))
    expect(countOf(bom.rawInputs, 'minecraft:cobblestone')).toBe(505)
    expect(countOf(bom.rawInputs, 'minecraft:stone')).toBeUndefined()
    expect(countOf(bom.rawInputs, 'minecraft:stone_bricks')).toBeUndefined()
  })

  it('leaves blocks with no recipe as themselves, so the list is the whole gather', () => {
    const bom = computeBom(shell('stone-brick'))
    expect(countOf(bom.rawInputs, 'minecraft:polished_andesite')).toBe(169)
  })

  it('converts planks back to logs at 4:1, rounding the part-log up', () => {
    const bom = computeBom(shell('dark-oak'))
    expect(countOf(bom.blocks, 'minecraft:dark_oak_planks')).toBe(674)
    expect(countOf(bom.rawInputs, 'minecraft:dark_oak_log')).toBe(169) // 674 / 4 = 168.5
  })

  it('accumulates fractions across a chain before rounding', () => {
    // 169 tuff bricks + 336 polished tuff + 169 slabs (2 per brick) = 589.5 tuff.
    const bom = computeBom(shell('tuff-copper'))
    expect(countOf(bom.rawInputs, 'minecraft:tuff')).toBe(590)
  })

  it('walks deepslate tiles back to cobbled deepslate', () => {
    const { raw } = rollUpRawInputs(new Map([['minecraft:deepslate_tiles', 13]]))
    expect(raw.get('minecraft:cobbled_deepslate')).toBe(13)
  })

  it('rounds wooden stairs and slabs to complete crafting batches', () => {
    const oneStair = rollUpRawInputs(new Map([['minecraft:dark_oak_stairs', 1]])).raw
    const sevenSlabs = rollUpRawInputs(new Map([['minecraft:dark_oak_slab', 7]])).raw
    expect(oneStair.get('minecraft:dark_oak_log')).toBe(2)
    expect(sevenSlabs.get('minecraft:dark_oak_log')).toBe(2)
  })

  it('does not fold unrelated blocks together', () => {
    const { raw } = rollUpRawInputs(new Map([['minecraft:iron_bars', 40]]))
    expect(raw.get('minecraft:iron_bars')).toBe(40)
  })
})

describe('furnace time', () => {
  it('counts one smelt per cobblestone and names both ends of the step', () => {
    const bom = computeBom(shell('stone-brick'))
    expect(bom.smelting.items).toBe(505)
    expect(bom.smelting.steps).toEqual([{ blockId: 'minecraft:stone', from: 'minecraft:cobblestone', items: 505 }])
  })

  it('runs 10 seconds per item on one furnace', () => {
    const bom = computeBom(shell('stone-brick'))
    expect(bom.smelting.furnaces).toBe(1)
    expect(bom.smelting.seconds).toBe(5050)
    expect(bom.smelting.label).toBe('1h 24m 10s')
  })

  it('divides across a configurable furnace count', () => {
    const bom = computeBom(shell('stone-brick'), { furnaces: 5 })
    expect(bom.smelting.seconds).toBe(1010) // ceil(505 / 5) rounds up the ragged last batch
    expect(bom.smelting.label).toBe('16m 50s')
  })

  it('reports nothing to smelt for a stonecutter-only chain', () => {
    const bom = computeBom(shell('tuff-copper'))
    expect(bom.smelting.items).toBe(0)
    expect(bom.smelting.seconds).toBe(0)
    expect(bom.smelting.label).toBe('0s')
  })

  it('formats durations without empty units', () => {
    expect(formatDuration(40)).toBe('40s')
    expect(formatDuration(600)).toBe('10m')
    expect(formatDuration(3600)).toBe('1h')
  })
})

describe('bomFromBlocks', () => {
  it('works straight off a block map', () => {
    const blocks = new Map<string, string>([
      ['0,0,0', 'minecraft:stone_bricks'],
      ['0,0,1', 'minecraft:stone_bricks'],
      ['0,0,2', 'minecraft:oak_planks'],
    ])
    const bom = bomFromBlocks(blocks)
    expect(bom.totalBlocks).toBe(3)
    expect(countOf(bom.rawInputs, 'minecraft:cobblestone')).toBe(2)
    expect(countOf(bom.rawInputs, 'minecraft:oak_log')).toBe(1) // 0.25 of a log, rounded up
    expect(bom.smelting.items).toBe(2)
  })

  it('counts a block in any state as the item you carry', () => {
    const blocks = new Map<string, string>([
      ['0,0,0', 'minecraft:lantern[hanging=true]'],
      ['0,0,1', 'minecraft:lantern'],
      ['0,0,2', 'minecraft:oak_stairs[facing=east,half=top]'],
    ])
    const bom = bomFromBlocks(blocks)
    expect(bom.blocks.map((entry) => [entry.blockId, entry.count])).toEqual([
      ['minecraft:lantern', 2],
      ['minecraft:oak_stairs', 1],
    ])
    // Oak stairs still walk back to logs once the state is gone.
    expect(countOf(bom.rawInputs, 'minecraft:oak_log')).toBe(2)
  })
})

describe('digging', () => {
  // One merged bay is 13 × 13 = 169 blocks a layer, walls included.
  const LAYER = 169
  const buried = (...levels: Array<[string, number, 1 | 2]>) =>
    project(levels.map(([id, y, heightCells]) => level(id, y, { A1: bay('merged', () => ({ heightCells })) }, { name: id })))

  it('digs nothing when the ground surface is unknown', () => {
    expect(computeBom(buried(['Deep', -8, 2])).digging).toBeNull()
  })

  it('digs out every block of a buried room, walls included, and counts what it gives back', () => {
    // y -8 to 0: eight layers of deepslate below y 0 and one of stone at y 0.
    const p = { ...buried(['Deep', -8, 2]), surfaceY: 63 }
    const digging = computeBom(p).digging!
    expect(digging.surfaceY).toBe(63)
    expect(digging.blocks).toBe(9 * LAYER)
    expect(digging.yields.map(({ blockId, count }) => [blockId, count])).toEqual([
      ['minecraft:cobbled_deepslate', 8 * LAYER],
      ['minecraft:cobblestone', LAYER],
    ])
    expect(digging.levels).toEqual([{ levelId: 'Deep', name: 'Deep', ground: 'underground', blocks: 9 * LAYER }])
  })

  it('takes the top four blocks of ground as dirt', () => {
    // y 60 to 64 against a surface at 62: layers 60, 61 and 62 lie in the ground.
    const p = { ...buried(['Half', 60, 1]), surfaceY: 62 }
    const digging = computeBom(p).digging!
    expect(digging.blocks).toBe(3 * LAYER)
    expect(digging.yields.map(({ blockId, count }) => [blockId, count])).toEqual([['minecraft:dirt', 3 * LAYER]])
    expect(digging.levels[0]!.ground).toBe('partly')

    const deeper = computeBom({ ...buried(['Half', 52, 1]), surfaceY: 58 }).digging!
    // y 52 to 56: 52 to 54 are stone, and 55 and 56 are within four of the surface.
    expect(deeper.yields.map(({ blockId, count }) => [blockId, count])).toEqual([
      ['minecraft:cobblestone', 3 * LAYER],
      ['minecraft:dirt', 2 * LAYER],
    ])
  })

  it('counts a plane two levels share once, on the lower level', () => {
    const p = { ...buried(['Lower', -8, 2], ['Upper', 0, 1], ['Tower', 64, 1]), surfaceY: 63 }
    const digging = computeBom(p).digging!
    expect(digging.blocks).toBe(13 * LAYER)
    expect(digging.levels).toEqual([
      { levelId: 'Lower', name: 'Lower', ground: 'underground', blocks: 9 * LAYER },
      { levelId: 'Upper', name: 'Upper', ground: 'underground', blocks: 4 * LAYER },
      { levelId: 'Tower', name: 'Tower', ground: 'above', blocks: 0 },
    ])
  })
})

describe('materials by level', () => {
  const stored = (id: string, y: number, bays: Parameters<typeof level>[2]) => level(id, y, bays, { name: `${id} level` })
  const lower = () => stored('Lower', 0, { A1: bay('merged', () => ({ heightCells: 1 })) })
  const upper = () => stored('Upper', 4, { A1: bay('merged', () => ({ heightCells: 1 })) })

  it('lists each built level, lowest first, with its own materials', () => {
    const levels = computeBom(project([upper(), lower(), stored('Empty', 8, {})])).levels
    expect(levels.map(({ levelId, name }) => [levelId, name])).toEqual([
      ['Lower', 'Lower level'],
      ['Upper', 'Upper level'],
    ])
  })

  it('counts a plane two levels share once, on the lower level', () => {
    const stack = computeBom(project([lower(), upper()]))
    const alone = computeBom(project([lower()]))
    const [below, above] = stack.levels
    // The lower level takes as many blocks as building it on its own, roof
    // included, though the roof is the upper level's floor block.
    expect(below!.totalBlocks).toBe(alone.totalBlocks)
    // The upper level stands on that roof, so its 13 × 13 floor is already there.
    expect(above!.totalBlocks).toBe(computeBom(project([upper()])).totalBlocks - 169)
    expect(below!.totalBlocks + above!.totalBlocks).toBe(stack.totalBlocks)
    for (const { blockId, count } of stack.blocks) {
      expect((countOf(below!.blocks, blockId) ?? 0) + (countOf(above!.blocks, blockId) ?? 0)).toBe(count)
    }
  })

  it('keeps a tall room on its own level when a level starts partway up it', () => {
    const tall = stored('Tall', 0, { A1: bay('merged', () => ({ heightCells: 2 })) })
    const beside = stored('Beside', 4, { C3: bay('merged', () => ({ heightCells: 1 })) })
    const [first, second] = computeBom(project([tall, beside])).levels
    expect(first!.totalBlocks).toBe(computeBom(project([tall])).totalBlocks)
    expect(second!.totalBlocks).toBe(computeBom(project([beside])).totalBlocks)
  })

  it('times each level with the same furnaces', () => {
    const levels = computeBom(project([lower(), upper()]), { furnaces: 3 }).levels
    expect(levels.map((entry) => entry.smelting.furnaces)).toEqual([3, 3])
  })
})
