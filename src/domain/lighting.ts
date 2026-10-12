/**
 * Block light, as Minecraft spreads it. A source lights its own block, and
 * each step through a block that lets light pass costs one level. Since 1.18,
 * hostile mobs spawn on a floor only where the block light is 0.
 *
 * Pure: works on the resolved block map and knows nothing of cells.
 */
import { parseBlockKey } from './geometry.js'

export const MAX_LIGHT = 15

/** Light levels by block name, for blocks that always glow. */
const ALWAYS_LIT: Readonly<Record<string, number>> = {
  beacon: 15,
  conduit: 15,
  end_gateway: 15,
  glowstone: 15,
  jack_o_lantern: 15,
  lantern: 15,
  lava: 15,
  ochre_froglight: 15,
  pearlescent_froglight: 15,
  sea_lantern: 15,
  shroomlight: 15,
  verdant_froglight: 15,
  end_rod: 14,
  torch: 14,
  wall_torch: 14,
  crying_obsidian: 10,
  soul_lantern: 10,
  soul_torch: 10,
  soul_wall_torch: 10,
  enchanting_table: 7,
  glow_lichen: 7,
  redstone_torch: 7,
  redstone_wall_torch: 7,
  magma_block: 3,
}

/** Blocks that glow only with `lit=true`, which is not their default. */
const LIT_WHEN_ON: Readonly<Record<string, number>> = {
  copper_bulb: 15,
  exposed_copper_bulb: 12,
  weathered_copper_bulb: 8,
  oxidized_copper_bulb: 4,
  redstone_lamp: 15,
  furnace: 13,
  blast_furnace: 13,
  smoker: 13,
}

/** Blocks that glow unless `lit=false`. */
const LIT_UNLESS_OFF: Readonly<Record<string, number>> = {
  campfire: 15,
  soul_campfire: 10,
}

/** The light a block gives off. Waxing a copper bulb does not change it. */
export function lightEmission(blockId: string): number {
  return memo(emissions, blockId, emissionOf)
}

function emissionOf(blockId: string): number {
  const { name, state } = parseBlockId(blockId)
  const plain = name.replace(/^waxed_/, '')
  if (plain in LIT_WHEN_ON) return state.lit === 'true' ? LIT_WHEN_ON[plain]! : 0
  if (name in LIT_UNLESS_OFF) return state.lit === 'false' ? 0 : LIT_UNLESS_OFF[name]!
  if (name === 'light') return Number(state.level ?? MAX_LIGHT)
  return ALWAYS_LIT[name] ?? 0
}

/**
 * Blocks that let light through. Slabs and stairs count as solid, which
 * errs toward reporting a floor as dark.
 */
const SEE_THROUGH = /glass|_bars$|chain$|rail$|carpet$|torch$|hopper$|lectern$|leaves$|fence$|_wall$|pane$|button$|sign$|trapdoor$|_door$|ladder$|vine$|candle$|lichen$|campfire$|end_rod$|lever$|pressure_plate$|_head$|_skull$|scaffolding$|bell$|flower_pot$|portal$/

export function passesLight(blockId: string | undefined): boolean {
  return blockId === undefined || memo(seeThrough, blockId, seesThrough)
}

function seesThrough(blockId: string): boolean {
  const { name } = parseBlockId(blockId)
  return isHangingLight(name) || SEE_THROUGH.test(name)
}

/** Lanterns, but not the sea lantern or jack o'lantern, which are full blocks. */
function isHangingLight(name: string): boolean {
  return name === 'lantern' || (name.endsWith('_lantern') && name !== 'sea_lantern' && name !== 'jack_o_lantern')
}

/**
 * Whether a mob can stand on top of this block. Bottom slabs and upright
 * stairs are too low, and see-through blocks never take a spawn.
 */
export function canSpawnOn(blockId: string | undefined): boolean {
  return blockId !== undefined && memo(spawnable, blockId, takesSpawns)
}

function takesSpawns(blockId: string): boolean {
  if (passesLight(blockId)) return false
  const { name, state } = parseBlockId(blockId)
  if (name.endsWith('_slab')) return state.type === 'top' || state.type === 'double'
  if (name.endsWith('_stairs')) return state.half === 'top'
  return name !== 'magma_block' && !LOW_TOPPED.test(name)
}

/** Blocks short of a full block, so no mob spawns on top of them. */
const LOW_TOPPED = /^(enchanting_table|anvil|chipped_anvil|damaged_anvil|grindstone|stonecutter|chest|trapped_chest|ender_chest|farmland|dirt_path)$/

/** Bit flags for what fills a position. Air is 0: empty, lets light through, takes no spawn. */
const OCCUPIED = 1
const OPAQUE = 2
const SPAWNABLE = 4

/**
 * Light can travel 14 blocks from a full source, so a box this much wider
 * than the blocks holds every lit position and every neighbour a check reads.
 */
const MARGIN = MAX_LIGHT + 2

/**
 * Block light over a box around every placed block. Plans are small, at most
 * 97 blocks across, so flat arrays indexed by position beat string-keyed maps.
 */
export class LightField {
  private readonly x0: number
  private readonly y0: number
  private readonly z0: number
  private readonly sizeX: number
  private readonly sizeY: number
  private readonly sizeZ: number
  private readonly fill: Uint8Array
  private readonly level: Uint8Array
  /** Every light source, as flat index and level pairs. */
  private readonly sources: number[] = []

  /** Light from every source among `blocks`. */
  constructor(blocks: ReadonlyMap<string, string>) {
    let [x0, y0, z0, x1, y1, z1] = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]
    const placed: Array<[number, number, number, string]> = []
    for (const [at, blockId] of blocks) {
      const { x, y, z } = parseBlockKey(at)
      placed.push([x, y, z, blockId])
      x0 = Math.min(x0, x)
      y0 = Math.min(y0, y)
      z0 = Math.min(z0, z)
      x1 = Math.max(x1, x)
      y1 = Math.max(y1, y)
      z1 = Math.max(z1, z)
    }
    if (placed.length === 0) [x0, y0, z0, x1, y1, z1] = [0, 0, 0, 0, 0, 0]
    this.x0 = x0 - MARGIN
    this.y0 = y0 - MARGIN
    this.z0 = z0 - MARGIN
    this.sizeX = x1 - x0 + 1 + 2 * MARGIN
    this.sizeY = y1 - y0 + 1 + 2 * MARGIN
    this.sizeZ = z1 - z0 + 1 + 2 * MARGIN
    this.fill = new Uint8Array(this.sizeX * this.sizeY * this.sizeZ)
    this.level = new Uint8Array(this.fill.length)

    for (const [x, y, z, blockId] of placed) {
      const index = this.index(x, y, z)
      this.fill[index] = fillOf(blockId)
      const emitted = lightEmission(blockId)
      if (emitted > 0) this.sources.push(index, emitted)
    }
    this.spread(this.sources)
  }

  /**
   * Record a block placed after construction, and spread any light it gives.
   * A solid block on a position lit brighter than its own glow can shade
   * what lies past it, so the field is then worked out again from scratch.
   */
  place(x: number, y: number, z: number, blockId: string): void {
    const index = this.index(x, y, z)
    this.fill[index] = fillOf(blockId)
    const emitted = lightEmission(blockId)
    if (emitted > 0) this.sources.push(index, emitted)
    if ((this.fill[index]! & OPAQUE) !== 0 && this.level[index]! > emitted) {
      this.level.fill(0)
      this.spread(this.sources)
    } else if (emitted > 0) {
      this.spread([index, emitted])
    }
  }

  lightAt(x: number, y: number, z: number): number {
    return this.inside(x, y, z) ? this.level[this.index(x, y, z)]! : 0
  }

  /** A spawn needs a floor below, two free blocks for the mob, and no light. */
  isDarkSpawn(x: number, y: number, z: number): boolean {
    if (!this.inside(x, y - 1, z) || !this.inside(x, y + 1, z)) return false
    const at = this.index(x, y, z)
    return (
      (this.fill[at]! & OCCUPIED) === 0 &&
      (this.fill[at + this.sizeZ]! & OCCUPIED) === 0 &&
      (this.fill[at - this.sizeZ]! & SPAWNABLE) !== 0 &&
      this.level[at] === 0
    )
  }

  private inside(x: number, y: number, z: number): boolean {
    return x >= this.x0 && x < this.x0 + this.sizeX && y >= this.y0 && y < this.y0 + this.sizeY && z >= this.z0 && z < this.z0 + this.sizeZ
  }

  /** x major, then y, then z, so one step up is `sizeZ`. */
  private index(x: number, y: number, z: number): number {
    return ((x - this.x0) * this.sizeY + (y - this.y0)) * this.sizeZ + (z - this.z0)
  }

  /**
   * Raise the field from `seeds`, flat index and level pairs. Positions are
   * visited brightest first, so each settles the first time it is reached.
   */
  private spread(seeds: readonly number[]): void {
    const buckets: number[][] = Array.from({ length: MAX_LIGHT + 1 }, () => [])
    for (let index = 0; index < seeds.length; index += 2) {
      const at = seeds[index]!
      const emitted = seeds[index + 1]!
      if (emitted <= this.level[at]!) continue
      this.level[at] = emitted
      buckets[emitted]!.push(at)
    }
    const steps = [1, -1, this.sizeZ, -this.sizeZ, this.sizeY * this.sizeZ, -this.sizeY * this.sizeZ]
    for (let current = MAX_LIGHT; current > 1; current--) {
      for (const at of buckets[current]!) {
        if (this.level[at] !== current) continue
        for (const step of steps) {
          const next = at + step
          if (this.level[next]! >= current - 1 || (this.fill[next]! & OPAQUE) !== 0) continue
          this.level[next] = current - 1
          buckets[current - 1]!.push(next)
        }
      }
    }
  }
}

function fillOf(blockId: string): number {
  return OCCUPIED | (passesLight(blockId) ? 0 : OPAQUE) | (canSpawnOn(blockId) ? SPAWNABLE : 0)
}

// Plans use a few dozen block IDs, so each answer is worked out once.
const emissions = new Map<string, number>()
const seeThrough = new Map<string, boolean>()
const spawnable = new Map<string, boolean>()

function memo<T>(cache: Map<string, T>, blockId: string, compute: (blockId: string) => T): T {
  let value = cache.get(blockId)
  if (value === undefined) {
    value = compute(blockId)
    cache.set(blockId, value)
  }
  return value
}

/** `minecraft:copper_bulb[lit=true]` -> `copper_bulb` and `{ lit: 'true' }`. */
export function parseBlockId(blockId: string): { name: string; state: Record<string, string> } {
  const open = blockId.indexOf('[')
  const id = open === -1 ? blockId : blockId.slice(0, open)
  const name = id.slice(id.indexOf(':') + 1)
  const state: Record<string, string> = {}
  if (open !== -1) {
    for (const pair of blockId.slice(open + 1, -1).split(',')) {
      const [key, value] = pair.split('=')
      if (key && value !== undefined) state[key.trim()] = value.trim()
    }
  }
  return { name, state }
}
