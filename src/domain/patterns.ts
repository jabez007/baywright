/**
 * Reusable bay patterns. A pattern expands into ordinary cells when stamped,
 * so saved projects do not depend on this catalog after the edit.
 */
import { cellFromModule, type CellOverrides } from './modules.js'
import {
  GRAIN_AXIS_CELLS,
  type Bay,
  type Face,
  type Grain,
  type Socket,
} from './types.js'

export type QuarterTurns = 0 | 1 | 2 | 3
export type PatternRotation = QuarterTurns | 'auto'

export interface PatternCell extends CellOverrides {
  moduleId: string
}

export interface BayPattern {
  id: string
  name: string
  description: string
  grain: Grain
  cells: readonly PatternCell[]
}

const closed = (): PatternCell => ({ moduleId: 'empty' })

function passage(moduleId: string, open: Partial<Record<Face, Socket>>): PatternCell {
  return {
    moduleId,
    sockets: { n: 'solid', e: 'solid', s: 'solid', w: 'solid', ...open },
  }
}

export const BAY_PATTERN_LIST: readonly BayPattern[] = [
  {
    id: 'straight-passage',
    name: 'Straight passage',
    description: 'A fine-grain corridor through the middle of the bay.',
    grain: 'fine',
    cells: [
      closed(), closed(), closed(),
      passage('corridor', { w: 'corridor', e: 'corridor' }),
      passage('corridor', { w: 'corridor', e: 'corridor' }),
      passage('corridor', { w: 'corridor', e: 'corridor' }),
      closed(), closed(), closed(),
    ],
  },
  {
    id: 'corner-passage',
    name: 'Corner passage',
    description: 'A fine-grain corridor that joins the west and north faces.',
    grain: 'fine',
    cells: [
      closed(), passage('corridor', { n: 'corridor', s: 'corridor' }), closed(),
      passage('corridor', { w: 'corridor', e: 'corridor' }),
      passage('junction', { n: 'corridor', w: 'corridor', e: 'solid', s: 'solid' }),
      closed(), closed(), closed(), closed(),
    ],
  },
  {
    id: 'rail-line-bay',
    name: 'Rail line bay',
    description: 'A straight minecart route through the middle of the bay.',
    grain: 'fine',
    cells: [
      closed(), closed(), closed(),
      passage('rail-line', { w: 'corridor', e: 'corridor' }),
      passage('rail-line', { w: 'corridor', e: 'corridor' }),
      passage('rail-line', { w: 'corridor', e: 'corridor' }),
      closed(), closed(), closed(),
    ],
  },
  {
    id: 'ice-highway-bay',
    name: 'Ice highway bay',
    description: 'A straight boat route through the middle of the bay.',
    grain: 'fine',
    cells: [
      closed(), closed(), closed(),
      passage('ice-highway', { w: 'corridor', e: 'corridor' }),
      passage('ice-highway', { w: 'corridor', e: 'corridor' }),
      passage('ice-highway', { w: 'corridor', e: 'corridor' }),
      closed(), closed(), closed(),
    ],
  },
  {
    id: 'item-trunk-bay',
    name: 'Item trunk bay',
    description: 'A straight service trunk with an overhead item-transport plenum.',
    grain: 'fine',
    cells: [
      closed(), closed(), closed(),
      passage('item-trunk', { w: 'corridor', e: 'corridor' }),
      passage('item-trunk', { w: 'corridor', e: 'corridor' }),
      passage('item-trunk', { w: 'corridor', e: 'corridor' }),
      closed(), closed(), closed(),
    ],
  },
  {
    id: 't-junction',
    name: 'T-junction',
    description: 'A fine-grain junction open to the west, north, and east.',
    grain: 'fine',
    cells: [
      closed(), passage('corridor', { n: 'corridor', s: 'corridor' }), closed(),
      passage('corridor', { w: 'corridor', e: 'corridor' }),
      passage('junction', { n: 'corridor', e: 'corridor', s: 'solid', w: 'corridor' }),
      passage('corridor', { w: 'corridor', e: 'corridor' }),
      closed(), closed(), closed(),
    ],
  },
  {
    id: 'four-way-junction',
    name: 'Four-way junction',
    description: 'A fine-grain crossing through all four bay faces.',
    grain: 'fine',
    cells: [
      closed(), passage('corridor', { n: 'corridor', s: 'corridor' }), closed(),
      passage('corridor', { w: 'corridor', e: 'corridor' }),
      passage('junction', { n: 'corridor', e: 'corridor', s: 'corridor', w: 'corridor' }),
      passage('corridor', { w: 'corridor', e: 'corridor' }),
      closed(), passage('corridor', { n: 'corridor', s: 'corridor' }), closed(),
    ],
  },
  {
    id: 'stair-hall',
    name: 'Stair hall',
    description: 'A merged, two-height stair bay with a west entrance.',
    grain: 'merged',
    cells: [passage('stair', { n: 'solid', w: 'corridor' })],
  },
  {
    id: 'adapter-passage',
    name: 'Adapter passage',
    description: 'A merged passage running east to west that joins fine and coarse bays.',
    grain: 'merged',
    cells: [passage('vestibule', { e: 'corridor', w: 'corridor' })],
  },
  {
    id: 'stair-through-hall',
    name: 'Stair through-hall',
    description: 'A merged stair bay that continues a stair from below up to the next level.',
    grain: 'merged',
    cells: [passage('stair', { n: 'solid', w: 'corridor', down: 'shaft' })],
  },
  {
    id: 'stair-landing',
    name: 'Stair landing',
    description: 'A merged landing with a shaft down to a stair and a west exit.',
    grain: 'merged',
    cells: [passage('junction', { w: 'corridor', down: 'shaft' })],
  },
  {
    id: 'library-hall',
    name: 'Library hall',
    description: 'A merged, two-height library with a west arch.',
    grain: 'merged',
    cells: [passage('library', { n: 'solid', w: 'arch' })],
  },
  {
    id: 'workshop-bay',
    name: 'Workshop bay',
    description: 'Four coarse workshop rooms connected around the bay center.',
    grain: 'coarse',
    cells: [
      passage('workshop', { n: 'solid', e: 'corridor', s: 'corridor', w: 'corridor' }),
      passage('workshop', { n: 'solid', e: 'solid', s: 'corridor', w: 'corridor' }),
      passage('workshop', { n: 'corridor', e: 'corridor', s: 'solid', w: 'corridor' }),
      passage('workshop', { n: 'corridor', e: 'solid', s: 'solid', w: 'corridor' }),
    ],
  },
  {
    id: 'feature-chamber',
    name: 'Feature chamber',
    description: 'A merged, full-height vaulted chamber with centred five-wide openings.',
    grain: 'merged',
    cells: [{ moduleId: 'arena', openingWidths: { n: 5, e: 5, s: 5, w: 5 } }],
  },
  {
    id: 'balcony-landing',
    name: 'Balcony landing',
    description: 'A one-high landing that opens five wide to the east, over a tall room on the level below.',
    grain: 'merged',
    cells: [{ ...passage('corridor', { e: 'corridor', w: 'corridor' }), openingWidths: { e: 5, w: 3 } }],
  },
  {
    id: 'dead-end',
    name: 'Dead end',
    description: 'A short passage from the west that stops at the bay centre.',
    grain: 'fine',
    cells: [
      closed(), closed(), closed(),
      passage('corridor', { w: 'corridor', e: 'corridor' }),
      passage('corridor', { w: 'corridor' }),
      closed(),
      closed(), closed(), closed(),
    ],
  },
  {
    id: 'side-chamber',
    name: 'Side chamber',
    description: 'A west-to-east passage with a small storage room off its south side.',
    grain: 'fine',
    cells: [
      closed(), closed(), closed(),
      passage('corridor', { w: 'corridor', e: 'corridor' }),
      passage('junction', { w: 'corridor', e: 'corridor', s: 'corridor' }),
      passage('corridor', { w: 'corridor', e: 'corridor' }),
      closed(), passage('storage', { n: 'corridor' }), closed(),
    ],
  },
  {
    id: 'concealed-room',
    name: 'Concealed room',
    description: 'A west-to-east passage with a vault behind a two-high arch you hide in the build.',
    grain: 'fine',
    cells: [
      closed(), closed(), closed(),
      passage('corridor', { w: 'corridor', e: 'corridor' }),
      passage('junction', { w: 'corridor', e: 'corridor', s: 'arch' }),
      passage('corridor', { w: 'corridor', e: 'corridor' }),
      closed(),
      {
        ...passage('vault', { n: 'arch' }),
        note: 'Concealed room. Hide the north arch behind a piston door, a painting, or a bookshelf wall.',
      },
      closed(),
    ],
  },
  {
    id: 'service-junction',
    name: 'Service junction',
    description: 'An item-trunk T that joins west, east, and south runs under one plenum.',
    grain: 'fine',
    cells: [
      closed(), closed(), closed(),
      passage('item-trunk', { w: 'corridor', e: 'corridor' }),
      passage('item-trunk', { w: 'corridor', e: 'corridor', s: 'corridor' }),
      passage('item-trunk', { w: 'corridor', e: 'corridor' }),
      closed(), passage('item-trunk', { n: 'corridor', s: 'corridor' }), closed(),
    ],
  },
  {
    id: 'mine-head',
    name: 'Mine head',
    description: 'A passage from the west to a mine access room whose floor opens into the mine below.',
    grain: 'fine',
    cells: [
      closed(), closed(), closed(),
      passage('corridor', { w: 'corridor', e: 'corridor' }),
      { ...passage('mine-access', { w: 'corridor', down: 'shaft' }), note: 'Mine head. Ladder or stair down into the mine.' },
      closed(),
      closed(), closed(), closed(),
    ],
  },
  {
    id: 'cave-mouth',
    name: 'Cave mouth',
    description: 'A passage from the west that opens into the unbuilt east third of the bay, where a cave begins.',
    grain: 'fine',
    cells: [
      closed(), closed(), closed(),
      passage('corridor', { w: 'corridor', e: 'corridor' }),
      { ...passage('corridor', { w: 'corridor', e: 'corridor' }), note: 'Cave mouth. Opens east into raw rock.' },
      closed(),
      closed(), closed(), closed(),
    ],
  },
  {
    id: 'compact-stair',
    name: 'Compact stair',
    description: 'A fine stair cell, entered from the west, that climbs 8 blocks to a compact landing.',
    grain: 'fine',
    cells: [
      closed(), closed(), closed(),
      passage('corridor', { w: 'corridor', e: 'corridor' }),
      passage('stair', { w: 'corridor', up: 'shaft' }),
      closed(),
      closed(), closed(), closed(),
    ],
  },
  {
    id: 'compact-landing',
    name: 'Compact landing',
    description: 'The top of a compact stair: a fine landing over the shaft with a west exit.',
    grain: 'fine',
    cells: [
      closed(), closed(), closed(),
      passage('corridor', { w: 'corridor', e: 'corridor' }),
      passage('junction', { w: 'corridor', down: 'shaft' }),
      closed(),
      closed(), closed(), closed(),
    ],
  },
]

const galleryCell = (open: Partial<Record<Face, Socket>> = {}): PatternCell => ({
  moduleId: 'library',
  sockets: { n: 'solid', e: 'solid', s: 'solid', w: 'solid', ...open },
})

/**
 * Pieces that only make sense inside a multi-level layout, so the Stamp tool
 * does not list them. Openings that face a core take a centred 5-block width.
 */
export const LAYOUT_PIECE_LIST: readonly BayPattern[] = [
  {
    id: 'library-well',
    name: 'Library well',
    description: 'A merged library whose ceiling opens into a gallery above.',
    grain: 'merged',
    cells: [passage('library', { n: 'solid', w: 'arch', up: 'shaft' })],
  },
  {
    id: 'gallery-floor',
    name: 'Gallery floor',
    description: 'A fine library ring around a centre cell open to the room below.',
    grain: 'fine',
    cells: [
      galleryCell(), galleryCell(), galleryCell(),
      galleryCell({ w: 'arch' }), galleryCell({ down: 'shaft' }), galleryCell(),
      galleryCell(), galleryCell(), galleryCell(),
    ],
  },
  {
    id: 'atrium-core',
    name: 'Atrium core',
    description: 'A full-height vaulted core open to its east and west flanks.',
    grain: 'merged',
    cells: [{ ...passage('arena', { e: 'corridor', w: 'corridor' }), openingWidths: { e: 5, w: 5 } }],
  },
  {
    id: 'atrium-hall',
    name: 'Atrium hall',
    description: 'A two-high hall open east into the atrium core.',
    grain: 'merged',
    cells: [{ ...passage('vestibule', { e: 'corridor', w: 'corridor' }), openingWidths: { e: 5 } }],
  },
  {
    id: 'atrium-balcony',
    name: 'Atrium balcony',
    description: 'A one-high balcony open east over the atrium core.',
    grain: 'merged',
    cells: [{ ...passage('corridor', { e: 'corridor', w: 'corridor' }), openingWidths: { e: 5 } }],
  },
  {
    id: 'machine-hall',
    name: 'Machine hall',
    description: 'A merged super-smelter bay with a west arch.',
    grain: 'merged',
    cells: [passage('super-smelter', { n: 'solid', w: 'arch' })],
  },
]

export const BAY_PATTERNS: Readonly<Record<string, BayPattern>> = Object.fromEntries(
  [...BAY_PATTERN_LIST, ...LAYOUT_PIECE_LIST].map((pattern) => [pattern.id, pattern]),
)

export function getBayPattern(id: string): BayPattern | undefined {
  return BAY_PATTERNS[id]
}

export function bayFromPattern(patternId: string, quarterTurns: QuarterTurns = 0): Bay {
  const pattern = getBayPattern(patternId)
  if (!pattern) throw new Error(`no bay pattern '${patternId}'`)
  const n = GRAIN_AXIS_CELLS[pattern.grain]
  if (pattern.cells.length !== n * n) {
    throw new Error(`bay pattern '${pattern.id}' needs ${n * n} cells, got ${pattern.cells.length}`)
  }

  const cells = pattern.cells.map(({ moduleId, ...overrides }) => cellFromModule(moduleId, overrides))
  for (let turn = 0; turn < quarterTurns; turn++) {
    const rotated = Array.from({ length: cells.length }, () => cells[0]!)
    for (let b = 0; b < n; b++) {
      for (let a = 0; a < n; a++) {
        const cell = cells[b * n + a]!
        rotated[a * n + (n - 1 - b)] = {
          ...cell,
          sockets: rotateSocketsClockwise(cell.sockets),
          ...(cell.openingWidths ? { openingWidths: rotateOpeningWidthsClockwise(cell.openingWidths) } : {}),
        }
      }
    }
    cells.splice(0, cells.length, ...rotated)
  }
  return { grain: pattern.grain, cells }
}

function rotateOpeningWidthsClockwise(
  widths: NonNullable<ReturnType<typeof cellFromModule>['openingWidths']>,
): NonNullable<ReturnType<typeof cellFromModule>['openingWidths']> {
  return {
    n: widths.w,
    e: widths.n,
    s: widths.e,
    w: widths.s,
  }
}

function rotateSocketsClockwise(sockets: Record<Face, Socket>): Record<Face, Socket> {
  return {
    n: sockets.w,
    e: sockets.n,
    s: sockets.e,
    w: sockets.s,
    up: sockets.up,
    down: sockets.down,
  }
}
