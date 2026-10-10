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
  'rail-line': railLineKit,
  'ice-highway': iceHighwayKit,
  'nether-portal': netherPortalKit,
  'super-smelter': superSmelterKit,
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
  'rail-line': railThroughOpenings,
  'ice-highway': iceThroughOpenings,
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
    if (isOpening(context, `${x},${z}`)) continue
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

/** A route runs north to south or east to west. */
type Axis = 'ns' | 'ew'

/**
 * The axis a route follows: the one open at both ends, else the one open at
 * either end. A cell with no doorway has no route.
 */
function routeAxis(cell: Cell): Axis | undefined {
  const open = (face: WallFace) => cell.sockets[face] === 'corridor' || cell.sockets[face] === 'arch'
  if (open('n') && open('s')) return 'ns'
  if (open('e') && open('w')) return 'ew'
  if (open('n') || open('s')) return 'ns'
  if (open('e') || open('w')) return 'ew'
  return undefined
}

/** The faces a route crosses, which leave the side walls to its kit. */
const ROUTE_ENDS: Readonly<Record<Axis, readonly WallFace[]>> = { ns: ['n', 's'], ew: ['e', 'w'] }
const ROUTE_SIDES: Readonly<Record<Axis, readonly WallFace[]>> = { ns: ['e', 'w'], ew: ['n', 's'] }

/**
 * Lay the route's line in route coordinates: `along` the axis, `across` it.
 * `place` turns them back into a block key.
 */
function routeFrame(axis: Axis, interior: AABB) {
  const ns = axis === 'ns'
  return {
    along: ns ? [interior.z0, interior.z1] as const : [interior.x0, interior.x1] as const,
    across: ns ? [interior.x0, interior.x1] as const : [interior.z0, interior.z1] as const,
    place: (along: number, y: number, across: number) => (ns ? key(across, y, along) : key(along, y, across)),
    column: (along: number, across: number) => (ns ? `${across},${along}` : `${along},${across}`),
  }
}

/**
 * Track runs down the middle of the cell along its route. One support frame
 * stands halfway along: an accent post against each side wall and a beam of
 * the floor block across the top. The beam stays out of an upward shaft.
 */
function railLineKit(_bay: Bay, cell: Cell, interior: AABB, context: DetailContext): DetailBlocks {
  const axis = routeAxis(cell)
  if (!axis || cell.sockets.down === 'shaft') return new Map()
  const frame = routeFrame(axis, interior)
  const centre = midpoint(frame.across[0], frame.across[1])
  const out: DetailBlocks = new Map()

  const track = roleSet(out, `minecraft:rail[shape=${axis === 'ns' ? 'north_south' : 'east_west'}]`)
  for (let a = frame.along[0]; a <= frame.along[1]; a++) track.add(frame.place(a, interior.y0, centre))

  const halfway = midpoint(frame.along[0], frame.along[1])
  const posts = roleSet(out, 'accent')
  for (const side of frame.across) {
    if (side === centre) continue
    if (isOpening(context, frame.column(halfway, side), ROUTE_SIDES[axis])) continue
    for (let y = interior.y0; y < interior.y1; y++) posts.add(frame.place(halfway, y, side))
  }
  if (cell.sockets.up !== 'shaft') {
    const beam = roleSet(out, 'floor')
    for (let c = frame.across[0]; c <= frame.across[1]; c++) beam.add(frame.place(halfway, interior.y1, c))
  }
  return out
}

/** Carry the track across each open end of the route, onto the shared wall line. */
function railThroughOpenings(cell: Cell, outer: AABB, interior: AABB): EdgeDetail[] {
  const axis = routeAxis(cell)
  if (!axis || cell.sockets.down === 'shaft') return []
  const frame = routeFrame(axis, interior)
  const centre = midpoint(frame.across[0], frame.across[1])
  const material: DetailMaterial = `minecraft:rail[shape=${axis === 'ns' ? 'north_south' : 'east_west'}]`
  return openRouteEnds(cell, axis, outer).map((plane) => {
    const at = frame.place(plane, interior.y0, centre)
    return { at, material, whereAir: at }
  })
}

/**
 * A boat lane of blue ice replaces the floor down the middle of the route,
 * between two one-high accent barriers. A barrier leaves a side doorway open.
 */
function iceHighwayKit(_bay: Bay, cell: Cell, interior: AABB, context: DetailContext): DetailBlocks {
  const axis = routeAxis(cell)
  if (!axis || cell.sockets.down === 'shaft') return new Map()
  const frame = routeFrame(axis, interior)
  const centre = midpoint(frame.across[0], frame.across[1])
  const out: DetailBlocks = new Map()
  const ice = roleSet(out, 'minecraft:blue_ice')
  const barriers = roleSet(out, 'accent')
  for (let a = frame.along[0]; a <= frame.along[1]; a++) {
    ice.add(frame.place(a, interior.y0 - 1, centre))
    for (const side of [centre - 1, centre + 1]) {
      if (isOpening(context, frame.column(a, side), ROUTE_SIDES[axis])) continue
      barriers.add(frame.place(a, interior.y0, side))
    }
  }
  return out
}

/**
 * Carry the lane and its barriers across each open end of the route. The ice
 * replaces the floor under the shared wall line only where the wall above it
 * is open.
 */
function iceThroughOpenings(cell: Cell, outer: AABB, interior: AABB): EdgeDetail[] {
  const axis = routeAxis(cell)
  if (!axis || cell.sockets.down === 'shaft') return []
  const frame = routeFrame(axis, interior)
  const centre = midpoint(frame.across[0], frame.across[1])
  const edges: EdgeDetail[] = []
  for (const plane of openRouteEnds(cell, axis, outer)) {
    const doorway = frame.place(plane, interior.y0, centre)
    edges.push({ at: frame.place(plane, interior.y0 - 1, centre), material: 'minecraft:blue_ice', whereAir: doorway })
    for (const side of [centre - 1, centre + 1]) {
      const at = frame.place(plane, interior.y0, side)
      edges.push({ at, material: 'accent', whereAir: at })
    }
  }
  return edges
}

/** The wall lines, on the route axis, where the route leaves the cell. */
function openRouteEnds(cell: Cell, axis: Axis, outer: AABB): number[] {
  return ROUTE_ENDS[axis]
    .filter((face) => cell.sockets[face] === 'corridor' || cell.sockets[face] === 'arch')
    .map((face) => (face === 'n' ? outer.z0 : face === 's' ? outer.z1 : face === 'w' ? outer.x0 : outer.x1))
}

/**
 * A 5×5 obsidian frame without corners, the smallest a 3×3 portal needs,
 * stands across the middle of the room so a player walks in from the
 * entrance and straight through. The opening is left as air for the player
 * to light. A room narrower or lower than the frame gets none, and so does a
 * frame that would stand in front of an opening, since a gap breaks it.
 */
function netherPortalKit(_bay: Bay, cell: Cell, interior: AABB, context: DetailContext): DetailBlocks {
  const door = entrance(cell) ?? 'n'
  const frame = routeFrame(door === 'n' || door === 's' ? 'ns' : 'ew', interior)
  const wide = frame.across[1] - frame.across[0] + 1
  const high = interior.y1 - interior.y0 + 1
  if (wide < 5 || high < 5 || cell.sockets.down === 'shaft') return new Map()

  const along = midpoint(frame.along[0], frame.along[1])
  const centre = midpoint(frame.across[0], frame.across[1])
  const blocks: string[] = []
  for (let c = centre - 1; c <= centre + 1; c++) {
    blocks.push(frame.place(along, interior.y0, c), frame.place(along, interior.y0 + 4, c))
  }
  for (let y = interior.y0 + 1; y <= interior.y0 + 3; y++) {
    blocks.push(frame.place(along, y, centre - 2), frame.place(along, y, centre + 2))
  }
  for (let c = centre - 2; c <= centre + 2; c++) {
    if (isOpening(context, frame.column(along, c))) return new Map()
  }
  return new Map([['minecraft:obsidian', new Set(blocks)]])
}

const OPPOSITE: Readonly<Record<WallFace, WallFace>> = { n: 's', e: 'w', s: 'n', w: 'e' }

/**
 * A row of furnaces backs onto the wall opposite the entrance, facing it.
 * Each furnace has an input hopper on top and an output hopper below, both
 * pointing down, and a fuel hopper in front pointing at its side. The space
 * above the input hoppers stays clear for whatever feeds them, so the room
 * must be at least four blocks high.
 */
function superSmelterKit(_bay: Bay, cell: Cell, interior: AABB, context: DetailContext): DetailBlocks {
  const door = entrance(cell) ?? 'n'
  const frame = routeFrame(door === 'n' || door === 's' ? 'ns' : 'ew', interior)
  if (interior.y1 - interior.y0 + 1 < 4 || cell.sockets.down === 'shaft') return new Map()

  // North and west entrances put the back wall at the far end of the axis.
  const fromFar = door === 'n' || door === 'w'
  const back = fromFar ? frame.along[1] : frame.along[0]
  const front = fromFar ? back - 1 : back + 1
  const out: DetailBlocks = new Map()
  const furnaces = roleSet(out, `minecraft:furnace[facing=${FACING[door]}]`)
  const down = roleSet(out, 'minecraft:hopper[facing=down]')
  const fuel = roleSet(out, `minecraft:hopper[facing=${FACING[OPPOSITE[door]]}]`)
  for (let c = frame.across[0]; c <= frame.across[1]; c++) {
    if (isOpening(context, frame.column(back, c)) || isOpening(context, frame.column(front, c))) continue
    down.add(frame.place(back, interior.y0, c))
    furnaces.add(frame.place(back, interior.y0 + 1, c))
    down.add(frame.place(back, interior.y0 + 2, c))
    fuel.add(frame.place(front, interior.y0 + 1, c))
  }
  return out
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

/** Whether `column`, as `"x,z"`, stands in front of an opening on one of `faces`. */
function isOpening(context: DetailContext, column: string, faces: readonly WallFace[] = WALL_FACES): boolean {
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
