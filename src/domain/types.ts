/**
 * PRD §6 — Data model.
 *
 * The persisted document stores intent only: no block coordinates ever live in
 * here. World geometry is derived on demand by `geometry.ts`.
 */

/** §5.2 — how a bay subdivides. */
export type Grain = 'fine' | 'coarse' | 'merged'

/** §5.3 — how the top of a cell is treated. */
export type Ceiling = 'dropped' | 'flat' | 'vaulted'

/** §5.4 — the six faces of a cell. `n` is -z, `s` is +z, `e` is +x, `w` is -x. */
export type Face = 'n' | 'e' | 's' | 'w' | 'up' | 'down'

/** §5.4 — what opening (if any) a face carries. */
export type Socket = 'solid' | 'corridor' | 'arch' | 'window' | 'bars' | 'shaft'

/** §5.5 — abstract material roles a palette binds to concrete block IDs. */
export type MaterialRole = 'floor' | 'wall' | 'ceiling' | 'accent' | 'trim' | 'light'

export interface Palette {
  id: string
  name: string
  blocks: Record<MaterialRole, string>
}

export interface Cell {
  module: string
  heightCells: 1 | 2 | 3
  ceiling: Ceiling
  sockets: Record<Face, Socket>
  /** Cells sharing this id render and export as one room. */
  mergeGroup?: string
  paletteOverride?: string
  note?: string
}

export interface Bay {
  grain: Grain
  /** 9 (fine) | 4 (coarse) | 1 (merged), row-major: `cells[b * n + a]`. */
  cells: Cell[]
}

export interface Level {
  id: string
  /** INVARIANT: y % 4 === 0. This is the y of the floor plane. */
  y: number
  name: string
  paletteId: string
  /** 'A1' -> Bay */
  bays: Record<string, Bay>
}

export interface Project {
  schemaVersion: 1
  id: string
  name: string
  origin: { x: number; z: number }
  /** How many letters (bay columns, the i axis). */
  bayCols: number
  /** How many numbers (bay rows, the j axis). */
  bayRows: number
  /** Sparse, kept sorted ascending by y. */
  levels: Level[]
  palettes: Record<string, Palette>
}

/** §7 — addresses one cell inside the document. */
export interface CellRef {
  levelId: string
  bayKey: string
  cellIndex: number
}

/** §7 — an inclusive axis-aligned box in world coordinates. */
export interface AABB {
  x0: number
  y0: number
  z0: number
  x1: number
  y1: number
  z1: number
}

/** §5.1 — bays sit on a 12-block pitch and span local 0..12 inclusive. */
export const BAY_PITCH = 12

/**
 * §15 open question 2 — the field is capped while the collision check is still
 * O(n²) per bay. An 8x8 field at 3 levels is 576 bays, up to 5184 cells.
 */
export const MAX_BAY_FIELD = 8

/** §5.3 — level y values and cell heights are quantised to 4 blocks. */
export const LEVEL_PITCH = 4

/** §5.2 — cells per bay axis, by grain. */
export const GRAIN_AXIS_CELLS: Readonly<Record<Grain, 1 | 2 | 3>> = {
  fine: 3,
  coarse: 2,
  merged: 1,
}

/**
 * §5.2 — local cell pitch by grain. A cell at axis index `a` spans local
 * `pitch * a .. pitch * a + pitch`, with interior `+1 .. +pitch - 1`.
 * `merged` uses the whole bay, so its pitch is the bay pitch.
 */
export const GRAIN_CELL_PITCH: Readonly<Record<Grain, number>> = {
  fine: 4,
  coarse: 6,
  merged: BAY_PITCH,
}

/** Number of cells a bay of this grain holds. */
export function cellCount(grain: Grain): number {
  const n = GRAIN_AXIS_CELLS[grain]
  return n * n
}
