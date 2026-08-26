/**
 * PRD §9 — Bill of materials.
 *
 * The block counts below come from the F9 shell: a single merged bay at y 0,
 * heightCells 2, all sockets solid. 674 blocks — a 13 x 13 floor plane (169),
 * a 13 x 13 ceiling plane (169), and 336 of wall.
 */
import { describe, expect, it } from 'vitest'
import { bomFromBlocks, computeBom, formatDuration, formatStacks, rollUpRawInputs, toStacks } from '../src/domain/bom.js'
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
    expect(bom.totalBlocks).toBe(674)
  })

  it('splits the shell across the palette roles', () => {
    expect(countOf(bom.blocks, 'minecraft:stone_bricks')).toBe(505) // floor 169 + wall 336
    expect(countOf(bom.blocks, 'minecraft:polished_andesite')).toBe(169) // ceiling
  })

  it('sorts the biggest pile first and carries its stack label', () => {
    expect(bom.blocks[0]!.blockId).toBe('minecraft:stone_bricks')
    expect(bom.blocks[0]!.stacks.label).toBe('7 stacks + 57')
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
})
