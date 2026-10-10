/**
 * PRD §11 — the `.litematic` export, priority v2.
 *
 * Writes the resolved block map as one Litematica region, so the plan can be
 * loaded as an in-game ghost overlay. The format follows Litematica's
 * `LitematicaSchematic.writeToNBT`: palette index 0 is air, entries are packed
 * with `max(2, ceil(log2(palette size)))` bits and may straddle two longs, and
 * the index of `(x, y, z)` is `y * sizeX * sizeZ + z * sizeX + x`.
 *
 * Pure apart from {@link downloadLitematic} and the gzip step, which uses the
 * standard `CompressionStream` available in browsers and Node 18+.
 */
import { parseBlockKey, resolveBlocks } from '../domain/geometry.js'
import type { Project } from '../domain/types.js'
import { encodeNbt, nbt, type NbtTag } from './nbt.js'

/**
 * Litematica schema 6 is the version every Litematica build since 1.20 reads,
 * and current builds still write it for compatibility. A plan has no block
 * entities, which is where schema 7 differs.
 */
export const LITEMATICA_SCHEMA_VERSION = 6

/** Minecraft 1.21.1. Litematica upgrades block data from older versions on load. */
export const LITEMATICA_DATA_VERSION = 3955
export const LITEMATICA_TARGET_LABEL = 'Minecraft 1.21.1+'

const AIR = 'minecraft:air'

export interface LitematicPlacement {
  /** World coordinate of the schematic's minimum corner: where to place it. */
  origin: { x: number; y: number; z: number }
  size: { x: number; y: number; z: number }
  blocks: number
}

/** The schematic's world placement, without encoding it. */
export function litematicPlacement(project: Project): LitematicPlacement {
  const { min, max, count } = bounds(resolveBlocks(project))
  return {
    origin: min,
    size: { x: max.x - min.x + 1, y: max.y - min.y + 1, z: max.z - min.z + 1 },
    blocks: count,
  }
}

/** The uncompressed NBT document. */
export function litematicNbt(project: Project, now = Date.now()): Uint8Array<ArrayBuffer> {
  const blocks = resolveBlocks(project)
  if (blocks.size === 0) throw new Error('The plan has no built cells to export')
  const { origin, size } = litematicPlacement(project)

  const palette = [AIR, ...[...new Set(blocks.values())].filter((id) => id !== AIR).sort()]
  const paletteIndex = new Map(palette.map((id, index) => [id, index]))
  const bits = Math.max(2, 32 - Math.clz32(palette.length - 1))
  const volume = size.x * size.y * size.z

  // Pack into 32-bit halves, low half first, then join them into longs.
  const longCount = Math.ceil((volume * bits) / 64)
  const words = new Uint32Array(longCount * 2)
  for (const [key, blockId] of blocks) {
    const value = paletteIndex.get(blockId)!
    if (value === 0) continue
    const { x, y, z } = parseBlockKey(key)
    const index = (y - origin.y) * size.x * size.z + (z - origin.z) * size.x + (x - origin.x)
    const bit = index * bits
    const word = Math.floor(bit / 32)
    const shift = bit % 32
    words[word] = (words[word]! | (value << shift)) >>> 0
    if (shift + bits > 32) words[word + 1] = (words[word + 1]! | (value >>> (32 - shift))) >>> 0
  }
  const states = new BigInt64Array(longCount)
  for (let index = 0; index < longCount; index++) {
    states[index] = BigInt.asIntN(64, (BigInt(words[index * 2 + 1]!) << 32n) | BigInt(words[index * 2]!))
  }

  const name = project.name.trim() || 'Baywright plan'
  const vec = (v: { x: number; y: number; z: number }) => nbt.compound({ x: nbt.int(v.x), y: nbt.int(v.y), z: nbt.int(v.z) })
  const region = nbt.compound({
    Position: vec({ x: 0, y: 0, z: 0 }),
    Size: vec(size),
    BlockStatePalette: nbt.list(palette.map(paletteEntry)),
    BlockStates: nbt.longArray(states),
    TileEntities: nbt.list([]),
    Entities: nbt.list([]),
    PendingBlockTicks: nbt.list([]),
    PendingFluidTicks: nbt.list([]),
  })

  return encodeNbt(
    nbt.compound({
      MinecraftDataVersion: nbt.int(LITEMATICA_DATA_VERSION),
      Version: nbt.int(LITEMATICA_SCHEMA_VERSION),
      SubVersion: nbt.int(1),
      Metadata: nbt.compound({
        Name: nbt.string(name),
        Author: nbt.string('Baywright'),
        Description: nbt.string(`Place the schematic origin at x ${origin.x}, y ${origin.y}, z ${origin.z}.`),
        RegionCount: nbt.int(1),
        TotalVolume: nbt.int(volume),
        TotalBlocks: nbt.int(blocks.size),
        TimeCreated: nbt.long(BigInt(now)),
        TimeModified: nbt.long(BigInt(now)),
        EnclosingSize: vec(size),
      }),
      Regions: nbt.compound({ [name]: region }),
    }),
  )
}

/** The gzipped `.litematic` file. */
export async function encodeLitematic(project: Project, now = Date.now()): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([litematicNbt(project, now)]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/**
 * A palette ID may carry block-state properties, `minecraft:lantern[hanging=true]`.
 * Litematica stores those as a separate `Properties` compound of strings.
 */
function paletteEntry(blockId: string): NbtTag {
  const match = /^([^[]+)(?:\[(.*)\])?$/.exec(blockId)
  const name = match?.[1] ?? blockId
  const entries: Record<string, NbtTag> = { Name: nbt.string(name) }
  if (match?.[2]) {
    const properties: Record<string, NbtTag> = {}
    for (const pair of match[2].split(',')) {
      const [key, value] = pair.split('=')
      if (key && value !== undefined) properties[key.trim()] = nbt.string(value.trim())
    }
    entries['Properties'] = nbt.compound(properties)
  }
  return nbt.compound(entries)
}

function bounds(blocks: ReadonlyMap<string, string>) {
  const min = { x: Infinity, y: Infinity, z: Infinity }
  const max = { x: -Infinity, y: -Infinity, z: -Infinity }
  for (const key of blocks.keys()) {
    const { x, y, z } = parseBlockKey(key)
    if (x < min.x) min.x = x
    if (y < min.y) min.y = y
    if (z < min.z) min.z = z
    if (x > max.x) max.x = x
    if (y > max.y) max.y = y
    if (z > max.z) max.z = z
  }
  if (blocks.size === 0) return { min: { x: 0, y: 0, z: 0 }, max: { x: -1, y: -1, z: -1 }, count: 0 }
  return { min, max, count: blocks.size }
}

// --------------------------------------------------------------------------
// Browser glue
// --------------------------------------------------------------------------

export function litematicFilename(project: Project): string {
  const slug = project.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return `${slug || 'baywright-plan'}.litematic`
}

/** Encode and hand the file to the browser. Returns where to place it. */
export async function downloadLitematic(project: Project): Promise<LitematicPlacement> {
  const bytes = await encodeLitematic(project)
  const blob = new Blob([bytes], { type: 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = litematicFilename(project)
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
  return litematicPlacement(project)
}
