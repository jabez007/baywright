/**
 * PRD §11 — `.litematic` export, checked by decoding the file with an
 * independent NBT reader and Litematica's own bit-array formula.
 */
import { describe, expect, it } from 'vitest'
import { parseBlockKey, resolveBlocks } from '../src/domain/geometry.js'
import { projectFromTemplate } from '../src/domain/templates.js'
import { encodeLitematic, litematicPlacement, LITEMATICA_DATA_VERSION } from '../src/export/litematic.js'
import { bay, level, project } from './factory.js'
import { litematicaEntry, readGzippedNbt, type NbtCompound } from './nbt-reader.js'

/** One merged storage bay, one cell tall, all faces solid: a 13x5x13 shell. */
const box = () => project([level('L', 0, { A1: bay('merged') })], { name: 'Box' })

async function decode(bytes: Uint8Array) {
  const { name, root } = readGzippedNbt(bytes)
  const regions = root['Regions'] as NbtCompound
  const [regionName] = Object.keys(regions)
  const region = regions[regionName!] as NbtCompound
  const palette = (region['BlockStatePalette'] as NbtCompound[]).map((entry) => entry['Name'] as string)
  const size = region['Size'] as NbtCompound
  const [sx, sy, sz] = [size['x'] as number, size['y'] as number, size['z'] as number]
  const bits = Math.max(2, 32 - Math.clz32(palette.length - 1))
  const states = region['BlockStates'] as BigInt64Array
  const blockAt = (x: number, y: number, z: number) => palette[litematicaEntry(states, bits, y * sx * sz + z * sx + x)]
  return { name, root, regionName, region, palette, size: [sx, sy, sz], states, bits, blockAt }
}

describe('Litematica export', () => {
  it('writes a version 6 schematic for the 1.21.1 data version', async () => {
    const { name, root } = await decode(await encodeLitematic(box()))
    expect(name).toBe('')
    expect(root['Version']).toBe(6)
    expect(root['MinecraftDataVersion']).toBe(3955)
    expect(LITEMATICA_DATA_VERSION).toBe(3955)
  })

  it('stores the shell as one region the size of its bounds', async () => {
    const { regionName, region, size, palette } = await decode(await encodeLitematic(box()))
    expect(regionName).toBe('Box')
    expect(size).toEqual([13, 5, 13])
    expect(region['Position']).toEqual({ x: 0, y: 0, z: 0 })
    expect(palette).toEqual(['minecraft:air', 'minecraft:polished_andesite', 'minecraft:stone_bricks'])
    for (const list of ['TileEntities', 'Entities', 'PendingBlockTicks', 'PendingFluidTicks']) {
      expect(region[list]).toEqual([])
    }
  })

  it('places floor, wall, ceiling and air where the geometry puts them', async () => {
    const { blockAt } = await decode(await encodeLitematic(box()))
    expect(blockAt(0, 0, 0)).toBe('minecraft:stone_bricks')
    expect(blockAt(6, 0, 6)).toBe('minecraft:stone_bricks')
    expect(blockAt(0, 2, 6)).toBe('minecraft:stone_bricks')
    expect(blockAt(6, 4, 6)).toBe('minecraft:polished_andesite')
    expect(blockAt(6, 2, 6)).toBe('minecraft:air')
  })

  it('counts the 482 shell blocks and 845-block volume in the metadata', async () => {
    const { root, size, blockAt } = await decode(await encodeLitematic(box()))
    const metadata = root['Metadata'] as NbtCompound
    expect(metadata['TotalBlocks']).toBe(482)
    expect(metadata['TotalVolume']).toBe(845)
    expect(metadata['RegionCount']).toBe(1)
    expect(metadata['EnclosingSize']).toEqual({ x: 13, y: 5, z: 13 })
    expect(metadata['Name']).toBe('Box')

    let solid = 0
    for (let y = 0; y < size[1]!; y++) {
      for (let z = 0; z < size[2]!; z++) {
        for (let x = 0; x < size[0]!; x++) if (blockAt(x, y, z) !== 'minecraft:air') solid++
      }
    }
    expect(solid).toBe(482)
  })

  it('matches the resolved block map block for block across a whole template', async () => {
    let n = 0
    const p = projectFromTemplate('layered-base', () => `id-${n++}`)
    const { blockAt, palette, bits, root } = await decode(await encodeLitematic(p))
    // More than four blocks means entries of three or more bits, which
    // straddle long boundaries; the template also reaches below y 0.
    expect(bits).toBeGreaterThanOrEqual(3)
    expect(palette.length).toBeGreaterThan(4)

    const { origin } = litematicPlacement(p)
    expect(origin.y).toBe(-4)
    const blocks = resolveBlocks(p)
    for (const [key, blockId] of blocks) {
      const { x, y, z } = parseBlockKey(key)
      expect(blockAt(x - origin.x, y - origin.y, z - origin.z)).toBe(blockId)
    }
    expect((root['Metadata'] as NbtCompound)['TotalBlocks']).toBe(blocks.size)
  })

  it('splits block-state properties out of a palette ID', async () => {
    const p = box()
    p.palettes['stone-brick'] = {
      ...p.palettes['stone-brick']!,
      blocks: { ...p.palettes['stone-brick']!.blocks, ceiling: 'minecraft:oak_slab[type=top,waterlogged=false]' },
    }
    const { region } = await decode(await encodeLitematic(p))
    const entries = region['BlockStatePalette'] as NbtCompound[]
    expect(entries.find((entry) => entry['Name'] === 'minecraft:oak_slab')).toEqual({
      Name: 'minecraft:oak_slab',
      Properties: { type: 'top', waterlogged: 'false' },
    })
  })

  it('refuses a plan with nothing built', async () => {
    const p = project([level('L', 0, { A1: bay('merged', () => ({ module: 'empty' })) })])
    await expect(encodeLitematic(p)).rejects.toThrow('The plan has no built cells to export')
  })
})
