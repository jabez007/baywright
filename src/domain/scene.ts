/**
 * What the 3D view draws: every resolved block with a colour and a rough
 * shape, sorted into layers so the view can build a base one y at a time.
 *
 * Pure: knows nothing of three.js or the DOM.
 */
import { blockOwners, bomFromBlocks, type BomEntry } from './bom.js'
import { blockKey, parseBlockKey, resolveBlocks } from './geometry.js'
import { lightEmission, parseBlockId } from './lighting.js'
import type { AABB, Project } from './types.js'

// --------------------------------------------------------------------------
// How a block looks
// --------------------------------------------------------------------------

/**
 * A cube, or the part of one a thin block fills: slabs fill half, rails and
 * carpets a sliver at the bottom, fences and chains a post up the middle, and
 * lanterns and torches a small block in the middle.
 */
export type BlockShape = 'cube' | 'bottom-slab' | 'top-slab' | 'flat' | 'post' | 'small'

/** Light sources draw unshaded so they read as lit; glass draws see-through. */
export type BlockFinish = 'solid' | 'glow' | 'glass'

export interface BlockLook {
  /** `0xRRGGBB`, roughly the average colour of the block's texture. */
  colour: number
  shape: BlockShape
  finish: BlockFinish
}

/** Average texture colours, by block name without namespace or state. */
const COLOURS: Readonly<Record<string, number>> = {
  // Stone
  stone: 0x7e7e7e,
  cobblestone: 0x6f6f6f,
  mossy_cobblestone: 0x6e775f,
  smooth_stone: 0x9f9f9f,
  stone_bricks: 0x7a7979,
  mossy_stone_bricks: 0x737a63,
  cracked_stone_bricks: 0x767574,
  chiseled_stone_bricks: 0x777676,
  andesite: 0x888889,
  polished_andesite: 0x9a9c9c,
  diorite: 0xbcbcbc,
  polished_diorite: 0xc0c1c2,
  granite: 0x956755,
  polished_granite: 0x9a6a59,
  calcite: 0xdfe0dc,
  dripstone_block: 0x866b5c,
  // Deepslate and tuff
  deepslate: 0x505053,
  cobbled_deepslate: 0x4d4d51,
  polished_deepslate: 0x48484a,
  deepslate_bricks: 0x464647,
  deepslate_tiles: 0x363638,
  chiseled_deepslate: 0x363637,
  tuff: 0x6c6d66,
  polished_tuff: 0x626963,
  tuff_bricks: 0x5f6659,
  chiseled_tuff: 0x5a5f58,
  chiseled_tuff_bricks: 0x5c625a,
  // Other masonry
  bricks: 0x976253,
  mud_bricks: 0x89684f,
  packed_mud: 0x8e6b50,
  sandstone: 0xd8cb9b,
  smooth_sandstone: 0xdfd4a5,
  cut_sandstone: 0xd9cd9e,
  red_sandstone: 0xb5621f,
  smooth_red_sandstone: 0xb5621f,
  quartz_block: 0xebe5de,
  quartz_bricks: 0xeae4dd,
  quartz_pillar: 0xebe6e0,
  smooth_quartz: 0xece6df,
  prismarine: 0x63a297,
  prismarine_bricks: 0x63ac9e,
  dark_prismarine: 0x335a4b,
  end_stone: 0xdbde9e,
  end_stone_bricks: 0xdae0a2,
  purpur_block: 0xa97da9,
  nether_bricks: 0x2c161a,
  red_nether_bricks: 0x460709,
  blackstone: 0x2a2429,
  polished_blackstone: 0x353038,
  polished_blackstone_bricks: 0x302b31,
  basalt: 0x505055,
  polished_basalt: 0x5a5a5b,
  obsidian: 0x0f0b19,
  crying_obsidian: 0x200a3c,
  terracotta: 0x985e43,
  // Ground
  dirt: 0x866043,
  coarse_dirt: 0x77553b,
  grass_block: 0x5f9f35,
  gravel: 0x847f7f,
  sand: 0xdbcfa3,
  red_sand: 0xbe6621,
  clay: 0xa0a6b3,
  moss_block: 0x596e2d,
  snow_block: 0xf9fefe,
  ice: 0x91b7fd,
  packed_ice: 0x8eb4fa,
  blue_ice: 0x74a7fd,
  // Wood
  oak_planks: 0xa2834f,
  spruce_planks: 0x735531,
  birch_planks: 0xc0af79,
  jungle_planks: 0xa07351,
  acacia_planks: 0xa85a32,
  dark_oak_planks: 0x422b14,
  mangrove_planks: 0x763631,
  cherry_planks: 0xe2b2ac,
  pale_oak_planks: 0xe3d9d7,
  bamboo_planks: 0xc2ad53,
  crimson_planks: 0x653147,
  warped_planks: 0x2b6963,
  oak_log: 0x6d5532,
  spruce_log: 0x3a2611,
  birch_log: 0xd8d7d2,
  jungle_log: 0x55441a,
  acacia_log: 0x676157,
  dark_oak_log: 0x3c2e1a,
  mangrove_log: 0x544329,
  cherry_log: 0x36212b,
  pale_oak_log: 0x5a4f4c,
  stripped_oak_log: 0xb19057,
  stripped_spruce_log: 0x75592f,
  stripped_dark_oak_log: 0x48382a,
  // Copper and metal
  copper_block: 0xc06c50,
  exposed_copper: 0xa17e68,
  weathered_copper: 0x6c9a6f,
  oxidized_copper: 0x52a385,
  cut_copper: 0xbf6a50,
  copper_bulb: 0x9c5639,
  exposed_copper_bulb: 0x87705c,
  weathered_copper_bulb: 0x5f8061,
  oxidized_copper_bulb: 0x4b8370,
  iron_block: 0xdcdcdc,
  iron_bars: 0x8a8b89,
  chain: 0x3b4250,
  iron_chain: 0x3b4250,
  gold_block: 0xf6d03d,
  // Light
  lantern: 0xf0b45a,
  soul_lantern: 0x5fc4d0,
  torch: 0xffd27a,
  wall_torch: 0xffd27a,
  soul_torch: 0x6fe0ea,
  glowstone: 0xd8b56a,
  sea_lantern: 0xacc7be,
  shroomlight: 0xf19347,
  ochre_froglight: 0xf5e9b5,
  verdant_froglight: 0xe5f4e2,
  pearlescent_froglight: 0xf5f0f0,
  redstone_lamp: 0x5f3620,
  end_rod: 0xe6dcd3,
  // Furniture and machines
  bookshelf: 0x75603b,
  chiseled_bookshelf: 0x6b5638,
  lectern: 0xaf8a54,
  crafting_table: 0x815e3a,
  furnace: 0x6e6e6e,
  blast_furnace: 0x575657,
  smoker: 0x6b5a46,
  chest: 0xa2782d,
  barrel: 0x86643a,
  hopper: 0x4b4a4b,
  rail: 0x7f6e52,
  powered_rail: 0x9a7a49,
  hay_block: 0xa68b0c,
  glass: 0xc0dbe0,
  tinted_glass: 0x2c2630,
  water: 0x3f76e4,
  lava: 0xd4570f,
}

/** The sixteen dyes, for wool, concrete, glass, and the rest. */
const DYES: Readonly<Record<string, number>> = {
  white: 0xe9ecec,
  light_gray: 0x8e8e86,
  gray: 0x3e4447,
  black: 0x141519,
  brown: 0x724728,
  red: 0xa12722,
  orange: 0xf07613,
  yellow: 0xf8c527,
  lime: 0x70b919,
  green: 0x546d1b,
  cyan: 0x158991,
  light_blue: 0x3aafd9,
  blue: 0x35399d,
  purple: 0x7a2aac,
  magenta: 0xbd44b3,
  pink: 0xed8dac,
}

/** Longest first, so `light_blue_wool` does not match `blue`. */
const DYE_NAMES = Object.keys(DYES).sort((l, r) => r.length - l.length)

/** Endings that name a shape cut from the block before them. */
const CUT_FROM = /_(stairs|slab|wall|fence_gate|fence|pressure_plate|button|trapdoor|door|pane|hanging_sign|wall_sign|sign)$/

const FLAT = /(^|_)rail$|carpet$|_pressure_plate$|^redstone_wire$|^snow$/
const POST = /_fence$|_fence_gate$|_wall$|(^|_)chain$|_bars$|(^|_)pane$|^end_rod$|^lightning_rod$/
const SMALL = /(^|_)torch$|^flower_pot$|candle$|_button$|^lever$|_head$|_skull$/

export function blockLook(blockId: string): BlockLook {
  let look = looks.get(blockId)
  if (!look) {
    look = lookOf(blockId)
    looks.set(blockId, look)
  }
  return look
}

const looks = new Map<string, BlockLook>()

function lookOf(blockId: string): BlockLook {
  const { name: full, state } = parseBlockId(blockId)
  const name = full.replace(/^waxed_/, '')
  return { colour: colourOf(name), shape: shapeOf(name, state), finish: finishOf(blockId, name) }
}

function colourOf(name: string): number {
  const dye = DYE_NAMES.find((candidate) => name.startsWith(`${candidate}_`))
  if (dye) return DYES[dye]!

  const base = name.replace(CUT_FROM, '')
  for (const candidate of [name, base]) {
    // Drop leading words one at a time: cracked_deepslate_tiles, cut_copper.
    const words = candidate.split('_')
    for (let start = 0; start < words.length; start++) {
      const colour = known(words.slice(start).join('_'))
      if (colour !== undefined) return colour
    }
  }
  return unknownColour(name)
}

/** The table entry for a name, or for the full block a cut name comes from. */
function known(name: string): number | undefined {
  return COLOURS[name] ?? COLOURS[`${name}s`] ?? COLOURS[`${name}_planks`] ?? COLOURS[`${name}_block`]
}

/** A muted colour hashed from the name, so a block from a mod looks the same each time. */
function unknownColour(name: string): number {
  let hash = 2166136261
  for (let index = 0; index < name.length; index++) hash = Math.imul(hash ^ name.charCodeAt(index), 16777619)
  const hue = ((hash >>> 0) % 360) / 360
  return hslToRgb(hue, 0.25, 0.5)
}

function hslToRgb(hue: number, saturation: number, lightness: number): number {
  const q = lightness < 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation
  const p = 2 * lightness - q
  const channel = (offset: number) => {
    let t = hue + offset
    if (t < 0) t += 1
    if (t > 1) t -= 1
    const value = t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p
    return Math.round(value * 255)
  }
  return (channel(1 / 3) << 16) | (channel(0) << 8) | channel(-1 / 3)
}

function shapeOf(name: string, state: Record<string, string>): BlockShape {
  if (name.endsWith('_slab')) {
    if (state.type === 'double') return 'cube'
    return state.type === 'top' ? 'top-slab' : 'bottom-slab'
  }
  if (FLAT.test(name)) return 'flat'
  if (POST.test(name)) return 'post'
  if (SMALL.test(name) || (name.endsWith('lantern') && name !== 'sea_lantern' && name !== 'jack_o_lantern')) return 'small'
  return 'cube'
}

function finishOf(blockId: string, name: string): BlockFinish {
  if (lightEmission(blockId) > 0) return 'glow'
  return name.includes('glass') ? 'glass' : 'solid'
}

// --------------------------------------------------------------------------
// The scene
// --------------------------------------------------------------------------

export interface SceneBlock {
  x: number
  y: number
  z: number
  blockId: string
  /** Index into {@link Scene.levels}. */
  level: number
}

export interface Scene {
  /** Lowest layer first, then by x and z. */
  blocks: SceneBlock[]
  /** Around every block, or null when nothing is built. */
  bounds: AABB | null
  /** Names of the levels with built cells, lowest first. */
  levels: string[]
}

export function buildScene(project: Project): Scene {
  const { levels, ownerAt } = blockOwners(project)
  const blocks: SceneBlock[] = []
  for (const [key, blockId] of resolveBlocks(project)) {
    const { x, y, z } = parseBlockKey(key)
    blocks.push({ x, y, z, blockId, level: ownerAt(x, y, z) })
  }
  blocks.sort((l, r) => l.y - r.y || l.x - r.x || l.z - r.z)

  let bounds: AABB | null = null
  for (const { x, y, z } of blocks) {
    if (!bounds) bounds = { x0: x, x1: x, y0: y, y1: y, z0: z, z1: z }
    bounds.x0 = Math.min(bounds.x0, x)
    bounds.x1 = Math.max(bounds.x1, x)
    bounds.z0 = Math.min(bounds.z0, z)
    bounds.z1 = Math.max(bounds.z1, z)
    bounds.y1 = y
  }
  return { blocks, bounds, levels: levels.map((level) => level.name) }
}

/** Where layer `y` starts and ends in {@link Scene.blocks}, end exclusive. */
export function layerRange(scene: Scene, y: number): [number, number] {
  return [firstAbove(scene.blocks, y - 1), firstAbove(scene.blocks, y)]
}

/** The index of the first block above `y`. */
function firstAbove(blocks: readonly SceneBlock[], y: number): number {
  let [lo, hi] = [0, blocks.length]
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (blocks[mid]!.y <= y) lo = mid + 1
    else hi = mid
  }
  return lo
}

export interface LayerSummary {
  y: number
  blocks: number
  /** Placed blocks per item, most first. */
  materials: BomEntry[]
  /** The x and z the layer spans, or null when it is empty. */
  bounds: { x0: number; x1: number; z0: number; z1: number } | null
  /** The levels that own blocks in this layer, lowest first. */
  levels: string[]
}

/** What one layer of the build takes, to build it in order from the bottom. */
export function layerSummary(scene: Scene, y: number): LayerSummary {
  const [start, end] = layerRange(scene, y)
  const layer = scene.blocks.slice(start, end)
  const placed = new Map(layer.map((block) => [blockKey(block.x, block.y, block.z), block.blockId]))
  const levels = [...new Set(layer.map((block) => block.level))].sort((l, r) => l - r)
  return {
    y,
    blocks: layer.length,
    materials: bomFromBlocks(placed).blocks,
    bounds:
      layer.length === 0
        ? null
        : {
            x0: Math.min(...layer.map((block) => block.x)),
            x1: Math.max(...layer.map((block) => block.x)),
            z0: Math.min(...layer.map((block) => block.z)),
            z1: Math.max(...layer.map((block) => block.z)),
          },
    levels: levels.map((index) => scene.levels[index]!),
  }
}
