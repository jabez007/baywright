/**
 * PRD §7 — Geometry resolver.
 *
 * Pure and side-effect free. No Vue imports, no store imports. Every world
 * coordinate in the app is derived here, so the exporter and the renderer are
 * both functions of this one module.
 */
import { PALETTES, SOCKET_BLOCKS } from './palettes.js'
import {
  edgeDetailBlocks,
  interiorDetailBlocks,
  isDoorway,
  netherPortalOpening,
  OPPOSITE,
  stairWell,
  type DetailContext,
  type DetailMaterial,
  type PortalOpening,
  type TrunkFlow,
  type WallFace,
} from './details.js'
import { LightField, lightEmission, parseBlockId } from './lighting.js'
import { isBuiltCell } from './modules.js'
import {
  BAY_PITCH,
  GRAIN_AXIS_CELLS,
  GRAIN_CELL_PITCH,
  LEVEL_PITCH,
  type AABB,
  type Bay,
  type Cell,
  type CellRef,
  type Face,
  type Grain,
  type Level,
  type MaterialRole,
  type OpeningWidth,
  type Palette,
  type Project,
  type Socket,
} from './types.js'

/** Roles a cell shell can emit. `bars` is socket-driven, not palette-driven. */
export type ShellRole = MaterialRole | 'bars'

/**
 * Which role survives when two cells claim the same coordinate. Adjacent cells
 * share wall planes and stacked cells share floor/ceiling planes, so the merge
 * needs a total order to stay deterministic. You stand on floors, so floors win.
 */
const ROLE_PRIORITY: Readonly<Record<ShellRole, number>> = {
  floor: 0,
  ceiling: 1,
  wall: 2,
  bars: 3,
  accent: 4,
  trim: 5,
  light: 6,
}

const A_CHAR = 'A'.charCodeAt(0)

// --------------------------------------------------------------------------
// Bay addressing (§5.1)
// --------------------------------------------------------------------------

/** `(0, 0)` -> `"A1"`, `(2, 2)` -> `"C3"`. Columns run A..Z, AA, AB, ... */
export function bayKeyOf(i: number, j: number): string {
  if (!Number.isInteger(i) || i < 0) throw new RangeError(`bay column ${i} is not a non-negative integer`)
  if (!Number.isInteger(j) || j < 0) throw new RangeError(`bay row ${j} is not a non-negative integer`)
  let letters = ''
  let n = i
  do {
    letters = String.fromCharCode(A_CHAR + (n % 26)) + letters
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return `${letters}${j + 1}`
}

/** `"A1"` -> `{ i: 0, j: 0 }`. Bay numbers are 1-indexed in the UI, 0-indexed here. */
export function parseBayKey(key: string): { i: number; j: number } {
  const match = /^([A-Z]+)([0-9]+)$/.exec(key)
  if (!match) throw new Error(`malformed bay key '${key}' (expected uppercase letters then a 1-indexed number)`)
  const [, letters = '', digits = ''] = match
  let i = 0
  for (const ch of letters) i = i * 26 + (ch.charCodeAt(0) - A_CHAR + 1)
  const j = Number.parseInt(digits, 10)
  if (j < 1) throw new Error(`malformed bay key '${key}' (bay numbers start at 1)`)
  return { i: i - 1, j: j - 1 }
}

/** World coordinate of the bay's `(0, 0)` local corner. */
export function bayOrigin(project: Project, bayKey: string): { x: number; z: number } {
  const { i, j } = parseBayKey(bayKey)
  return {
    x: project.origin.x + BAY_PITCH * i,
    z: project.origin.z + BAY_PITCH * j,
  }
}

// --------------------------------------------------------------------------
// Cell addressing within a bay (§5.2)
// --------------------------------------------------------------------------

/** Row-major `cells[b * n + a]` -> the per-axis indices `a` (x) and `b` (z). */
export function cellAxisIndices(grain: Grain, cellIndex: number): { a: 0 | 1 | 2; b: 0 | 1 | 2 } {
  const n = GRAIN_AXIS_CELLS[grain]
  if (!Number.isInteger(cellIndex) || cellIndex < 0 || cellIndex >= n * n) {
    throw new RangeError(`cell index ${cellIndex} is out of range for a ${grain} bay (0..${n * n - 1})`)
  }
  return { a: (cellIndex % n) as 0 | 1 | 2, b: Math.floor(cellIndex / n) as 0 | 1 | 2 }
}

/** Inverse of {@link cellAxisIndices}. */
export function cellIndexOf(grain: Grain, a: number, b: number): number {
  return b * GRAIN_AXIS_CELLS[grain] + a
}

/** Local outer span `[lo, hi]` (inclusive) of a cell along one axis. */
export function outerSpan(grain: Grain, index: 0 | 1 | 2): [number, number] {
  assertAxisIndex(grain, index)
  const pitch = GRAIN_CELL_PITCH[grain]
  return [pitch * index, pitch * index + pitch]
}

/**
 * Local interior span `[lo, hi]` (inclusive) along one axis: fine `1..3`,
 * `5..7`, `9..11`; coarse `1..5`, `7..11`; merged `1..11`.
 */
export function interiorSpan(grain: Grain, index: 0 | 1 | 2): [number, number] {
  assertAxisIndex(grain, index)
  const pitch = GRAIN_CELL_PITCH[grain]
  return [pitch * index + 1, pitch * index + pitch - 1]
}

function assertAxisIndex(grain: Grain, index: number): void {
  if (index < 0 || index >= GRAIN_AXIS_CELLS[grain]) {
    throw new RangeError(`axis index ${index} is out of range for ${grain} grain`)
  }
}

// --------------------------------------------------------------------------
// Document lookup
// --------------------------------------------------------------------------

export interface ResolvedCell {
  level: Level
  bay: Bay
  cell: Cell
  a: 0 | 1 | 2
  b: 0 | 1 | 2
}

/** Dereference a {@link CellRef}, throwing a descriptive error if it dangles. */
export function resolveCell(project: Project, ref: CellRef): ResolvedCell {
  const level = project.levels.find((l) => l.id === ref.levelId)
  if (!level) throw new Error(`no level '${ref.levelId}' in project '${project.id}'`)
  const bay = level.bays[ref.bayKey]
  if (!bay) throw new Error(`no bay '${ref.bayKey}' on level '${ref.levelId}'`)
  const cell = bay.cells[ref.cellIndex]
  if (!cell) throw new Error(`no cell ${ref.cellIndex} in bay '${ref.bayKey}' on level '${ref.levelId}'`)
  const { a, b } = cellAxisIndices(bay.grain, ref.cellIndex)
  return { level, bay, cell, a, b }
}

/** Every cell in the project, in a stable order (level y asc, bay key asc, index asc). */
export function allCellRefs(project: Project): CellRef[] {
  const refs: CellRef[] = []
  for (const level of sortedLevels(project)) {
    for (const bayKey of Object.keys(level.bays).sort()) {
      const bay = level.bays[bayKey]
      if (!bay) continue
      for (let cellIndex = 0; cellIndex < bay.cells.length; cellIndex++) {
        refs.push({ levelId: level.id, bayKey, cellIndex })
      }
    }
  }
  return refs
}

/** Every cell that places blocks, in the {@link allCellRefs} order. */
export function builtCellRefs(project: Project): CellRef[] {
  return allCellRefs(project).filter((ref) => isBuiltCell(resolveCell(project, ref).cell))
}

/** Levels ascending by y; ties broken by id so ordering is total and stable. */
export function sortedLevels(project: Project): Level[] {
  return [...project.levels].sort((l, r) => l.y - r.y || l.id.localeCompare(r.id))
}

// --------------------------------------------------------------------------
// Vertical rules (§5.3)
// --------------------------------------------------------------------------

/**
 * A dropped ceiling inserts a solid plane at `y + 4`. New edits restrict this
 * to 2-cell-high rooms, while height-3 schema-v1 rooms retain their old plenum.
 */
export function hasDroppedCeiling(cell: Cell): boolean {
  return cell.ceiling === 'dropped' && cell.heightCells >= 2
}

/** World y of the inserted dropped-ceiling plane, or null when there is none. */
export function droppedCeilingY(level: Level, cell: Cell): number | null {
  return hasDroppedCeiling(cell) ? level.y + LEVEL_PITCH : null
}

// --------------------------------------------------------------------------
// §7 — the resolver surface
// --------------------------------------------------------------------------

/** Outer bounds of a cell, inclusive, in world coordinates. */
export function cellAABB(project: Project, ref: CellRef): AABB {
  const { level, bay, cell, a, b } = resolveCell(project, ref)
  const origin = bayOrigin(project, ref.bayKey)
  const [lx0, lx1] = outerSpan(bay.grain, a)
  const [lz0, lz1] = outerSpan(bay.grain, b)
  return {
    x0: origin.x + lx0,
    y0: level.y,
    z0: origin.z + lz0,
    x1: origin.x + lx1,
    y1: level.y + LEVEL_PITCH * cell.heightCells,
    z1: origin.z + lz1,
  }
}

/** Interior (air) bounds of a cell, excluding the dropped ceiling if present. */
export function cellInterior(project: Project, ref: CellRef): AABB {
  const { level, bay, cell, a, b } = resolveCell(project, ref)
  const origin = bayOrigin(project, ref.bayKey)
  const [lx0, lx1] = interiorSpan(bay.grain, a)
  const [lz0, lz1] = interiorSpan(bay.grain, b)
  const roomTop = hasDroppedCeiling(cell)
    ? level.y + LEVEL_PITCH - 1
    : level.y + LEVEL_PITCH * cell.heightCells - 1
  return {
    x0: origin.x + lx0,
    y0: level.y + 1,
    z0: origin.z + lz0,
    x1: origin.x + lx1,
    y1: roomTop,
    z1: origin.z + lz1,
  }
}

/** The service plenum void above a dropped-ceiling cell, or null. */
export function cellPlenum(project: Project, ref: CellRef): AABB | null {
  const { level, cell } = resolveCell(project, ref)
  if (!hasDroppedCeiling(cell)) return null
  const interior = cellInterior(project, ref)
  return {
    x0: interior.x0,
    y0: level.y + LEVEL_PITCH + 1,
    z0: interior.z0,
    x1: interior.x1,
    y1: level.y + LEVEL_PITCH * cell.heightCells - 1,
    z1: interior.z1,
  }
}

/**
 * Every block position for a cell shell, keyed by material role.
 *
 * The shell is the outer AABB minus the air volumes: the interior, the plenum,
 * and whatever the sockets carve out of the boundary planes. Coordinates are
 * deduplicated — a coordinate appears under exactly one role — and
 * {@link resolveBlocks} dedups again across cells, since adjacent cells share
 * wall planes and naive summing overcounts.
 */
export function shellBlocks(project: Project, ref: CellRef): Map<ShellRole, Set<string>> {
  const { level, cell } = resolveCell(project, ref)
  const outer = cellAABB(project, ref)
  const interior = cellInterior(project, ref)
  const plenum = cellPlenum(project, ref)
  const dropped = droppedCeilingY(level, cell)
  const { voids, bars } = socketOpenings(outer, interior, plenum, cell.sockets, cell.openingWidths, shaftWells(project, ref))

  const out = new Map<ShellRole, Set<string>>()
  for (let y = outer.y0; y <= outer.y1; y++) {
    for (let z = outer.z0; z <= outer.z1; z++) {
      for (let x = outer.x0; x <= outer.x1; x++) {
        // Skip whole runs of air rather than testing every interior coordinate.
        if (contains(interior, x, y, z)) {
          x = interior.x1
          continue
        }
        if (plenum && contains(plenum, x, y, z)) {
          x = plenum.x1
          continue
        }
        const key = blockKey(x, y, z)
        if (voids.has(key)) continue
        const role: ShellRole = bars.has(key) ? 'bars' : planeRole(y, outer, dropped)
        let set = out.get(role)
        if (!set) {
          set = new Set<string>()
          out.set(role, set)
        }
        set.add(key)
      }
    }
  }
  return out
}

/**
 * Whole-project block map: `"x,y,z"` -> blockId. Used by exporters and the BOM.
 *
 * Memoised on the exact serialized project document. Every return value is a
 * detached map so callers cannot modify the cached copy.
 */
export function resolveBlocks(project: Project): Map<string, string> {
  return new Map(resolved(project).blocks)
}

/** Block light over the blocks {@link resolveBlocks} returns. */
export function resolveLight(project: Project): LightField {
  return resolved(project).light
}

/** A Nether portal frame the resolver placed, and the cell that holds it. */
export interface ResolvedPortal extends PortalOpening {
  ref: CellRef
}

/** Every Nether portal frame in {@link resolveBlocks}, in cell order. */
export function resolvePortals(project: Project): ResolvedPortal[] {
  return resolved(project).portals.map((portal) => ({ ...portal, ref: { ...portal.ref }, opening: { ...portal.opening } }))
}

interface Resolved {
  serialized: string
  blocks: Map<string, string>
  light: LightField
  portals: ResolvedPortal[]
}

function resolved(project: Project): Resolved {
  const serialized = hashProject(project)
  const hit = blockCache.get(project)
  if (hit && hit.serialized === serialized) return hit
  const entry = { serialized, ...computeBlocks(project) }
  blockCache.set(project, entry)
  return entry
}

const blockCache = new WeakMap<Project, Resolved>()

function computeBlocks(project: Project): Omit<Resolved, 'serialized'> {
  const blocks = new Map<string, string>()
  const claimed = new Map<string, number>()
  for (const ref of builtCellRefs(project)) {
    const { level, cell } = resolveCell(project, ref)
    const palette = paletteFor(project, level, cell)
    for (const [role, coords] of shellBlocks(project, ref)) {
      const priority = ROLE_PRIORITY[role]
      const blockId = blockForRole(role, palette)
      for (const key of coords) {
        const held = claimed.get(key)
        if (held !== undefined && held <= priority) continue
        claimed.set(key, priority)
        blocks.set(key, blockId)
      }
    }
  }
  carveValidMergeGroups(project, blocks)
  const portals = placeInteriorDetails(project, blocks)
  const light = placeLights(project, blocks)
  return { blocks, light, portals }
}

/** The chain a light hangs from when the room is too tall to light from its ceiling. */
const CHAIN = 'minecraft:chain'

/**
 * A lamp leaves this many free blocks above the floor, which clears a
 * player's head and still lights the corners of an 11×11 room.
 */
const LAMP_CLEARANCE = 3

/** The most lamps one room or plenum gets. */
const MAX_LAMPS = 4

/**
 * Hang the palette light in every room and plenum that still has a floor a
 * mob could spawn on. Rooms go from the top level down, so a landing's light
 * can serve the stair shaft below it, and a light that already reaches a
 * neighbour's floor saves that neighbour a lamp. A room still dark after its
 * first lamp, such as a stair hall with a core in the middle, gets another
 * nearest the middle of the dark floor that remains. Returns the finished
 * light.
 */
function placeLights(project: Project, blocks: Map<string, string>): LightField {
  const light = new LightField(blocks)
  const rooms = builtCellRefs(project)
    .map((ref) => ({ ref, outer: cellAABB(project, ref), interior: cellInterior(project, ref), plenum: cellPlenum(project, ref) }))
    .sort((l, r) => r.interior.y0 - l.interior.y0)
  for (const { ref, outer, interior, plenum } of rooms) {
    const { level, cell } = resolveCell(project, ref)
    const lamp = paletteFor(project, level, cell).blocks.light
    for (const volume of plenum ? [interior, plenum] : [interior]) {
      // Doorways in the walls count too, as they do for V9.
      const floor = { ...volume, x0: outer.x0, x1: outer.x1, z0: outer.z0, z1: outer.z1 }
      for (let lamps = 0; lamps < MAX_LAMPS; lamps++) {
        const dark = darkFloor(light, floor)
        if (dark.length === 0) break
        const spot = lamps === 0 ? (lampSpot(blocks, volume) ?? landingSpot(blocks, rooms, volume)) : lampSpot(blocks, volume, middle(dark))
        if (!spot) break
        for (let y = spot.y + 1; y <= spot.top; y++) {
          blocks.set(blockKey(spot.x, y, spot.z), CHAIN)
          light.place(spot.x, y, spot.z, CHAIN)
        }
        blocks.set(blockKey(spot.x, spot.y, spot.z), lamp)
        light.place(spot.x, spot.y, spot.z, lamp)
        // A lamp that gives no light would only be repeated. V9 names it.
        if (lightEmission(lamp) === 0) break
      }
    }
  }
  return light
}

function darkFloor(light: LightField, volume: AABB): Array<[number, number]> {
  const dark: Array<[number, number]> = []
  for (let y = volume.y0; y <= volume.y1; y++) {
    for (let z = volume.z0; z <= volume.z1; z++) {
      for (let x = volume.x0; x <= volume.x1; x++) if (light.isDarkSpawn(x, y, z)) dark.push([x, z])
    }
  }
  return dark
}

/** The column at the middle of some columns, rounded down. */
function middle(columns: ReadonlyArray<readonly [number, number]>): [number, number] {
  const sum = columns.reduce(([sx, sz], [x, z]) => [sx + x, sz + z], [0, 0])
  return [Math.floor(sum[0] / columns.length), Math.floor(sum[1] / columns.length)]
}

interface LampSpot {
  x: number
  y: number
  z: number
  /** The highest block of the chain above the lamp, or `y` when it has none. */
  top: number
}

/**
 * The free top column nearest the volume's centre, or nearest the column
 * given, hanging from the block above. A tall volume lowers the lamp on a chain, but never past a detail
 * block, so a portal frame or a kit below keeps its space. A column a stair
 * or ladder climbs through stays clear for the climber's head.
 */
function lampSpot(
  blocks: ReadonlyMap<string, string>,
  volume: AABB,
  [cx, cz]: readonly [number, number] = [midpoint(volume.x0, volume.x1), midpoint(volume.z0, volume.z1)],
): LampSpot | null {
  const columns: Array<[number, number]> = []
  for (let z = volume.z0; z <= volume.z1; z++) for (let x = volume.x0; x <= volume.x1; x++) columns.push([x, z])
  columns.sort(([lx, lz], [rx, rz]) => Math.abs(lx - cx) + Math.abs(lz - cz) - Math.abs(rx - cx) - Math.abs(rz - cz))

  const lowest = Math.min(volume.y1, volume.y0 + LAMP_CLEARANCE)
  for (const [x, z] of columns) {
    if (!blocks.has(blockKey(x, volume.y1 + 1, z)) || blocks.has(blockKey(x, volume.y1, z))) continue
    if (isClimbColumn(blocks, volume, x, z)) continue
    let y = volume.y1
    while (y > lowest && !blocks.has(blockKey(x, y - 1, z))) y--
    return { x, y, z, top: volume.y1 }
  }
  return null
}

function isClimbColumn(blocks: ReadonlyMap<string, string>, volume: AABB, x: number, z: number): boolean {
  for (let y = volume.y0; y <= volume.y1; y++) {
    const blockId = blocks.get(blockKey(x, y, z))
    if (blockId && CLIMBS.test(parseBlockId(blockId).name)) return true
  }
  return false
}

const CLIMBS = /_stairs$|^ladder$/

/**
 * A stair shaft has no ceiling to hang from, so its lamp hangs in the room
 * the shaft opens into, climbing until a room has a ceiling.
 */
function landingSpot(
  blocks: ReadonlyMap<string, string>,
  rooms: ReadonlyArray<{ interior: AABB }>,
  volume: AABB,
): LampSpot | null {
  let from = volume
  for (let step = 0; step < 4; step++) {
    const x = midpoint(from.x0, from.x1)
    const z = midpoint(from.z0, from.z1)
    const above = rooms.find(({ interior }) => interior.y0 > from.y1 && interior.y0 <= from.y1 + 2 && contains(interior, x, interior.y0, z))
    if (!above) return null
    const spot = lampSpot(blocks, above.interior)
    if (spot) return spot
    from = above.interior
  }
  return null
}

/**
 * Details land last because floor trim intentionally replaces the shell
 * palette. Returns the Nether portal frames the kits placed.
 */
function placeInteriorDetails(project: Project, blocks: Map<string, string>): ResolvedPortal[] {
  const portals: ResolvedPortal[] = []
  const merged = validMergeGroupIds(project)
  const trunks = trunkFlows(project)
  const edges: Array<{ at: string; blockId: string; whereAir: string }> = []
  for (const ref of builtCellRefs(project)) {
    const { level, bay, cell } = resolveCell(project, ref)
    const palette = paletteFor(project, level, cell)
    const interior = cellInterior(project, ref)
    const context: DetailContext = {
      openings: openingColumns(cell, interior),
      merged: cell.mergeGroup !== undefined && merged.has(cell.mergeGroup),
      plenum: cellPlenum(project, ref),
      trunk: trunks.get(refKey(ref)),
    }
    const portal = netherPortalOpening(cell, interior, context)
    if (portal) portals.push({ ...portal, ref })
    for (const [material, coords] of interiorDetailBlocks(bay, cell, interior, context)) {
      const blockId = detailBlockId(material, palette)
      for (const key of coords) blocks.set(key, blockId)
    }
    for (const edge of edgeDetailBlocks(cell, cellAABB(project, ref), interior, context)) {
      edges.push({ at: edge.at, blockId: detailBlockId(edge.material, palette), whereAir: edge.whereAir })
    }
  }

  // Every edge checks the same finished map, so the order cells come in
  // cannot decide whether a neighbour's edge detail counts as a wall.
  const landing = edges.filter((edge) => !blocks.has(edge.whereAir))
  for (const edge of landing) blocks.set(edge.at, edge.blockId)
  return portals
}

function detailBlockId(material: DetailMaterial, palette: Palette): string {
  if (material.includes(':')) return material
  const open = material.indexOf('[')
  if (open === -1) return palette.blocks[material as MaterialRole]
  const blockId = palette.blocks[material.slice(0, open) as MaterialRole]
  return isStairs(blockId) ? withState(blockId, parseBlockId(material).state) : blockId
}

function isStairs(blockId: string): boolean {
  return parseBlockId(blockId).name.endsWith('_stairs')
}

/** The block with `state` added, over any state of its own, in the game's key order. */
function withState(blockId: string, state: Readonly<Record<string, string>>): string {
  const parsed = parseBlockId(blockId)
  const merged = { ...parsed.state, ...state }
  const open = blockId.indexOf('[')
  const base = open === -1 ? blockId : blockId.slice(0, open)
  const pairs = Object.keys(merged)
    .sort()
    .map((name) => `${name}=${merged[name]}`)
  return `${base}[${pairs.join(',')}]`
}

/**
 * Which way items flow along each item trunk. A trunk cell that opens onto a
 * spine sends its items there. Flow then spreads back, one cell at a time,
 * through trunk cells joined by doorways whose centre lines meet, so every
 * trunk on an unbroken line to a spine sends items one step closer to it.
 */
function trunkFlows(project: Project): Map<string, TrunkFlow> {
  interface TrunkNode { ref: CellRef; cell: Cell; outer: AABB; interior: AABB }
  const flows = new Map<string, { out: WallFace; in: WallFace[] }>()
  const byLevel = new Map<string, TrunkNode[]>()
  for (const ref of builtCellRefs(project)) {
    const { cell } = resolveCell(project, ref)
    if (cell.module !== 'item-trunk' && cell.module !== 'spine') continue
    const node = { ref, cell, outer: cellAABB(project, ref), interior: cellInterior(project, ref) }
    const group = byLevel.get(ref.levelId)
    if (group) group.push(node)
    else byLevel.set(ref.levelId, [node])
  }

  /** The cell across `face` from `node` whose interior the centre line enters. */
  const across = (nodes: TrunkNode[], node: TrunkNode, face: WallFace): TrunkNode | undefined => {
    const eastWest = face === 'e' || face === 'w'
    const line = eastWest ? midpoint(node.interior.z0, node.interior.z1) : midpoint(node.interior.x0, node.interior.x1)
    return nodes.find((other) => {
      const touches =
        face === 'e' ? other.outer.x0 === node.outer.x1
          : face === 'w' ? other.outer.x1 === node.outer.x0
            : face === 's' ? other.outer.z0 === node.outer.z1
              : other.outer.z1 === node.outer.z0
      if (!touches || !isDoorway(other.cell, OPPOSITE[face])) return false
      const [lo, hi] = eastWest ? [other.interior.z0, other.interior.z1] : [other.interior.x0, other.interior.x1]
      if (other.cell.module === 'spine') return line >= lo && line <= hi
      return line === midpoint(lo, hi)
    })
  }

  for (const nodes of byLevel.values()) {
    const trunks = nodes.filter((node) => node.cell.module === 'item-trunk' && hasDroppedCeiling(node.cell))
    const queue: TrunkNode[] = []
    for (const node of trunks) {
      const face = HORIZONTAL_FACES.find(
        (f) => isDoorway(node.cell, f) && across(nodes, node, f)?.cell.module === 'spine',
      )
      if (!face) continue
      flows.set(refKey(node.ref), { out: face, in: [] })
      queue.push(node)
    }
    while (queue.length > 0) {
      const node = queue.shift()!
      for (const face of HORIZONTAL_FACES) {
        if (!isDoorway(node.cell, face)) continue
        const next = across(trunks, node, face)
        if (!next || flows.has(refKey(next.ref))) continue
        flows.set(refKey(next.ref), { out: OPPOSITE[face], in: [] })
        flows.get(refKey(node.ref))!.in.push(face)
        queue.push(next)
      }
    }
  }
  return flows
}

function refKey(ref: CellRef): string {
  return `${ref.levelId}|${ref.bayKey}|${ref.cellIndex}`
}

/** The interior columns, as `"x,z"`, right inside each open wall face. */
function openingColumns(cell: Cell, interior: AABB): DetailContext['openings'] {
  const out: DetailContext['openings'] = {}
  for (const face of HORIZONTAL_FACES) {
    const eastWest = face === 'e' || face === 'w'
    const cross: [number, number] = eastWest ? [interior.z0, interior.z1] : [interior.x0, interior.x1]
    const span = horizontalOpeningSpan(cell.sockets[face], cross, cell.openingWidths?.[face])
    if (!span) continue
    const row = face === 'n' ? interior.z0 : face === 's' ? interior.z1 : face === 'w' ? interior.x0 : interior.x1
    const columns = new Set<string>()
    for (let c = span[0]; c <= span[1]; c++) columns.add(eastWest ? `${row},${c}` : `${c},${row}`)
    out[face] = columns
  }
  return out
}

interface MergeBlockMember {
  ref: CellRef
  level: Level
  bay: Bay
  cell: Cell
  u: number
  v: number
}

/** Every merge group in the project, with its members placed on the cell lattice. */
function mergeGroupMembers(project: Project): Map<string, MergeBlockMember[]> {
  const groups = new Map<string, MergeBlockMember[]>()
  for (const ref of allCellRefs(project)) {
    const { level, bay, cell, a, b } = resolveCell(project, ref)
    if (!cell.mergeGroup) continue
    const { i, j } = parseBayKey(ref.bayKey)
    const n = GRAIN_AXIS_CELLS[bay.grain]
    const member = { ref, level, bay, cell, u: i * n + a, v: j * n + b }
    const existing = groups.get(cell.mergeGroup)
    if (existing) existing.push(member)
    else groups.set(cell.mergeGroup, [member])
  }
  return groups
}

/**
 * Do these members really form one room? Same level, same grain, same height,
 * same ceiling, and a filled rectangle — the V7 conditions, which is the point:
 * only a group that passes them gets its shared walls carved away below.
 */
function isOneRoom(members: MergeBlockMember[]): boolean {
  const first = members[0]
  if (!first || members.length < 2) return false
  if (
    members.some(
      (member) =>
        member.level.id !== first.level.id ||
        member.bay.grain !== first.bay.grain ||
        member.cell.heightCells !== first.cell.heightCells ||
        member.cell.ceiling !== first.cell.ceiling,
    )
  ) {
    return false
  }

  const us = members.map((member) => member.u)
  const vs = members.map((member) => member.v)
  const width = Math.max(...us) - Math.min(...us) + 1
  const height = Math.max(...vs) - Math.min(...vs) + 1
  const positions = new Set(members.map((member) => `${member.u},${member.v}`))
  return positions.size === members.length && width * height === members.length
}

/**
 * The merge groups whose shared walls `resolveBlocks` actually removes.
 *
 * Validation needs this: two cells in one of these groups are a single room in
 * the export, so reachability rules must treat the seam as open even though the
 * cells kept their default `solid` sockets.
 */
export function validMergeGroupIds(project: Project): Set<string> {
  const valid = new Set<string>()
  for (const [groupId, members] of mergeGroupMembers(project)) {
    if (isOneRoom(members)) valid.add(groupId)
  }
  return valid
}

/** Remove only vertical shell blocks strictly inside a valid merged rectangle. */
function carveValidMergeGroups(project: Project, blocks: Map<string, string>): void {
  for (const members of mergeGroupMembers(project).values()) {
    if (!isOneRoom(members)) continue
    const first = members[0]!

    const boxes = members.map((member) => cellAABB(project, member.ref))
    const x0 = Math.min(...boxes.map((box) => box.x0))
    const x1 = Math.max(...boxes.map((box) => box.x1))
    const z0 = Math.min(...boxes.map((box) => box.z0))
    const z1 = Math.max(...boxes.map((box) => box.z1))
    const y0 = boxes[0]!.y0
    const y1 = boxes[0]!.y1
    const dropped = droppedCeilingY(first.level, first.cell)

    for (let y = y0 + 1; y < y1; y++) {
      if (y === dropped) continue
      for (let z = z0 + 1; z < z1; z++) {
        for (let x = x0 + 1; x < x1; x++) blocks.delete(blockKey(x, y, z))
      }
    }
  }
}

// --------------------------------------------------------------------------
// Sockets (§5.4)
// --------------------------------------------------------------------------

const HORIZONTAL_FACES = ['n', 'e', 's', 'w'] as const

/**
 * The boundary-plane coordinates a cell's own sockets turn to air. A wall
 * point is missing from {@link shellBlocks} exactly when it is in this set,
 * and missing from {@link resolveBlocks} when every cell sharing it voids it
 * (or a valid merge group carves it).
 */
export function socketVoids(project: Project, ref: CellRef): ReadonlySet<string> {
  const { cell } = resolveCell(project, ref)
  return socketOpenings(
    cellAABB(project, ref),
    cellInterior(project, ref),
    cellPlenum(project, ref),
    cell.sockets,
    cell.openingWidths,
    shaftWells(project, ref),
  ).voids
}

/** The columns, as `"x,z"`, each shaft opens. Null opens the whole interior footprint. */
interface ShaftWells {
  up: ReadonlySet<string> | null
  down: ReadonlySet<string> | null
}

/**
 * A stair room's shaft opens only the well its climb passes through, so the
 * landing keeps the rest of its floor. The landing's own shaft opens the
 * wells of the stairs that climb into it. Any other shaft, or a landing over
 * a room with no climb, opens the whole footprint.
 */
function shaftWells(project: Project, ref: CellRef): ShaftWells {
  const { cell } = resolveCell(project, ref)
  const wells: ShaftWells = { up: null, down: null }
  if (cell.sockets.up === 'shaft') wells.up = stairWell(cell, cellInterior(project, ref), cellPlenum(project, ref))
  if (cell.sockets.down !== 'shaft') return wells

  const outer = cellAABB(project, ref)
  const below = builtCellRefs(project).filter((other) => {
    if (other.bayKey !== ref.bayKey || other.levelId === ref.levelId) return false
    const box = cellAABB(project, other)
    return box.y1 === outer.y0 && footprintsOverlap(box, outer) && resolveCell(project, other).cell.sockets.up === 'shaft'
  })
  const climbs = below.map((other) => stairWell(resolveCell(project, other).cell, cellInterior(project, other), cellPlenum(project, other)))
  if (climbs.length > 0 && climbs.every((well) => well !== null)) wells.down = new Set(climbs.flatMap((well) => [...well!]))
  return wells
}

/**
 * Carve socket openings out of the boundary planes.
 *
 * `voids` are coordinates that become air. `bars` are coordinates that become
 * iron bars — visually open, still a block, so they are emitted rather than
 * skipped. A solid neighbour re-fills either of them in {@link resolveBlocks},
 * which is exactly the §5.4 rule that both sides must open for a connection.
 */
function socketOpenings(
  outer: AABB,
  interior: AABB,
  plenum: AABB | null,
  sockets: Record<Face, Socket>,
  openingWidths: Partial<Record<Face, OpeningWidth>> = {},
  wells: ShaftWells = { up: null, down: null },
): { voids: Set<string>; bars: Set<string> } {
  const voids = new Set<string>()
  const bars = new Set<string>()

  for (const face of HORIZONTAL_FACES) {
    const socket = sockets[face]
    if (socket === 'solid' || socket === 'shaft') continue
    const target = socket === 'bars' ? bars : voids
    const eastWest = face === 'e' || face === 'w'
    const crossSpan = horizontalOpeningSpan(
      socket,
      eastWest ? [interior.z0, interior.z1] : [interior.x0, interior.x1],
      openingWidths[face],
    )
    if (!crossSpan) continue
    const [cLo, cHi] = crossSpan
    const plane = face === 'e' ? outer.x1 : face === 'w' ? outer.x0 : face === 'n' ? outer.z0 : outer.z1
    addHorizontalOpening(target, plane, eastWest, cLo, cHi, openingYSpan(socket, interior))

    if (plenum && socket !== 'bars') {
      const ySpan: [number, number] =
        socket === 'window'
          ? [midpoint(plenum.y0, plenum.y1), midpoint(plenum.y0, plenum.y1)]
          : [plenum.y0, plenum.y1]
      addHorizontalOpening(target, plane, eastWest, cLo, cHi, ySpan)
    }
  }

  // §5.4: `shaft` is the only socket that opens a horizontal plane. It opens
  // the full interior footprint, or a stair's well within it.
  for (const face of ['up', 'down'] as const) {
    if (sockets[face] !== 'shaft') continue
    const y = face === 'up' ? outer.y1 : outer.y0
    const well = wells[face]
    for (let z = interior.z0; z <= interior.z1; z++) {
      for (let x = interior.x0; x <= interior.x1; x++) {
        if (!well || well.has(`${x},${z}`)) voids.add(blockKey(x, y, z))
      }
    }
  }

  return { voids, bars }
}

function addHorizontalOpening(
  target: Set<string>,
  plane: number,
  eastWest: boolean,
  cLo: number,
  cHi: number,
  [yLo, yHi]: [number, number],
): void {
  for (let y = yLo; y <= yHi; y++) {
    for (let c = cLo; c <= cHi; c++) {
      target.add(eastWest ? blockKey(plane, y, c) : blockKey(c, y, plane))
    }
  }
}

/** The heights a horizontal opening clears, empty when the socket is closed. */
export function openingYSpan(socket: Socket, interior: AABB): [number, number] {
  switch (socket) {
    case 'corridor':
    case 'bars':
      return [interior.y0, interior.y1]
    case 'arch':
      return [interior.y0, Math.min(interior.y0 + 1, interior.y1)]
    case 'window': {
      const mid = midpoint(interior.y0, interior.y1)
      return [mid, mid]
    }
    default:
      return [interior.y0, interior.y0 - 1] // empty span
  }
}

export function horizontalOpeningSpan(
  socket: Socket,
  span: [number, number],
  openingWidth: OpeningWidth = 'full',
): [number, number] | null {
  if (socket === 'solid' || socket === 'shaft') return null
  if (socket === 'window') {
    const mid = midpoint(span[0], span[1])
    return [mid, mid]
  }
  if (openingWidth === 'full') return span
  const available = span[1] - span[0] + 1
  if (openingWidth > available) {
    throw new RangeError(`opening width ${openingWidth} exceeds the ${available}-block cell interior`)
  }
  const lo = span[0] + Math.floor((available - openingWidth) / 2)
  return [lo, lo + openingWidth - 1]
}

/** Interior spans are always odd (3, 5 or 11 wide), so the centre is exact. */
function midpoint(lo: number, hi: number): number {
  return lo + Math.floor((hi - lo) / 2)
}

// --------------------------------------------------------------------------
// Shared helpers
// --------------------------------------------------------------------------

export function blockKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`
}

export function parseBlockKey(key: string): { x: number; y: number; z: number } {
  const [x, y, z] = key.split(',').map(Number)
  if (x === undefined || y === undefined || z === undefined || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    throw new Error(`malformed block key '${key}'`)
  }
  return { x, y, z }
}

export function contains(box: AABB, x: number, y: number, z: number): boolean {
  return x >= box.x0 && x <= box.x1 && y >= box.y0 && y <= box.y1 && z >= box.z0 && z <= box.z1
}

/** Inclusive block volume of a box. */
export function volume(box: AABB): number {
  return (box.x1 - box.x0 + 1) * (box.y1 - box.y0 + 1) * (box.z1 - box.z0 + 1)
}

/**
 * Do two cell footprints overlap in x/z? Strict, so bays that merely share a
 * wall plane do not count as overlapping.
 */
export function footprintsOverlap(a: AABB, b: AABB): boolean {
  return a.x1 > b.x0 && b.x1 > a.x0 && a.z1 > b.z0 && b.z1 > a.z0
}

/**
 * Do two y intervals collide? Strict, per §8 V1 — two levels touching at
 * exactly one shared plane is legal and expected.
 */
export function yIntervalsCollide(a: AABB, b: AABB): boolean {
  return a.y1 > b.y0 && b.y1 > a.y0
}

function planeRole(y: number, outer: AABB, droppedY: number | null): ShellRole {
  if (y === outer.y0) return 'floor'
  if (y === outer.y1) return 'ceiling'
  if (droppedY !== null && y === droppedY) return 'ceiling'
  return 'wall'
}

/** §5.5 — palette resolves per level, overridable per cell. */
export function paletteFor(project: Project, level: Level, cell: Cell): Palette {
  const id = cell.paletteOverride ?? level.paletteId
  const palette = project.palettes[id] ?? PALETTES[id]
  if (!palette) throw new Error(`no palette '${id}' in project '${project.id}'`)
  return palette
}

function blockForRole(role: ShellRole, palette: Palette): string {
  if (role === 'bars') {
    const bars = SOCKET_BLOCKS['bars']
    if (!bars) throw new Error('no block defined for the bars socket')
    return bars
  }
  return palette.blocks[role]
}

/**
 * Exact serialized content key for block-cache invalidation. Key reordering
 * produces a different key and therefore a harmless recompute.
 */
export function hashProject(project: Project): string {
  return JSON.stringify(project)
}
