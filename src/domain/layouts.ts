/** Reusable arrangements of bay patterns, expanded into ordinary bays when stamped. */
import type { QuarterTurns } from './patterns.js'

export interface LayoutPlacement {
  i: number
  j: number
  patternId: string
  quarterTurns: QuarterTurns
  /**
   * Blocks above the level the stamp starts on, a multiple of 4. Absent means
   * that level. The stamp uses the level at that height or adds one.
   */
  dy?: number
  /** Placements on one level with the same slot become one cross-bay merge group. */
  mergeSlot?: string
}

export interface LayoutPattern {
  id: string
  name: string
  description: string
  width: number
  height: number
  placements: readonly LayoutPlacement[]
}

export interface RotatedLayout {
  width: number
  height: number
  placements: LayoutPlacement[]
}

export const LAYOUT_PATTERN_LIST: readonly LayoutPattern[] = [
  {
    id: 'stronghold-loop',
    name: 'Stronghold loop',
    description: 'Eight passage bays around a deliberately open centre.',
    width: 3,
    height: 3,
    placements: [
      { i: 0, j: 0, patternId: 'corner-passage', quarterTurns: 2 },
      { i: 1, j: 0, patternId: 'straight-passage', quarterTurns: 0 },
      { i: 2, j: 0, patternId: 'corner-passage', quarterTurns: 3 },
      { i: 0, j: 1, patternId: 'straight-passage', quarterTurns: 1 },
      { i: 2, j: 1, patternId: 'straight-passage', quarterTurns: 1 },
      { i: 0, j: 2, patternId: 'corner-passage', quarterTurns: 1 },
      { i: 1, j: 2, patternId: 'straight-passage', quarterTurns: 0 },
      { i: 2, j: 2, patternId: 'corner-passage', quarterTurns: 0 },
    ],
  },
  {
    id: 'grand-chamber',
    name: 'Grand chamber',
    description: 'Four feature bays merged into one monumental 25×25 chamber.',
    width: 2,
    height: 2,
    placements: [
      { i: 0, j: 0, patternId: 'feature-chamber', quarterTurns: 0, mergeSlot: 'hall' },
      { i: 1, j: 0, patternId: 'feature-chamber', quarterTurns: 0, mergeSlot: 'hall' },
      { i: 0, j: 1, patternId: 'feature-chamber', quarterTurns: 0, mergeSlot: 'hall' },
      { i: 1, j: 1, patternId: 'feature-chamber', quarterTurns: 0, mergeSlot: 'hall' },
    ],
  },
  {
    id: 'library-wing',
    name: 'Library wing',
    description: 'Two tall libraries joined by a central passage bay.',
    width: 3,
    height: 1,
    placements: [
      { i: 0, j: 0, patternId: 'library-hall', quarterTurns: 2 },
      { i: 1, j: 0, patternId: 'straight-passage', quarterTurns: 0 },
      { i: 2, j: 0, patternId: 'library-hall', quarterTurns: 0 },
    ],
  },
  {
    id: 'workshop-wing',
    name: 'Workshop wing',
    description: 'Two workshop bays joined by a central passage bay.',
    width: 3,
    height: 1,
    placements: [
      { i: 0, j: 0, patternId: 'workshop-bay', quarterTurns: 2 },
      { i: 1, j: 0, patternId: 'adapter-passage', quarterTurns: 0 },
      { i: 2, j: 0, patternId: 'workshop-bay', quarterTurns: 0 },
    ],
  },
  {
    id: 'stair-stack',
    name: 'Stair stack',
    description: 'Three levels, 8 blocks apart, joined by one stair with a west door on each.',
    width: 1,
    height: 1,
    placements: [
      { i: 0, j: 0, patternId: 'stair-hall', quarterTurns: 0 },
      { i: 0, j: 0, dy: 8, patternId: 'stair-through-hall', quarterTurns: 0 },
      { i: 0, j: 0, dy: 16, patternId: 'stair-landing', quarterTurns: 0 },
    ],
  },
  {
    id: 'library-gallery',
    name: 'Library gallery',
    description: 'A library with a gallery 8 blocks up that looks down through a 3×3 well.',
    width: 1,
    height: 1,
    placements: [
      { i: 0, j: 0, patternId: 'library-well', quarterTurns: 0 },
      { i: 0, j: 0, dy: 8, patternId: 'gallery-floor', quarterTurns: 0, mergeSlot: 'gallery' },
    ],
  },
  {
    id: 'atrium',
    name: 'Atrium',
    description: 'A 12-high core with a hall on each side and a balcony over each hall, 8 blocks up.',
    width: 3,
    height: 1,
    placements: [
      { i: 0, j: 0, patternId: 'atrium-hall', quarterTurns: 0 },
      { i: 1, j: 0, patternId: 'atrium-core', quarterTurns: 0 },
      { i: 2, j: 0, patternId: 'atrium-hall', quarterTurns: 2 },
      { i: 0, j: 0, dy: 8, patternId: 'atrium-balcony', quarterTurns: 0 },
      { i: 2, j: 0, dy: 8, patternId: 'atrium-balcony', quarterTurns: 2 },
    ],
  },
  {
    id: 'machinery-hall',
    name: 'Machinery hall',
    description: 'Two merged smelter bays over an item-trunk service run 8 blocks below.',
    width: 2,
    height: 1,
    placements: [
      { i: 0, j: 0, patternId: 'item-trunk-bay', quarterTurns: 0 },
      { i: 1, j: 0, patternId: 'item-trunk-bay', quarterTurns: 0 },
      { i: 0, j: 0, dy: 8, patternId: 'machine-hall', quarterTurns: 0, mergeSlot: 'hall' },
      { i: 1, j: 0, dy: 8, patternId: 'machine-hall', quarterTurns: 2, mergeSlot: 'hall' },
    ],
  },
]

/** The level offsets a layout stamps onto, lowest first. */
export function layoutLevelOffsets(layout: { placements: readonly LayoutPlacement[] }): number[] {
  return [...new Set(layout.placements.map((placement) => placement.dy ?? 0))].sort((a, b) => a - b)
}

export const LAYOUT_PATTERNS: Readonly<Record<string, LayoutPattern>> = Object.fromEntries(
  LAYOUT_PATTERN_LIST.map((layout) => [layout.id, layout]),
)

export function getLayoutPattern(id: string): LayoutPattern | undefined {
  return LAYOUT_PATTERNS[id]
}

export function rotatedLayout(layoutId: string, quarterTurns: QuarterTurns = 0): RotatedLayout {
  const layout = getLayoutPattern(layoutId)
  if (!layout) throw new Error(`no layout pattern '${layoutId}'`)

  let width = layout.width
  let height = layout.height
  let placements = layout.placements.map((placement) => ({ ...placement }))

  for (let turn = 0; turn < quarterTurns; turn++) {
    placements = placements.map((placement) => ({
      ...placement,
      i: height - 1 - placement.j,
      j: placement.i,
      quarterTurns: ((placement.quarterTurns + 1) % 4) as QuarterTurns,
    }))
    ;[width, height] = [height, width]
  }

  return { width, height, placements }
}
