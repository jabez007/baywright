/**
 * The 3D view and its layer guide.
 *
 * The layer counts come from the F9 shell: a single merged bay at y 0,
 * heightCells 2, all sockets solid. A 13 × 13 floor at y 0, a ring of 48 wall
 * blocks on each of y 1 to 7, and a 13 × 13 ceiling at y 8. A lantern hangs
 * at y 4 on chain from y 5 to 7.
 */
import { describe, expect, it } from 'vitest'
import { blockLook, buildScene, layerSummary } from '../src/domain/scene.js'
import { bay, level, project } from './factory.js'

const shell = (overrides: Parameters<typeof project>[1] = {}) =>
  project([level('L1', 0, { A1: bay('merged', () => ({ heightCells: 2 })) }, { name: 'Ground' })], overrides)

describe('blockLook', () => {
  it('ignores block states and wax', () => {
    expect(blockLook('minecraft:lantern[hanging=true]').colour).toBe(blockLook('minecraft:lantern').colour)
    expect(blockLook('minecraft:waxed_oxidized_copper').colour).toBe(blockLook('minecraft:oxidized_copper').colour)
  })

  it('colours stairs, slabs, walls and fences like the block they are cut from', () => {
    expect(blockLook('minecraft:stone_brick_stairs').colour).toBe(blockLook('minecraft:stone_bricks').colour)
    expect(blockLook('minecraft:deepslate_tile_wall').colour).toBe(blockLook('minecraft:deepslate_tiles').colour)
    expect(blockLook('minecraft:tuff_brick_slab').colour).toBe(blockLook('minecraft:tuff_bricks').colour)
    expect(blockLook('minecraft:dark_oak_stairs').colour).toBe(blockLook('minecraft:dark_oak_planks').colour)
    expect(blockLook('minecraft:oak_fence').colour).toBe(blockLook('minecraft:oak_planks').colour)
  })

  it('tells the shipped palettes apart', () => {
    const colours = ['stone_bricks', 'oak_planks', 'dark_oak_planks', 'tuff_bricks', 'deepslate_tiles', 'cobblestone', 'polished_andesite']
      .map((name) => blockLook(`minecraft:${name}`).colour)
    expect(new Set(colours).size).toBe(colours.length)
  })

  it('takes a dyed block colour from its dye', () => {
    const brightness = (colour: number) => (colour >> 16) + ((colour >> 8) & 0xff) + (colour & 0xff)
    expect(brightness(blockLook('minecraft:white_wool').colour)).toBeGreaterThan(brightness(blockLook('minecraft:black_wool').colour))
    expect(blockLook('minecraft:red_concrete').colour).not.toBe(blockLook('minecraft:blue_concrete').colour)
  })

  it('gives a block it does not know the same colour every time', () => {
    expect(blockLook('mymod:strange_block').colour).toBe(blockLook('mymod:strange_block').colour)
    expect(blockLook('mymod:strange_block').shape).toBe('cube')
  })

  it('draws thin blocks thin', () => {
    expect(blockLook('minecraft:stone_brick_slab').shape).toBe('bottom-slab')
    expect(blockLook('minecraft:stone_brick_slab[type=top]').shape).toBe('top-slab')
    expect(blockLook('minecraft:stone_brick_slab[type=double]').shape).toBe('cube')
    expect(blockLook('minecraft:rail[shape=east_west]').shape).toBe('flat')
    expect(blockLook('minecraft:red_carpet').shape).toBe('flat')
    expect(blockLook('minecraft:oak_fence').shape).toBe('post')
    expect(blockLook('minecraft:chain').shape).toBe('post')
    expect(blockLook('minecraft:iron_bars').shape).toBe('post')
    expect(blockLook('minecraft:lantern[hanging=true]').shape).toBe('small')
    expect(blockLook('minecraft:stone_bricks').shape).toBe('cube')
  })

  it('makes light sources glow and glass see-through', () => {
    expect(blockLook('minecraft:waxed_copper_bulb[lit=true]').finish).toBe('glow')
    expect(blockLook('minecraft:copper_bulb').finish).toBe('solid')
    expect(blockLook('minecraft:lantern[hanging=true]').finish).toBe('glow')
    expect(blockLook('minecraft:glass').finish).toBe('glass')
    expect(blockLook('minecraft:light_blue_stained_glass_pane').finish).toBe('glass')
    expect(blockLook('minecraft:stone_bricks').finish).toBe('solid')
  })
})

describe('buildScene', () => {
  it('sorts the blocks from the lowest layer up', () => {
    const scene = buildScene(shell())
    expect(scene.blocks).toHaveLength(674 + 4)
    const ys = scene.blocks.map((block) => block.y)
    expect(ys).toEqual([...ys].sort((l, r) => l - r))
    expect(scene.bounds).toEqual({ x0: 0, x1: 12, y0: 0, y1: 8, z0: 0, z1: 12 })
  })

  it('places blocks at world coordinates', () => {
    expect(buildScene(shell({ origin: { x: 100, z: -36 } })).bounds).toEqual({ x0: 100, x1: 112, y0: 0, y1: 8, z0: -36, z1: -24 })
  })

  it('has no blocks or bounds for an empty plan', () => {
    const scene = buildScene(project([level('L1', 0, {})]))
    expect(scene.blocks).toEqual([])
    expect(scene.bounds).toBeNull()
  })
})

describe('layerSummary', () => {
  it('counts one layer of the build and what it takes', () => {
    const layer = layerSummary(buildScene(shell({ origin: { x: 100, z: -36 } })), 4)
    expect(layer.y).toBe(4)
    expect(layer.blocks).toBe(49)
    expect(layer.materials.map(({ blockId, count }) => [blockId, count])).toEqual([
      ['minecraft:stone_bricks', 48],
      ['minecraft:lantern', 1],
    ])
    expect(layer.bounds).toEqual({ x0: 100, x1: 112, z0: -36, z1: -24 })
    expect(layer.levels).toEqual(['Ground'])
  })

  it('counts the floor and ceiling planes whole', () => {
    const scene = buildScene(shell())
    expect(layerSummary(scene, 0).blocks).toBe(169)
    expect(layerSummary(scene, 8).blocks).toBe(169)
  })

  it('names the lower level for a plane two levels share', () => {
    const scene = buildScene(
      project([
        level('lower', 0, { A1: bay('merged', () => ({ heightCells: 1 })) }, { name: 'Lower' }),
        level('upper', 4, { A1: bay('merged', () => ({ heightCells: 1 })) }, { name: 'Upper' }),
      ]),
    )
    expect(layerSummary(scene, 4).levels).toEqual(['Lower'])
    expect(layerSummary(scene, 5).levels).toEqual(['Upper'])
  })

  it('is empty above and below the build', () => {
    const layer = layerSummary(buildScene(shell()), 20)
    expect(layer.blocks).toBe(0)
    expect(layer.materials).toEqual([])
    expect(layer.bounds).toBeNull()
    expect(layer.levels).toEqual([])
  })
})
