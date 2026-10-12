/**
 * PRD §9 — Bill of materials.
 *
 * Pure and side-effect free, computed from the same `resolveBlocks` the
 * exporter uses. The UI is responsible for debouncing the recompute (200ms is
 * fine); nothing here caches.
 */
import { builtCellRefs, cellAABB, parseBlockKey, resolveBlocks, sortedLevels } from './geometry.js'
import type { AABB, Level, Project } from './types.js'

/** Every block the shipped palettes use stacks to 64. */
export const STACK_SIZE = 64

/** Vanilla smelting is 200 ticks — 10 seconds — per item per furnace. */
export const SECONDS_PER_SMELT = 10

export const DEFAULT_FURNACES = 1

// --------------------------------------------------------------------------
// Recipe chains
// --------------------------------------------------------------------------

export type CraftMethod = 'craft' | 'smelt' | 'stonecutter' | 'hoe' | 'bucket'

export interface Recipe {
  /** What this block is made from. */
  input: string
  /** How many of `input` one of this block costs. Fractional where a recipe yields several. */
  per: number
  method: CraftMethod
  /** Crafting-table recipes must consume a whole batch even when only part of its output is needed. */
  batch?: { input: number; output: number }
}

const WOODS = [
  'oak',
  'spruce',
  'birch',
  'jungle',
  'acacia',
  'dark_oak',
  'mangrove',
  'cherry',
  'pale_oak',
]

/** planks ← logs (4:1), and stairs ← planks (6 planks yield 4 stairs). */
function woodRecipes(): Record<string, Recipe> {
  const recipes: Record<string, Recipe> = {}
  for (const wood of WOODS) {
    recipes[`minecraft:${wood}_planks`] = { input: `minecraft:${wood}_log`, per: 0.25, method: 'craft' }
    recipes[`minecraft:${wood}_stairs`] = {
      input: `minecraft:${wood}_planks`,
      per: 1.5,
      method: 'craft',
      batch: { input: 6, output: 4 },
    }
    recipes[`minecraft:${wood}_slab`] = {
      input: `minecraft:${wood}_planks`,
      per: 0.5,
      method: 'craft',
      batch: { input: 3, output: 6 },
    }
  }
  return recipes
}

/**
 * The §9 chains, plus the stair/slab/chiseled forms of the same families —
 * the shipped palettes emit those, so rolling them up is what makes the raw
 * list a usable gathering list. All single-input: recipes that need a second
 * ingredient (fences need sticks, lanterns need nuggets) stay raw.
 *
 * Stone families cut 1:1 on a stonecutter, and 1 block yields 2 slabs.
 */
export const RECIPES: Readonly<Record<string, Recipe>> = {
  // stone brick ← stone ← cobblestone
  'minecraft:stone_bricks': { input: 'minecraft:stone', per: 1, method: 'craft' },
  'minecraft:stone': { input: 'minecraft:cobblestone', per: 1, method: 'smelt' },
  'minecraft:stone_brick_stairs': { input: 'minecraft:stone_bricks', per: 1, method: 'stonecutter' },
  'minecraft:stone_brick_slab': { input: 'minecraft:stone_bricks', per: 0.5, method: 'stonecutter' },
  'minecraft:stone_brick_wall': { input: 'minecraft:stone_bricks', per: 1, method: 'stonecutter' },
  'minecraft:chiseled_stone_bricks': { input: 'minecraft:stone_bricks', per: 1, method: 'stonecutter' },

  // deepslate tile ← polished deepslate ← cobbled deepslate
  'minecraft:deepslate_tiles': { input: 'minecraft:polished_deepslate', per: 1, method: 'craft' },
  'minecraft:polished_deepslate': { input: 'minecraft:cobbled_deepslate', per: 1, method: 'craft' },
  'minecraft:deepslate_tile_stairs': { input: 'minecraft:deepslate_tiles', per: 1, method: 'stonecutter' },
  'minecraft:deepslate_tile_slab': { input: 'minecraft:deepslate_tiles', per: 0.5, method: 'stonecutter' },
  'minecraft:deepslate_tile_wall': { input: 'minecraft:deepslate_tiles', per: 1, method: 'stonecutter' },

  // tuff brick ← polished tuff ← tuff (stonecutter, no smelting)
  'minecraft:tuff_bricks': { input: 'minecraft:polished_tuff', per: 1, method: 'stonecutter' },
  'minecraft:polished_tuff': { input: 'minecraft:tuff', per: 1, method: 'stonecutter' },
  'minecraft:tuff_brick_stairs': { input: 'minecraft:tuff_bricks', per: 1, method: 'stonecutter' },
  'minecraft:tuff_brick_slab': { input: 'minecraft:tuff_bricks', per: 0.5, method: 'stonecutter' },
  'minecraft:tuff_brick_wall': { input: 'minecraft:tuff_bricks', per: 1, method: 'stonecutter' },
  'minecraft:chiseled_tuff_bricks': { input: 'minecraft:tuff_bricks', per: 1, method: 'stonecutter' },

  // Blocks no one can carry: a hoe tills dirt, and a bucket places water.
  'minecraft:farmland': { input: 'minecraft:dirt', per: 1, method: 'hoe' },
  'minecraft:water': { input: 'minecraft:water_bucket', per: 1, method: 'bucket' },

  // furnace ← 8 cobblestone
  'minecraft:furnace': { input: 'minecraft:cobblestone', per: 8, method: 'craft' },

  // planks ← logs (4:1)
  ...woodRecipes(),
}

// --------------------------------------------------------------------------
// Output shapes
// --------------------------------------------------------------------------

export interface StackCount {
  total: number
  /** Full stacks, `floor(total / 64)`. */
  stacks: number
  /** What is left over after the full stacks. */
  remainder: number
  /** Inventory slots the total occupies, `ceil(total / 64)`. */
  slots: number
  /** `"41 stacks + 12"`. */
  label: string
}

export interface BomEntry {
  blockId: string
  count: number
  stacks: StackCount
}

export interface SmeltStep {
  /** What comes out of the furnace. */
  blockId: string
  /** What goes in. */
  from: string
  items: number
}

export interface SmeltingEstimate {
  /** Total items to smelt across the whole chain. */
  items: number
  furnaces: number
  seconds: number
  /** `"1h 24m 10s"`. */
  label: string
  steps: SmeltStep[]
}

export interface Materials {
  /** Placed blocks per ID, most first. */
  blocks: BomEntry[]
  totalBlocks: number
  /** What to gather, after rolling craftables back to their raw inputs. */
  rawInputs: BomEntry[]
  smelting: SmeltingEstimate
}

/**
 * One level's share of the blocks. A plane it shares with the level below
 * belongs to that level, as it does for digging.
 */
export interface LevelMaterials extends Materials {
  levelId: string
  name: string
}

export interface Bom extends Materials {
  /** What building into the ground takes, or null when the surface is unknown. */
  digging: Digging | null
  /** Each level with built cells, lowest first. */
  levels: LevelMaterials[]
}

/** Where a level's built cells sit against the ground. */
export type GroundPlacement = 'underground' | 'partly' | 'above'

export interface LevelDigging {
  levelId: string
  name: string
  ground: GroundPlacement
  /** Blocks dug for this level. A plane it shares with the level below counts there. */
  blocks: number
}

export interface Digging {
  surfaceY: number
  /** Every block at or below the surface inside a built cell, walls included. */
  blocks: number
  /** Roughly what the digging gives back, most first. */
  yields: BomEntry[]
  /** Each level with built cells, lowest first. */
  levels: LevelDigging[]
}

export interface BomOptions {
  /** How many furnaces run in parallel for the time estimate. */
  furnaces?: number
  /** Count only the block layers not yet ticked off in `Project.builtLayers`. */
  leaveOutBuilt?: boolean
}

// --------------------------------------------------------------------------
// Stacks
// --------------------------------------------------------------------------

export function toStacks(total: number): StackCount {
  const stacks = Math.floor(total / STACK_SIZE)
  const remainder = total % STACK_SIZE
  return {
    total,
    stacks,
    remainder,
    slots: Math.ceil(total / STACK_SIZE),
    label: formatStacks(total),
  }
}

/** `2636` -> `"41 stacks + 12"`, `128` -> `"2 stacks"`, `12` -> `"12"`. */
export function formatStacks(total: number): string {
  const stacks = Math.floor(total / STACK_SIZE)
  const remainder = total % STACK_SIZE
  if (stacks === 0) return `${remainder}`
  const noun = stacks === 1 ? 'stack' : 'stacks'
  return remainder === 0 ? `${stacks} ${noun}` : `${stacks} ${noun} + ${remainder}`
}

// --------------------------------------------------------------------------
// The BOM
// --------------------------------------------------------------------------

export function computeBom(project: Project, options: BomOptions = {}): Bom {
  const built = new Set(options.leaveOutBuilt ? project.builtLayers : [])
  const blocks = built.size > 0 ? unbuilt(resolveBlocks(project), built) : resolveBlocks(project)
  return {
    ...materialsOf(blocks, options),
    digging: computeDigging(project, built),
    levels: materialsByLevel(project, blocks, options),
  }
}

function unbuilt(blocks: ReadonlyMap<string, string>, built: ReadonlySet<number>): Map<string, string> {
  const left = new Map<string, string>()
  for (const [key, blockId] of blocks) if (!built.has(parseBlockKey(key).y)) left.set(key, blockId)
  return left
}

/** The same computation over a block map, for exporters and tests. */
export function bomFromBlocks(blocks: ReadonlyMap<string, string>, options: BomOptions = {}): Bom {
  return { ...materialsOf(blocks, options), digging: null, levels: [] }
}

function materialsOf(blocks: ReadonlyMap<string, string>, options: BomOptions): Materials {
  const counts = countBlocks(blocks)
  const { raw, smelts } = rollUpRawInputs(counts)
  const furnaces = Math.max(1, Math.floor(options.furnaces ?? DEFAULT_FURNACES))

  let totalBlocks = 0
  for (const count of counts.values()) totalBlocks += count

  return {
    blocks: toEntries(counts),
    totalBlocks,
    rawInputs: toEntries(raw),
    smelting: estimateSmelting(smelts, furnaces),
  }
}

// --------------------------------------------------------------------------
// Levels
// --------------------------------------------------------------------------

/**
 * Hand each placed block to its level. A level rounds to whole logs and
 * slabs on its own, so the levels' raw inputs can add up to a little more
 * than the whole base's.
 */
function materialsByLevel(project: Project, blocks: ReadonlyMap<string, string>, options: BomOptions): LevelMaterials[] {
  const { levels, ownerAt } = blockOwners(project)
  const split = levels.map(() => new Map<string, string>())
  for (const [key, blockId] of blocks) {
    const { x, y, z } = parseBlockKey(key)
    split[ownerAt(x, y, z)]!.set(key, blockId)
  }
  return levels.map((level, index) => ({ levelId: level.id, name: level.name, ...materialsOf(split[index]!, options) }))
}

export interface BlockOwners {
  /** Each level with built cells, lowest first. */
  levels: Level[]
  /** The index in `levels` of the level a block position belongs to. */
  ownerAt(x: number, y: number, z: number): number
}

/**
 * Which level each block belongs to: the lowest level whose built cells hold
 * it, so a plane two levels share goes to the lower one, as digging does.
 */
export function blockOwners(project: Project): BlockOwners {
  const boxesByLevel = builtBoxesByLevel(project)
  const levels = sortedLevels(project).filter((level) => boxesByLevel.has(level.id))
  if (levels.length === 0) return { levels, ownerAt: () => 0 }

  const owners = new BoxGrid([...boxesByLevel.values()].flat())
  // Highest first, so the lower level writes last and keeps a shared plane.
  for (let index = levels.length - 1; index >= 0; index--) {
    for (const box of boxesByLevel.get(levels[index]!.id)!) owners.fill(box, index + 1)
  }
  return {
    levels,
    ownerAt(x, y, z) {
      const owner = owners.get(x, y, z)
      if (owner > 0) return owner - 1
      // Every block the resolver places lies in a cell; this is only a guard.
      return Math.max(0, levels.filter((level) => level.y <= y).length - 1)
    },
  }
}

/** Built cell boxes by level ID. */
function builtBoxesByLevel(project: Project): Map<string, AABB[]> {
  const boxesByLevel = new Map<string, AABB[]>()
  for (const ref of builtCellRefs(project)) {
    const boxes = boxesByLevel.get(ref.levelId) ?? []
    boxes.push(cellAABB(project, ref))
    boxesByLevel.set(ref.levelId, boxes)
  }
  return boxesByLevel
}

/** A number per block position over the box around `boxes`, 0 outside it or where unset. */
class BoxGrid {
  private readonly x0: number
  private readonly y0: number
  private readonly z0: number
  private readonly sizeX: number
  private readonly sizeY: number
  private readonly sizeZ: number
  private readonly values: Uint16Array

  constructor(boxes: readonly AABB[]) {
    this.x0 = Math.min(...boxes.map((box) => box.x0))
    this.y0 = Math.min(...boxes.map((box) => box.y0))
    this.z0 = Math.min(...boxes.map((box) => box.z0))
    this.sizeX = Math.max(...boxes.map((box) => box.x1)) - this.x0 + 1
    this.sizeY = Math.max(...boxes.map((box) => box.y1)) - this.y0 + 1
    this.sizeZ = Math.max(...boxes.map((box) => box.z1)) - this.z0 + 1
    this.values = new Uint16Array(this.sizeX * this.sizeY * this.sizeZ)
  }

  fill(box: AABB, value: number): void {
    for (let x = box.x0; x <= box.x1; x++) {
      for (let y = box.y0; y <= box.y1; y++) {
        for (let z = box.z0; z <= box.z1; z++) this.values[this.index(x, y, z)] = value
      }
    }
  }

  get(x: number, y: number, z: number): number {
    const inside =
      x >= this.x0 && x < this.x0 + this.sizeX && y >= this.y0 && y < this.y0 + this.sizeY && z >= this.z0 && z < this.z0 + this.sizeZ
    return inside ? this.values[this.index(x, y, z)]! : 0
  }

  private index(x: number, y: number, z: number): number {
    return ((x - this.x0) * this.sizeY + (y - this.y0)) * this.sizeZ + (z - this.z0)
  }
}

// --------------------------------------------------------------------------
// Digging
// --------------------------------------------------------------------------

/** How many of the ground's top blocks are dirt, as under most grass. */
export const DIRT_DEPTH = 4

/**
 * Every built cell below the surface is dug out whole, walls included, since
 * the plan places its own walls. The yield assumes plain ground: dirt at the
 * top, then stone, which drops cobblestone, then deepslate below y 0. Ores,
 * caves, and water change the real numbers. A layer ticked off as built is
 * already dug.
 */
function computeDigging(project: Project, built: ReadonlySet<number>): Digging | null {
  const surfaceY = project.surfaceY
  if (surfaceY === undefined) return null

  const boxesByLevel = builtBoxesByLevel(project)
  const all = [...boxesByLevel.values()].flat()
  if (all.length === 0) return { surfaceY, blocks: 0, yields: [], levels: [] }
  const bounds = {
    x0: Math.min(...all.map((box) => box.x0)),
    y0: Math.min(...all.map((box) => box.y0)),
    z0: Math.min(...all.map((box) => box.z0)),
    x1: Math.max(...all.map((box) => box.x1)),
    z1: Math.max(...all.map((box) => box.z1)),
  }
  const [sizeX, sizeZ] = [bounds.x1 - bounds.x0 + 1, bounds.z1 - bounds.z0 + 1]
  const sizeY = Math.max(0, surfaceY - bounds.y0 + 1)
  const dug = new Uint8Array(sizeX * sizeY * sizeZ)

  const yields = new Map<string, number>()
  const levels: LevelDigging[] = []
  let total = 0
  for (const level of sortedLevels(project)) {
    const boxes = boxesByLevel.get(level.id)
    if (!boxes) continue
    let blocks = 0
    for (const box of boxes) {
      for (let y = box.y0; y <= Math.min(box.y1, surfaceY); y++) {
        if (built.has(y)) continue
        let layer = 0
        for (let x = box.x0; x <= box.x1; x++) {
          for (let z = box.z0; z <= box.z1; z++) {
            const index = ((y - bounds.y0) * sizeX + (x - bounds.x0)) * sizeZ + (z - bounds.z0)
            if (dug[index]) continue
            dug[index] = 1
            layer++
          }
        }
        if (layer === 0) continue
        const drop = groundDrop(y, surfaceY)
        yields.set(drop, (yields.get(drop) ?? 0) + layer)
        blocks += layer
      }
    }
    total += blocks
    levels.push({ levelId: level.id, name: level.name, ground: groundPlacement(boxes, surfaceY), blocks })
  }
  return { surfaceY, blocks: total, yields: toEntries(yields), levels }
}

/** What mining one block of plain ground at height `y` drops. */
function groundDrop(y: number, surfaceY: number): string {
  if (y > surfaceY - DIRT_DEPTH) return 'minecraft:dirt'
  return y < 0 ? 'minecraft:cobbled_deepslate' : 'minecraft:cobblestone'
}

function groundPlacement(boxes: readonly AABB[], surfaceY: number): GroundPlacement {
  if (boxes.every((box) => box.y1 <= surfaceY)) return 'underground'
  if (boxes.every((box) => box.y0 > surfaceY)) return 'above'
  return 'partly'
}

/**
 * Total blocks per Minecraft block ID. A palette ID may carry a block state,
 * `minecraft:lantern[hanging=true]`, but the item you carry has none, so the
 * state is dropped before counting.
 */
export function countBlocks(blocks: ReadonlyMap<string, string>): Map<string, number> {
  const counts = new Map<string, number>()
  for (const blockId of blocks.values()) {
    const item = itemId(blockId)
    counts.set(item, (counts.get(item) ?? 0) + 1)
  }
  return counts
}

function itemId(blockId: string): string {
  const state = blockId.indexOf('[')
  return state === -1 ? blockId : blockId.slice(0, state)
}

export interface RawRollup {
  /** Raw materials to gather, whole units. */
  raw: Map<string, number>
  /** Smelting operations, keyed by what comes out of the furnace. */
  smelts: Map<string, SmeltStep>
}

/**
 * Walk each placed block back down its chain until it hits something with no
 * recipe. Blocks that were never craftable (andesite, copper, lanterns) come
 * back as themselves, so the result is the whole gathering list rather than
 * only the craftable part of it.
 */
export function rollUpRawInputs(counts: ReadonlyMap<string, number>): RawRollup {
  const exact = new Map<string, number>()
  const smelts = new Map<string, SmeltStep>()
  for (const [blockId, count] of counts) expand(blockId, count, exact, smelts, [])

  // Chains yield fractions (4 planks per log, 2 slabs per block); you cannot
  // gather half a log, so round each raw total up once at the end.
  const raw = new Map<string, number>()
  for (const [blockId, amount] of exact) raw.set(blockId, ceil(amount))
  for (const step of smelts.values()) step.items = ceil(step.items)
  return { raw, smelts }
}

function expand(
  blockId: string,
  amount: number,
  raw: Map<string, number>,
  smelts: Map<string, SmeltStep>,
  trail: string[],
): void {
  const recipe = RECIPES[blockId]
  if (!recipe) {
    raw.set(blockId, (raw.get(blockId) ?? 0) + amount)
    return
  }
  if (trail.includes(blockId)) {
    throw new Error(`recipe cycle: ${[...trail, blockId].join(' -> ')}`)
  }
  if (recipe.method === 'smelt') {
    // Smelting is 1 input to 1 output, so the output count is the furnace count.
    const step = smelts.get(blockId) ?? { blockId, from: recipe.input, items: 0 }
    step.items += amount
    smelts.set(blockId, step)
  }
  const inputAmount = recipe.batch
    ? Math.ceil(amount / recipe.batch.output) * recipe.batch.input
    : amount * recipe.per
  expand(recipe.input, inputAmount, raw, smelts, [...trail, blockId])
}

function estimateSmelting(smelts: ReadonlyMap<string, SmeltStep>, furnaces: number): SmeltingEstimate {
  const steps = [...smelts.values()].sort((l, r) => r.items - l.items || l.blockId.localeCompare(r.blockId))
  let items = 0
  for (const step of steps) items += step.items
  const seconds = Math.ceil(items / furnaces) * SECONDS_PER_SMELT
  return { items, furnaces, seconds, label: formatDuration(seconds), steps }
}

/** `5050` -> `"1h 24m 10s"`. */
export function formatDuration(seconds: number): string {
  if (seconds <= 0) return '0s'
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = seconds % 60
  const parts: string[] = []
  if (hours > 0) parts.push(`${hours}h`)
  if (minutes > 0) parts.push(`${minutes}m`)
  if (rest > 0) parts.push(`${rest}s`)
  return parts.join(' ')
}

/** Most blocks first, ties broken by ID so the panel does not reshuffle. */
function toEntries(counts: ReadonlyMap<string, number>): BomEntry[] {
  return [...counts]
    .sort((l, r) => r[1] - l[1] || l[0].localeCompare(r[0]))
    .map(([blockId, count]) => ({ blockId, count, stacks: toStacks(count) }))
}

/** Ceil with a tolerance, so accumulated ratios do not round 169 up to 170. */
function ceil(value: number): number {
  return Math.ceil(value - 1e-9)
}
