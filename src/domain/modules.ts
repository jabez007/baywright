/**
 * PRD §5.5 — module presets.
 *
 * A module is a named preset that fills in default `heightCells`, `ceiling`,
 * `sockets`, and decoration hints. Painting a module onto a cell replaces those
 * fields; everything else about the cell is the painter's business.
 *
 * Pure data plus two lookups. No Vue, no store.
 */
import type { Cell, Ceiling, Face, Grain, Socket } from './types.js'

/**
 * §10 — the plan canvas colours by category, not by module identity, so these
 * four are a rendering contract as much as a taxonomy.
 */
export type ModuleCategory = 'circulation' | 'room' | 'service' | 'storage'

/**
 * Detailing the exporter applies inside a cell. Deliberately a closed set:
 * adding a hint means teaching the exporter to place it.
 */
export type DecorationHint =
  | 'anvils'
  | 'banners'
  | 'barrels'
  | 'bars-door'
  | 'bookshelves'
  | 'carpet'
  | 'chandelier'
  | 'chests'
  | 'farmland'
  | 'hoppers'
  | 'ladder'
  | 'lanterns'
  | 'lecterns'
  | 'pillars'
  | 'railings'
  | 'shelving'
  | 'stair-flight'
  | 'trapdoor-hatch'
  | 'water'
  | 'workbenches'

export interface Module {
  id: string
  name: string
  category: ModuleCategory
  heightCells: 1 | 2 | 3
  ceiling: Ceiling
  sockets: Record<Face, Socket>
  hints: DecorationHint[]
  /**
   * What bay-mode painting should set the grain to (§10). Only set where the
   * module only makes sense at one grain; cell-mode painting ignores it.
   */
  suggestedGrain?: Grain
  /** One line for the toolbar tooltip. */
  description: string
}

/** The module every cell starts as. */
export const DEFAULT_MODULE_ID = 'empty'

/** V3 and V5 flood-fill from this module (§8). */
export const SPINE_MODULE_ID = 'spine'

/** All six faces solid unless named. */
function faces(open: Partial<Record<Face, Socket>> = {}): Record<Face, Socket> {
  return { n: 'solid', e: 'solid', s: 'solid', w: 'solid', up: 'solid', down: 'solid', ...open }
}

/**
 * The fourteen shipped presets, in toolbar order: circulation first, since
 * that is what gets painted first.
 *
 * Modules with a single entrance put it on `n` by convention. Orientation is
 * the painter's job — §10 gives alt-click on a cell edge to cycle that face —
 * so the presets pick a direction rather than trying to guess one.
 */
export const MODULE_LIST: readonly Module[] = [
  {
    id: 'spine',
    name: 'Spine',
    category: 'circulation',
    heightCells: 2,
    ceiling: 'dropped',
    sockets: faces({ n: 'corridor', e: 'corridor', s: 'corridor', w: 'corridor' }),
    hints: ['lanterns', 'hoppers'],
    description: 'Circulation backbone. Carries its own plenum for the service trunk.',
  },
  {
    id: 'corridor',
    name: 'Corridor',
    category: 'circulation',
    heightCells: 1,
    ceiling: 'flat',
    sockets: faces({ n: 'corridor', s: 'corridor' }),
    hints: ['lanterns'],
    description: 'A straight run. Alt-click an edge to turn it.',
  },
  {
    id: 'junction',
    name: 'Junction',
    category: 'circulation',
    heightCells: 1,
    ceiling: 'flat',
    sockets: faces({ n: 'corridor', e: 'corridor', s: 'corridor', w: 'corridor' }),
    hints: ['lanterns'],
    description: 'Open on all four sides.',
  },
  {
    id: 'stair',
    name: 'Stair',
    category: 'circulation',
    heightCells: 2,
    ceiling: 'flat',
    // `up` only. The cell above needs `down: 'shaft'` to match, and V4 says so
    // out loud — better than defaulting `down` on and punching a silent hole
    // through the ground floor.
    sockets: faces({ n: 'corridor', up: 'shaft' }),
    hints: ['stair-flight', 'railings'],
    description: 'Rises 8 to the level above, which needs a matching shaft down.',
  },
  {
    id: 'vestibule',
    name: 'Vestibule',
    category: 'circulation',
    heightCells: 2,
    ceiling: 'flat',
    sockets: faces({ n: 'corridor', e: 'corridor', s: 'corridor', w: 'corridor' }),
    hints: ['pillars', 'lanterns'],
    suggestedGrain: 'merged',
    // §8 V2: a merged bay spans local 1..11, which contains every fine and
    // coarse span, so it adapts any seam.
    description: 'Merged-grain adapter. Drop one at a fine/coarse seam.',
  },
  {
    id: 'storage',
    name: 'Storage',
    category: 'storage',
    heightCells: 1,
    ceiling: 'flat',
    sockets: faces({ n: 'corridor' }),
    hints: ['barrels', 'chests', 'shelving'],
    description: 'Barrel and chest walls.',
  },
  {
    id: 'vault',
    name: 'Vault',
    category: 'storage',
    heightCells: 2,
    ceiling: 'flat',
    sockets: faces({ n: 'arch' }),
    hints: ['chests', 'banners', 'carpet'],
    description: 'The treasury. One arched way in.',
  },
  {
    id: 'library',
    name: 'Library',
    category: 'room',
    heightCells: 2,
    ceiling: 'flat',
    sockets: faces({ n: 'arch' }),
    hints: ['bookshelves', 'lecterns', 'carpet'],
    description: 'Bookshelf walls and lecterns.',
  },
  {
    id: 'arena',
    name: 'Arena',
    category: 'room',
    heightCells: 3,
    ceiling: 'vaulted',
    sockets: faces({ n: 'corridor', e: 'corridor', s: 'corridor', w: 'corridor' }),
    hints: ['pillars', 'chandelier', 'banners'],
    suggestedGrain: 'merged',
    description: 'Full-height vaulted hall. Watch the level above it.',
  },
  {
    id: 'workshop',
    name: 'Workshop',
    category: 'room',
    heightCells: 1,
    ceiling: 'flat',
    sockets: faces({ n: 'corridor' }),
    hints: ['workbenches', 'anvils'],
    description: 'Crafting stations along the walls.',
  },
  {
    id: 'prison-cell',
    name: 'Prison Cell',
    category: 'room',
    heightCells: 1,
    ceiling: 'flat',
    sockets: faces({ n: 'bars', s: 'window' }),
    hints: ['bars-door'],
    description: 'Barred door, one high window.',
  },
  {
    id: 'farm',
    name: 'Farm',
    category: 'service',
    heightCells: 2,
    ceiling: 'flat',
    sockets: faces({ n: 'corridor' }),
    hints: ['farmland', 'water', 'lanterns'],
    description: 'Tilled rows and a water channel.',
  },
  {
    id: 'plenum-access',
    name: 'Plenum Access',
    category: 'service',
    heightCells: 2,
    ceiling: 'dropped',
    sockets: faces({ n: 'corridor' }),
    hints: ['ladder', 'trapdoor-hatch', 'hoppers'],
    description: 'Hatch up into the service plenum.',
  },
  {
    id: 'empty',
    name: 'Empty',
    category: 'room',
    heightCells: 1,
    ceiling: 'flat',
    sockets: faces(),
    hints: [],
    description: 'Sealed. The starting state of every cell.',
  },
]

export const MODULES: Readonly<Record<string, Module>> = Object.fromEntries(
  MODULE_LIST.map((module) => [module.id, module]),
)

export const MODULE_IDS: readonly string[] = MODULE_LIST.map((module) => module.id)

export function getModule(id: string): Module | undefined {
  return MODULES[id]
}

/**
 * What colour the canvas paints a cell (§10). Projects can carry module ids
 * this build has never heard of, so an unknown one renders as a plain room
 * rather than crashing the canvas.
 */
export function categoryOf(moduleId: string): ModuleCategory {
  return MODULES[moduleId]?.category ?? 'room'
}

/** Like `Partial<Cell>`, but you can override one face without naming all six. */
export interface CellOverrides extends Partial<Omit<Cell, 'sockets'>> {
  sockets?: Partial<Record<Face, Socket>>
}

/**
 * Build a fresh cell from a preset. `sockets` is always a new object, so cells
 * painted from the same module never end up sharing one — and the preset table
 * itself stays immutable no matter what the store does to the cell afterwards.
 */
export function cellFromModule(moduleId: string, overrides: CellOverrides = {}): Cell {
  const module = MODULES[moduleId]
  if (!module) throw new Error(`no module '${moduleId}' (known: ${MODULE_IDS.join(', ')})`)
  return {
    heightCells: module.heightCells,
    ceiling: module.ceiling,
    ...overrides,
    module: module.id,
    sockets: { ...module.sockets, ...overrides.sockets },
  }
}
