/**
 * PRD §5.5 — the four shipped palettes.
 *
 * A palette binds abstract material roles to Minecraft block IDs. Nothing in
 * here is Vue-aware; the exporter and the renderer read the same table.
 */
import type { Palette } from './types.js'

export const PALETTES: Readonly<Record<string, Palette>> = {
  'stone-brick': {
    id: 'stone-brick',
    name: 'Stone Brick',
    blocks: {
      floor: 'minecraft:stone_bricks',
      wall: 'minecraft:stone_bricks',
      ceiling: 'minecraft:polished_andesite',
      accent: 'minecraft:chiseled_stone_bricks',
      trim: 'minecraft:stone_brick_stairs',
      light: 'minecraft:lantern',
    },
  },
  'dark-oak': {
    id: 'dark-oak',
    name: 'Dark Oak',
    blocks: {
      floor: 'minecraft:dark_oak_planks',
      wall: 'minecraft:dark_oak_planks',
      ceiling: 'minecraft:dark_oak_planks',
      accent: 'minecraft:dark_oak_log',
      trim: 'minecraft:dark_oak_stairs',
      light: 'minecraft:lantern',
    },
  },
  'mineshaft-oak': {
    id: 'mineshaft-oak',
    name: 'Mineshaft Oak',
    blocks: {
      floor: 'minecraft:oak_planks',
      wall: 'minecraft:cobblestone',
      ceiling: 'minecraft:oak_planks',
      accent: 'minecraft:oak_fence',
      trim: 'minecraft:oak_stairs',
      light: 'minecraft:torch',
    },
  },
  'tuff-copper': {
    id: 'tuff-copper',
    name: 'Tuff & Copper',
    blocks: {
      floor: 'minecraft:tuff_bricks',
      wall: 'minecraft:polished_tuff',
      ceiling: 'minecraft:tuff_brick_slab',
      accent: 'minecraft:oxidized_copper',
      trim: 'minecraft:tuff_brick_stairs',
      light: 'minecraft:copper_bulb',
    },
  },
}

/**
 * Blocks chosen by the socket rather than by the palette. §5.4 specifies iron
 * bars for `bars`, so the material role is fixed regardless of level palette.
 */
export const SOCKET_BLOCKS: Readonly<Record<string, string>> = {
  bars: 'minecraft:iron_bars',
}
