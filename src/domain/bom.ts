/**
 * PRD §9 — Bill of materials.
 *
 * Pure and side-effect free, computed from the same `resolveBlocks` the
 * exporter uses. The UI is responsible for debouncing the recompute (200ms is
 * fine); nothing here caches.
 */
import { resolveBlocks } from './geometry.js'
import type { Project } from './types.js'

/** Every block the shipped palettes use stacks to 64. */
export const STACK_SIZE = 64

/** Vanilla smelting is 200 ticks — 10 seconds — per item per furnace. */
export const SECONDS_PER_SMELT = 10

export const DEFAULT_FURNACES = 1

// --------------------------------------------------------------------------
// Recipe chains
// --------------------------------------------------------------------------

export type CraftMethod = 'craft' | 'smelt' | 'stonecutter'

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

export interface Bom {
  /** Placed blocks per ID, most first. */
  blocks: BomEntry[]
  totalBlocks: number
  /** What to gather, after rolling craftables back to their raw inputs. */
  rawInputs: BomEntry[]
  smelting: SmeltingEstimate
}

export interface BomOptions {
  /** How many furnaces run in parallel for the time estimate. */
  furnaces?: number
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
  return bomFromBlocks(resolveBlocks(project), options)
}

/** The same computation over a block map, for exporters and tests. */
export function bomFromBlocks(blocks: ReadonlyMap<string, string>, options: BomOptions = {}): Bom {
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

/** Total blocks per Minecraft block ID. */
export function countBlocks(blocks: ReadonlyMap<string, string>): Map<string, number> {
  const counts = new Map<string, number>()
  for (const blockId of blocks.values()) counts.set(blockId, (counts.get(blockId) ?? 0) + 1)
  return counts
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
