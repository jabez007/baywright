/**
 * Exact interior block placement for the small set of modules that own it.
 *
 * A kit places blocks inside the cell interior only. It takes a palette role
 * where one fits and a fixed block ID for functional blocks, such as a
 * bookshelf or a rail. It keeps the columns in front of each wall opening
 * clear, so a kit never blocks a doorway or a window.
 */
import type { AABB, Bay, Cell, MaterialRole } from './types.js'

/**
 * A palette role, resolved per room, or a fixed block ID. A role may carry
 * a block state, as in `trim[facing=south]`, that the resolver adds when the
 * palette's block is a stair.
 */
export type DetailMaterial = MaterialRole | `${MaterialRole}[${string}]` | `minecraft:${string}`

export type DetailBlocks = Map<DetailMaterial, Set<string>>

export type WallFace = 'n' | 'e' | 's' | 'w'

/** What a kit needs to know beyond the cell itself. */
export interface DetailContext {
  /** Interior columns, as `"x,z"`, in front of each open wall face. */
  openings: Partial<Record<WallFace, ReadonlySet<string>>>
  /** The cell shares a valid merge group, so its room is larger than its interior. */
  merged: boolean
  /** The service void above a dropped ceiling. */
  plenum?: AABB | null
  /** For an item trunk on a line to a spine: where items leave, and where they come in. */
  trunk?: TrunkFlow
}

export interface TrunkFlow {
  out: WallFace
  in: readonly WallFace[]
}

const NO_CONTEXT: DetailContext = { openings: {}, merged: false }

type Kit = (bay: Bay, cell: Cell, interior: AABB, context: DetailContext) => DetailBlocks

const KITS: Readonly<Record<string, Kit>> = {
  stair: stairKit,
  arena: arenaKit,
  library: libraryKit,
  workshop: workshopKit,
  farm: farmKit,
  'rail-line': railLineKit,
  'ice-highway': iceHighwayKit,
  'nether-portal': netherPortalKit,
  'super-smelter': superSmelterKit,
  'trading-hall': tradingHallKit,
  'item-trunk': itemTrunkKit,
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
  stair: stairTop,
  library: galleryRail,
  'rail-line': railThroughOpenings,
  'ice-highway': iceThroughOpenings,
  'item-trunk': trunkThroughOpening,
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
 * How a stair room climbs to the landing above. A room five or more blocks
 * wide winds a spiral around a 3×3 core: 16 steps to a lap, one block up per
 * step, clockwise seen from above. The step at height y takes the ring
 * position y mod 16, so a stair that continues from the room below picks up
 * where that one stopped. A three-wide room is too narrow to turn in, so it
 * gets a ladder on a solid wall, opposite its door when it can. A five-wide
 * room whose floor is a shaft gets a ladder too: its spiral would fill the
 * room and cut the floor off from the steps.
 *
 * The climb ends in the landing's floor plane, with a step or a rung there.
 * A spiral keeps the plane open over its last three steps below that, so a
 * climber's head clears it.
 */
type Climb =
  | { kind: 'spiral'; cx: number; cz: number }
  | { kind: 'ladder'; x: number; z: number; facing: string }

/** The spiral ring around the core, as offsets from the centre, clockwise from the north-west corner. */
const RING: ReadonlyArray<readonly [number, number]> = [
  [-2, -2], [-1, -2], [0, -2], [1, -2],
  [2, -2], [2, -1], [2, 0], [2, 1],
  [2, 2], [1, 2], [0, 2], [-1, 2],
  [-2, 2], [-2, 1], [-2, 0], [-2, -1],
]

/** Steps the spiral leaves open above, under the plane its top step lies in. */
const WELL_HEADROOM = 3

function climbOf(cell: Cell, interior: AABB, plenum: AABB | null | undefined): Climb | null {
  if (cell.module !== 'stair' || cell.sockets.up !== 'shaft' || plenum) return null
  const width = Math.min(interior.x1 - interior.x0, interior.z1 - interior.z0) + 1
  const cx = midpoint(interior.x0, interior.x1)
  const cz = midpoint(interior.z0, interior.z1)
  if (width >= 11 || (width >= 5 && cell.sockets.down !== 'shaft')) return { kind: 'spiral', cx, cz }

  const door = entrance(cell)
  const face = [...(door ? [OPPOSITE[door]] : []), ...WALL_FACES].find((candidate) => cell.sockets[candidate] === 'solid')
  if (!face) return null
  const x = face === 'e' ? interior.x1 : face === 'w' ? interior.x0 : cx
  const z = face === 's' ? interior.z1 : face === 'n' ? interior.z0 : cz
  return { kind: 'ladder', x, z, facing: FACING[OPPOSITE[face]] }
}

/** The spiral step at height `y`, and the way a climber faces walking onto it. */
function spiralStep(climb: { cx: number; cz: number }, y: number): { x: number; z: number; facing: string } {
  const index = ((y % RING.length) + RING.length) % RING.length
  const [ox, oz] = RING[index]!
  const [px, pz] = RING[(index + RING.length - 1) % RING.length]!
  const facing = ox > px ? 'east' : ox < px ? 'west' : oz > pz ? 'south' : 'north'
  return { x: climb.cx + ox, z: climb.cz + oz, facing }
}

/** The block a climb puts at height `y`. */
function climbBlock(climb: Climb, y: number): { x: number; z: number; material: DetailMaterial } {
  if (climb.kind === 'ladder') return { x: climb.x, z: climb.z, material: `minecraft:ladder[facing=${climb.facing}]` }
  const { x, z, facing } = spiralStep(climb, y)
  return { x, z, material: `trim[facing=${facing}]` }
}

/**
 * The columns, as `"x,z"`, a stair room's upward shaft opens in the plane
 * above it, or null when the room has no climb and the shaft opens its whole
 * footprint.
 */
export function stairWell(cell: Cell, interior: AABB, plenum: AABB | null): ReadonlySet<string> | null {
  const climb = climbOf(cell, interior, plenum)
  if (!climb) return null
  const top = interior.y1 + 1
  const well = new Set<string>()
  const lowest = climb.kind === 'spiral' ? top - WELL_HEADROOM : top
  for (let y = lowest; y <= top; y++) {
    const { x, z } = climbBlock(climb, y)
    well.add(`${x},${z}`)
  }
  return well
}

function stairKit(_bay: Bay, cell: Cell, interior: AABB, context: DetailContext): DetailBlocks {
  const climb = climbOf(cell, interior, context.plenum)
  const out: DetailBlocks = new Map()
  if (!climb) return out
  for (let y = interior.y0; y <= interior.y1; y++) {
    const { x, z, material } = climbBlock(climb, y)
    roleSet(out, material).add(key(x, y, z))
  }
  if (climb.kind === 'spiral') {
    const core = roleSet(out, 'wall')
    for (let y = interior.y0; y <= interior.y1; y++) {
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) core.add(key(climb.cx + dx, y, climb.cz + dz))
    }
  }
  return out
}

/** The last step or rung, in the landing's floor plane. */
function stairTop(cell: Cell, _outer: AABB, interior: AABB, context: DetailContext): EdgeDetail[] {
  const climb = climbOf(cell, interior, context.plenum)
  if (!climb) return []
  const y = interior.y1 + 1
  const { x, z, material } = climbBlock(climb, y)
  const at = key(x, y, z)
  return [{ at, material, whereAir: at }]
}

/**
 * A merged arena has an 11×11 interior. Its centred 7×7 purpose core leaves
 * a two-block circulation ring on every side. The trim marks that boundary,
 * and four pillars rise from its corners. The resolver hangs its light.
 *
 * Trim stairs face the core, so their steps rise along its edge. Each corner
 * takes the outer shape the game gives a ring placed by hand.
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
  const trim = (state: string) => roleSet(out, `trim[${state}]`)
  const floorY = interior.y0 - 1
  for (let x = core.x0 + 1; x < core.x1; x++) {
    trim('facing=south').add(key(x, floorY, core.z0))
    trim('facing=north').add(key(x, floorY, core.z1))
  }
  for (let z = core.z0 + 1; z < core.z1; z++) {
    trim('facing=east').add(key(core.x0, floorY, z))
    trim('facing=west').add(key(core.x1, floorY, z))
  }
  trim('facing=south,shape=outer_left').add(key(core.x0, floorY, core.z0))
  trim('facing=south,shape=outer_right').add(key(core.x1, floorY, core.z0))
  trim('facing=north,shape=outer_right').add(key(core.x0, floorY, core.z1))
  trim('facing=north,shape=outer_left').add(key(core.x1, floorY, core.z1))

  const accent = roleSet(out, 'accent')
  for (const [x, z] of [
    [core.x0, core.z0],
    [core.x1, core.z0],
    [core.x0, core.z1],
    [core.x1, core.z1],
  ] as const) {
    for (let y = interior.y0; y <= interior.y1; y++) accent.add(key(x, y, z))
  }
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

/** Farmland stays wet with water this many blocks across from it, level with it or one higher. */
const HYDRATION = 4

/** Where a farm's lamps hang, from the water: close enough that every crop gets the light it grows in. */
const FIELD_LAMPS: ReadonlyArray<readonly [number, number]> = [
  [-2, -2],
  [2, -2],
  [2, 2],
  [-2, 2],
]

/**
 * A field of farmland with one water block in the middle, inside a walkway
 * one block wide along the walls. The walkway keeps every doorway clear,
 * and walking round the field never tramples it. One water block keeps
 * farmland wet four blocks out, which covers the 9x9 field of a merged room.
 * Underground, crops grow only in block light 9 or more, and one lamp in the
 * middle cannot give that at the corners, so four lamps hang two blocks
 * diagonally from the water, three above the floor, where a player on the
 * walkway passes under them. V11 checks the light the crops get.
 */
function farmKit(bay: Bay, cell: Cell, interior: AABB, context: DetailContext): DetailBlocks {
  if (bay.grain === 'fine' || context.merged || cell.sockets.down === 'shaft') return new Map()
  const cx = midpoint(interior.x0, interior.x1)
  const cz = midpoint(interior.z0, interior.z1)
  const [x0, x1, z0, z1] = [interior.x0 + 1, interior.x1 - 1, interior.z0 + 1, interior.z1 - 1]
  if (Math.max(cx - x0, x1 - cx, cz - z0, z1 - cz) > HYDRATION) return new Map()

  const out: DetailBlocks = new Map()
  const land = roleSet(out, 'minecraft:farmland')
  for (let x = x0; x <= x1; x++) {
    for (let z = z0; z <= z1; z++) if (x !== cx || z !== cz) land.add(key(x, interior.y0, z))
  }
  roleSet(out, 'minecraft:water').add(key(cx, interior.y0, cz))

  const lampY = Math.min(interior.y0 + 2, interior.y1)
  for (const [dx, dz] of FIELD_LAMPS) {
    if (isOpening(context, `${cx + dx},${cz + dz}`)) continue
    roleSet(out, 'light').add(key(cx + dx, lampY, cz + dz))
    for (let y = lampY + 1; y <= interior.y1; y++) roleSet(out, 'minecraft:chain').add(key(cx + dx, y, cz + dz))
  }
  return out
}

/** An enchanting table counts at most 15 bookshelves, enough for level 30. */
const FULL_POWER = 15

/** Along the back wall of a room large enough, in order across it. */
const STATIONS = ['crafting_table', 'smithing_table', 'anvil', 'grindstone', 'stonecutter'] as const

/**
 * An enchanting table stands in the middle of the room with 15 bookshelves on
 * the ring two blocks out. Java counts a shelf when the block halfway to it,
 * at the shelf's height, is air. Bedrock needs air at both heights, so the
 * ring between table and shelves stays empty. The shelf spot facing the
 * entrance is the way in. Shelves go level with the table first and then
 * one higher, back of the room first, never in front of an opening. A room
 * without places for all 15 gets no table, since a weaker one would look
 * finished in the plan and not be. A room with a free row between the
 * shelves and the back wall also lines that wall with crafting stations.
 */
function workshopKit(bay: Bay, cell: Cell, interior: AABB, context: DetailContext): DetailBlocks {
  if (bay.grain === 'fine' || context.merged || cell.sockets.down === 'shaft') return new Map()

  const door = entrance(cell) ?? 'n'
  const [toDoorX, toDoorZ] = STEP[door]
  const cx = midpoint(interior.x0, interior.x1)
  const cz = midpoint(interior.z0, interior.z1)
  const depth = ([dx, dz]: readonly [number, number]) => -(dx * toDoorX + dz * toDoorZ)
  const free = RING.filter(([dx, dz]) => !(dx === 2 * toDoorX && dz === 2 * toDoorZ) && !isOpening(context, `${cx + dx},${cz + dz}`))
  const backFirst = [...free].sort((l, r) => depth(r) - depth(l))
  const shelves = [
    ...free.map(([dx, dz]) => key(cx + dx, interior.y0, cz + dz)),
    ...backFirst.map(([dx, dz]) => key(cx + dx, interior.y0 + 1, cz + dz)),
  ].slice(0, FULL_POWER)

  const out: DetailBlocks = new Map()
  if (shelves.length === FULL_POWER) {
    roleSet(out, 'minecraft:enchanting_table').add(key(cx, interior.y0, cz))
    for (const shelf of shelves) roleSet(out, 'minecraft:bookshelf').add(shelf)
  }

  const frame = routeFrame(door === 'n' || door === 's' ? 'ns' : 'ew', interior)
  const fromFar = door === 'n' || door === 'w'
  const back = fromFar ? frame.along[1] : frame.along[0]
  const middle = door === 'n' || door === 's' ? cz : cx
  if (Math.abs(back - middle) < 4) return out
  const across = midpoint(frame.across[0], frame.across[1])
  STATIONS.forEach((station, index) => {
    const c = across - 2 + index
    if (isOpening(context, frame.column(back, c))) return
    const state =
      station === 'grindstone' ? `[face=floor,facing=${FACING[door]}]` : station === 'anvil' || station === 'stonecutter' ? `[facing=${FACING[door]}]` : ''
    roleSet(out, `minecraft:${station}${state}`).add(frame.place(back, interior.y0, c))
  })
  return out
}

/** The first wall face a person can walk through, checked n, e, s, w. */
function entrance(cell: Cell): WallFace | undefined {
  return WALL_FACES.find((face) => isDoorway(cell, face))
}

export function isDoorway(cell: Cell, face: WallFace): boolean {
  return cell.sockets[face] === 'corridor' || cell.sockets[face] === 'arch'
}

/** A route runs north to south or east to west. */
type Axis = 'ns' | 'ew'

/**
 * The axis a route follows: the one open at both ends, else the one open at
 * either end. A cell with no doorway has no route.
 */
function routeAxis(cell: Cell): Axis | undefined {
  const open = (face: WallFace) => isDoorway(cell, face)
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

  const track = roleSet(out, railFor(axis))
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

function railFor(axis: Axis): DetailMaterial {
  return `minecraft:rail[shape=${axis === 'ns' ? 'north_south' : 'east_west'}]`
}

/** Carry the track across each open end of the route, onto the shared wall line. */
function railThroughOpenings(cell: Cell, outer: AABB, interior: AABB): EdgeDetail[] {
  const axis = routeAxis(cell)
  if (!axis || cell.sockets.down === 'shaft') return []
  const frame = routeFrame(axis, interior)
  const centre = midpoint(frame.across[0], frame.across[1])
  const material = railFor(axis)
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
    .filter((face) => isDoorway(cell, face))
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
  const portal = netherPortalOpening(cell, interior, context)
  if (!portal) return new Map()
  const { opening } = portal
  const blocks: string[] = []
  const ns = portal.axis === 'x'
  const place = (across: number, y: number) => (ns ? key(across, y, opening.z0) : key(opening.x0, y, across))
  const [lo, hi] = ns ? [opening.x0, opening.x1] : [opening.z0, opening.z1]
  for (let c = lo; c <= hi; c++) blocks.push(place(c, opening.y0 - 1), place(c, opening.y1 + 1))
  for (let y = opening.y0; y <= opening.y1; y++) blocks.push(place(lo - 1, y), place(hi + 1, y))
  return new Map([['minecraft:obsidian', new Set(blocks)]])
}

/** Where a portal's air opening is, and the axis its frame spans. */
export interface PortalOpening {
  /** `x` for a frame that runs east to west, `z` for one that runs north to south. */
  axis: 'x' | 'z'
  /** The 3×3 air the player lights, one block thick. */
  opening: AABB
}

/** The opening the Nether portal kit frames in this cell, or null when it places no frame. */
export function netherPortalOpening(cell: Cell, interior: AABB, context: DetailContext): PortalOpening | null {
  if (cell.module !== 'nether-portal') return null
  const door = entrance(cell) ?? 'n'
  const ns = door === 'n' || door === 's'
  const frame = routeFrame(ns ? 'ns' : 'ew', interior)
  const wide = frame.across[1] - frame.across[0] + 1
  const high = interior.y1 - interior.y0 + 1
  if (wide < 5 || high < 5 || cell.sockets.down === 'shaft') return null

  const along = midpoint(frame.along[0], frame.along[1])
  const centre = midpoint(frame.across[0], frame.across[1])
  for (let c = centre - 2; c <= centre + 2; c++) {
    if (isOpening(context, frame.column(along, c))) return null
  }
  const [y0, y1] = [interior.y0 + 1, interior.y0 + 3]
  return {
    axis: ns ? 'x' : 'z',
    opening: ns
      ? { x0: centre - 1, x1: centre + 1, y0, y1, z0: along, z1: along }
      : { x0: along, x1: along, y0, y1, z0: centre - 1, z1: centre + 1 },
  }
}

export const OPPOSITE: Readonly<Record<WallFace, WallFace>> = { n: 's', e: 'w', s: 'n', w: 'e' }

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

/**
 * Stalls line the two walls that run away from the entrance, leaving a clear
 * aisle down the middle. Two-high accent dividers, two blocks deep, stand at
 * every other block along each wall, so every stall is one block wide: a
 * villager at the back and its workstation in front. The workstation is left
 * to the player, because it depends on the villager's profession.
 */
function tradingHallKit(_bay: Bay, cell: Cell, interior: AABB, context: DetailContext): DetailBlocks {
  const door = entrance(cell) ?? 'n'
  const frame = routeFrame(door === 'n' || door === 's' ? 'ns' : 'ew', interior)
  if (frame.across[1] - frame.across[0] + 1 < 5 || cell.sockets.down === 'shaft') return new Map()

  const [lo, hi] = frame.across
  const depth = [lo, lo + 1, hi - 1, hi]
  const dividers = new Set<string>()
  for (let a = frame.along[0]; a <= frame.along[1]; a += 2) {
    for (const c of depth) {
      if (isOpening(context, frame.column(a, c))) continue
      for (let y = interior.y0; y <= Math.min(interior.y0 + 1, interior.y1); y++) dividers.add(frame.place(a, y, c))
    }
  }
  return new Map([['accent', dividers]])
}

/**
 * A hopper chain on the plenum floor carries items toward the spine. Each
 * feeding face runs in to the centre of the cell, and one run carries on
 * from the centre to the face items leave by, so the chain turns corners at
 * the centre. A trunk that nothing feeds starts at the face opposite its
 * exit. The flow comes from the context; without one, no chain is placed.
 */
function itemTrunkKit(_bay: Bay, _cell: Cell, interior: AABB, context: DetailContext): DetailBlocks {
  const { plenum, trunk } = context
  if (!plenum || !trunk) return new Map()
  const centre = { x: midpoint(interior.x0, interior.x1), z: midpoint(interior.z0, interior.z1) }
  const out: DetailBlocks = new Map()
  const hopper = (face: WallFace) => roleSet(out, `minecraft:hopper[facing=${FACING[face]}]`)

  const feeds = trunk.in.length > 0 ? trunk.in : [OPPOSITE[trunk.out]]
  for (const feed of feeds) {
    const toward = hopper(OPPOSITE[feed])
    for (const [x, z] of walkFromCentre(interior, centre, feed)) toward.add(key(x, plenum.y0, z))
  }
  const onward = hopper(trunk.out)
  onward.add(key(centre.x, plenum.y0, centre.z))
  for (const [x, z] of walkFromCentre(interior, centre, trunk.out)) onward.add(key(x, plenum.y0, z))
  return out
}

/** The last hopper sits on the shared wall line and passes items to the next cell. */
function trunkThroughOpening(_cell: Cell, outer: AABB, interior: AABB, context: DetailContext): EdgeDetail[] {
  const { plenum, trunk } = context
  if (!plenum || !trunk) return []
  const x = trunk.out === 'e' ? outer.x1 : trunk.out === 'w' ? outer.x0 : midpoint(interior.x0, interior.x1)
  const z = trunk.out === 's' ? outer.z1 : trunk.out === 'n' ? outer.z0 : midpoint(interior.z0, interior.z1)
  const at = key(x, plenum.y0, z)
  return [{ at, material: `minecraft:hopper[facing=${FACING[trunk.out]}]`, whereAir: at }]
}

const STEP: Readonly<Record<WallFace, readonly [number, number]>> = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] }

/** The interior columns from beside the centre out to the wall on `face`. */
function walkFromCentre(interior: AABB, centre: { x: number; z: number }, face: WallFace): Array<[number, number]> {
  const [dx, dz] = STEP[face]
  const columns: Array<[number, number]> = []
  let x = centre.x + dx
  let z = centre.z + dz
  while (x >= interior.x0 && x <= interior.x1 && z >= interior.z0 && z <= interior.z1) {
    columns.push([x, z])
    x += dx
    z += dz
  }
  return columns
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
