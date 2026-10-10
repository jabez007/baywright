/**
 * Exact interior block placement for the small set of modules that own it.
 *
 * A kit places blocks inside the cell interior only. It takes a palette role
 * where one fits and a fixed block ID for functional blocks, such as a
 * bookshelf or a rail. It keeps the columns in front of each wall opening
 * clear, so a kit never blocks a doorway or a window.
 */
import type { AABB, Bay, Cell, MaterialRole } from './types.js'

/** A palette role, resolved per room, or a fixed block ID. */
export type DetailMaterial = MaterialRole | `minecraft:${string}`

export type DetailBlocks = Map<DetailMaterial, Set<string>>

export type WallFace = 'n' | 'e' | 's' | 'w'

/** What a kit needs to know beyond the cell itself. */
export interface DetailContext {
  /** Interior columns, as `"x,z"`, in front of each open wall face. */
  openings: Partial<Record<WallFace, ReadonlySet<string>>>
  /** The cell shares a valid merge group, so its room is larger than its interior. */
  merged: boolean
}

const NO_CONTEXT: DetailContext = { openings: {}, merged: false }

type Kit = (bay: Bay, cell: Cell, interior: AABB, context: DetailContext) => DetailBlocks

const KITS: Readonly<Record<string, Kit>> = {
  arena: arenaKit,
  library: libraryKit,
}

export function interiorDetailBlocks(
  bay: Bay,
  cell: Cell,
  interior: AABB,
  context: DetailContext = NO_CONTEXT,
): DetailBlocks {
  const kit = KITS[cell.module]
  return kit ? kit(bay, cell, interior, context) : new Map()
}

/**
 * A block a kit places on the cell's walls or floor plane, outside the
 * interior. It lands only if `whereAir` is still air once every shell block
 * and interior detail is in place, so an edge detail never cuts a wall.
 */
export interface EdgeDetail {
  at: string
  material: DetailMaterial
  whereAir: string
}

type EdgeKit = (cell: Cell, outer: AABB, interior: AABB, context: DetailContext) => EdgeDetail[]

const EDGE_KITS: Readonly<Record<string, EdgeKit>> = {
  library: galleryRail,
}

export function edgeDetailBlocks(cell: Cell, outer: AABB, interior: AABB, context: DetailContext): EdgeDetail[] {
  const kit = EDGE_KITS[cell.module]
  return kit ? kit(cell, outer, interior, context) : []
}

/**
 * A library cell whose floor is a shaft, inside a larger merged room, is a
 * gallery well. A one-high accent rail rings it on the gallery floor, on the
 * wall lines the merge carved away.
 */
function galleryRail(cell: Cell, outer: AABB, interior: AABB, context: DetailContext): EdgeDetail[] {
  if (!context.merged || cell.sockets.down !== 'shaft') return []
  const rail: EdgeDetail[] = []
  for (let x = outer.x0; x <= outer.x1; x++) {
    for (let z = outer.z0; z <= outer.z1; z++) {
      if (x !== outer.x0 && x !== outer.x1 && z !== outer.z0 && z !== outer.z1) continue
      const at = key(x, interior.y0, z)
      rail.push({ at, material: 'accent', whereAir: at })
    }
  }
  return rail
}

/**
 * A merged arena has an 11×11 interior. Its centred 7×7 purpose core leaves
 * a two-block circulation ring on every side. The trim marks that boundary;
 * four pillars rise from its corners, and one light hangs at the room centre.
 */
function arenaKit(bay: Bay, _cell: Cell, interior: AABB): DetailBlocks {
  if (bay.grain !== 'merged') return new Map()

  const core = {
    x0: interior.x0 + 2,
    x1: interior.x1 - 2,
    z0: interior.z0 + 2,
    z1: interior.z1 - 2,
  }
  const out: DetailBlocks = new Map()
  const trim = roleSet(out, 'trim')
  const floorY = interior.y0 - 1
  for (let x = core.x0; x <= core.x1; x++) {
    trim.add(key(x, floorY, core.z0))
    trim.add(key(x, floorY, core.z1))
  }
  for (let z = core.z0; z <= core.z1; z++) {
    trim.add(key(core.x0, floorY, z))
    trim.add(key(core.x1, floorY, z))
  }

  const accent = roleSet(out, 'accent')
  for (const [x, z] of [
    [core.x0, core.z0],
    [core.x1, core.z0],
    [core.x0, core.z1],
    [core.x1, core.z1],
  ] as const) {
    for (let y = interior.y0; y <= interior.y1; y++) accent.add(key(x, y, z))
  }

  roleSet(out, 'light').add(key(midpoint(interior.x0, interior.x1), interior.y1, midpoint(interior.z0, interior.z1)))
  return out
}

/**
 * Bookshelves line every wall three blocks high, and a lectern stands at the
 * centre facing the first opening. A fine cell is too small to read in, and a
 * merged room is larger than this cell, so neither gets shelves. A cell whose
 * floor is a shaft is a well, not a room.
 */
function libraryKit(bay: Bay, cell: Cell, interior: AABB, context: DetailContext): DetailBlocks {
  if (bay.grain === 'fine' || context.merged || cell.sockets.down === 'shaft') return new Map()

  const out: DetailBlocks = new Map()
  const shelves = roleSet(out, 'minecraft:bookshelf')
  const top = Math.min(interior.y0 + 2, interior.y1)
  for (const [x, z] of wallColumns(interior)) {
    if (isOpening(context, x, z)) continue
    for (let y = interior.y0; y <= top; y++) shelves.add(key(x, y, z))
  }

  const facing = FACING[entrance(cell) ?? 'n']
  const centre = key(midpoint(interior.x0, interior.x1), interior.y0, midpoint(interior.z0, interior.z1))
  roleSet(out, `minecraft:lectern[facing=${facing}]`).add(centre)
  return out
}

const FACING: Readonly<Record<WallFace, string>> = { n: 'north', e: 'east', s: 'south', w: 'west' }

/** The first wall face a person can walk through, checked n, e, s, w. */
function entrance(cell: Cell): WallFace | undefined {
  return WALL_FACES.find((face) => cell.sockets[face] === 'corridor' || cell.sockets[face] === 'arch')
}

/** Every interior column that touches a wall, each corner once. */
function wallColumns(interior: AABB): Array<[number, number]> {
  const columns: Array<[number, number]> = []
  for (let x = interior.x0; x <= interior.x1; x++) {
    for (let z = interior.z0; z <= interior.z1; z++) {
      if (x === interior.x0 || x === interior.x1 || z === interior.z0 || z === interior.z1) columns.push([x, z])
    }
  }
  return columns
}

function isOpening(context: DetailContext, x: number, z: number, faces: readonly WallFace[] = WALL_FACES): boolean {
  const column = `${x},${z}`
  return faces.some((face) => context.openings[face]?.has(column))
}

const WALL_FACES: readonly WallFace[] = ['n', 'e', 's', 'w']

function roleSet(out: DetailBlocks, material: DetailMaterial): Set<string> {
  const existing = out.get(material)
  if (existing) return existing
  const created = new Set<string>()
  out.set(material, created)
  return created
}

function midpoint(lo: number, hi: number): number {
  return lo + Math.floor((hi - lo) / 2)
}

function key(x: number, y: number, z: number): string {
  return `${x},${y},${z}`
}
