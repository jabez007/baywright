/**
 * PRD §7 — Geometry resolver.
 *
 * Pure and side-effect free. No Vue imports, no store imports. Every world
 * coordinate in the app is derived here, so the exporter and the renderer are
 * both functions of this one module.
 */
import { PALETTES, SOCKET_BLOCKS } from './palettes.js'
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
  const { voids, bars } = socketOpenings(outer, interior, plenum, cell.sockets)

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
  const serialized = hashProject(project)
  const hit = blockCache.get(project)
  if (hit && hit.serialized === serialized) return new Map(hit.blocks)
  const blocks = computeBlocks(project)
  blockCache.set(project, { serialized, blocks })
  return new Map(blocks)
}

const blockCache = new WeakMap<Project, { serialized: string; blocks: Map<string, string> }>()

function computeBlocks(project: Project): Map<string, string> {
  const blocks = new Map<string, string>()
  const claimed = new Map<string, number>()
  for (const ref of allCellRefs(project)) {
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
  return blocks
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
): { voids: Set<string>; bars: Set<string> } {
  const voids = new Set<string>()
  const bars = new Set<string>()

  for (const face of HORIZONTAL_FACES) {
    const socket = sockets[face]
    if (socket === 'solid' || socket === 'shaft') continue
    const target = socket === 'bars' ? bars : voids
    const eastWest = face === 'e' || face === 'w'
    const [cLo, cHi] = openingCrossSpan(socket, eastWest ? [interior.z0, interior.z1] : [interior.x0, interior.x1])
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

  // §5.4: `shaft` is the only socket that opens a horizontal plane, and it
  // opens the full interior footprint.
  for (const face of ['up', 'down'] as const) {
    if (sockets[face] !== 'shaft') continue
    const y = face === 'up' ? outer.y1 : outer.y0
    for (let z = interior.z0; z <= interior.z1; z++) {
      for (let x = interior.x0; x <= interior.x1; x++) voids.add(blockKey(x, y, z))
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

function openingYSpan(socket: Socket, interior: AABB): [number, number] {
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

function openingCrossSpan(socket: Socket, span: [number, number]): [number, number] {
  if (socket !== 'window') return span
  const mid = midpoint(span[0], span[1])
  return [mid, mid]
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
