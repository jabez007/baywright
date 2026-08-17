/**
 * PRD §8 — Validation rules. All seven implemented.
 *
 * Pure: no Vue, no store, no I/O.
 */
import {
  allCellRefs,
  bayKeyOf,
  cellAABB,
  cellAxisIndices,
  cellIndexOf,
  cellInterior,
  cellPlenum,
  footprintsOverlap,
  parseBayKey,
  resolveCell,
  sortedLevels,
  yIntervalsCollide,
} from './geometry.js'
import { SPINE_MODULE_ID } from './modules.js'
import {
  GRAIN_AXIS_CELLS,
  LEVEL_PITCH,
  type AABB,
  type Bay,
  type Cell,
  type CellRef,
  type Face,
  type Grain,
  type Level,
  type Project,
  type Socket,
} from './types.js'

export type Severity = 'error' | 'warning'

export type IssueId = 'V1' | 'V2' | 'V3' | 'V4' | 'V5' | 'V6' | 'V7'

export interface Issue {
  id: IssueId
  severity: Severity
  message: string
  /** The cells involved, so the UI can highlight them. */
  refs: CellRef[]
  /** Set for issues about a level as a whole, which have no cells to point at. */
  levelId?: string
}

export function validate(project: Project): Issue[] {
  return [
    ...checkVerticalCollisions(project),
    ...checkGrainSeams(project),
    ...checkConnectivity(project),
    ...checkStairContinuity(project),
    ...checkPlenumReachability(project),
    ...checkLevelAlignment(project),
    ...checkMergeGroups(project),
  ]
}

// --------------------------------------------------------------------------
// V1 — Vertical collision (error)
// --------------------------------------------------------------------------

/**
 * Cells on different levels whose x/z footprints overlap must not overlap in y.
 * Touching at exactly one shared plane is legal, hence the strict comparison.
 *
 * Bucketed by bay key first: distinct bays only ever share a wall plane, so
 * cells in different bays can never overlap in footprint.
 */
export function checkVerticalCollisions(project: Project): Issue[] {
  const issues: Issue[] = []
  const levels = sortedLevels(project)

  for (let lower = 0; lower < levels.length; lower++) {
    for (let upper = lower + 1; upper < levels.length; upper++) {
      const below = levels[lower]!
      const above = levels[upper]!
      for (const bayKey of Object.keys(below.bays).sort()) {
        const belowBay = below.bays[bayKey]
        const aboveBay = above.bays[bayKey]
        if (!belowBay || !aboveBay) continue

        for (let i = 0; i < belowBay.cells.length; i++) {
          const belowRef: CellRef = { levelId: below.id, bayKey, cellIndex: i }
          const belowBox = cellAABB(project, belowRef)
          for (let j = 0; j < aboveBay.cells.length; j++) {
            const aboveRef: CellRef = { levelId: above.id, bayKey, cellIndex: j }
            const aboveBox = cellAABB(project, aboveRef)
            if (!footprintsOverlap(belowBox, aboveBox)) continue
            if (!yIntervalsCollide(belowBox, aboveBox)) continue
            issues.push({
              id: 'V1',
              severity: 'error',
              message:
                `${bayKey} vault at y ${belowBox.y0} reaches y ${belowBox.y1} — ` +
                `collides with level '${above.name}' at y ${aboveBox.y0}`,
              refs: [belowRef, aboveRef],
            })
          }
        }
      }
    }
  }
  return issues
}

// --------------------------------------------------------------------------
// V2 — Grain seam (error)
// --------------------------------------------------------------------------

/** Sockets narrow enough to survive the 1-block overlap at a fine/coarse seam. */
const SEAM_SAFE_SOCKETS: ReadonlySet<Socket> = new Set<Socket>(['solid', 'window'])

interface SeamDirection {
  face: Extract<Face, 'n' | 'e' | 's' | 'w'>
  di: number
  dj: number
  /** Which axis the fine bay's edge cells vary along on this face. */
  axis: 'a' | 'b'
  /** The fine bay's edge index on the fixed axis. */
  edge: 0 | 2
}

const SEAM_DIRECTIONS: readonly SeamDirection[] = [
  { face: 'e', di: 1, dj: 0, axis: 'b', edge: 2 },
  { face: 'w', di: -1, dj: 0, axis: 'b', edge: 0 },
  { face: 's', di: 0, dj: 1, axis: 'a', edge: 2 },
  { face: 'n', di: 0, dj: -1, axis: 'a', edge: 0 },
]

/**
 * At a fine/coarse seam the two outer fine cells line up with the two coarse
 * cells (spans 1..3 and 9..11 sit inside 1..5 and 7..11), but the middle fine
 * cell (5..7) overlaps each coarse partner by a single block. So it may carry
 * at most a `window`.
 *
 * Fine-to-fine and coarse-to-coarse always align, and `merged` spans 1..11,
 * which contains every fine and coarse span — the universal adapter.
 */
export function checkGrainSeams(project: Project): Issue[] {
  const issues: Issue[] = []

  for (const level of sortedLevels(project)) {
    for (const bayKey of Object.keys(level.bays).sort()) {
      const bay = level.bays[bayKey]
      if (!bay || bay.grain !== 'fine') continue
      const { i, j } = parseBayKey(bayKey)

      for (const dir of SEAM_DIRECTIONS) {
        const neighbourKey = neighbourBayKey(i, j, dir.di, dir.dj)
        if (!neighbourKey) continue
        const neighbour = level.bays[neighbourKey]
        if (!neighbour || neighbour.grain !== 'coarse') continue

        const middleIndex = dir.axis === 'b' ? cellIndexOf('fine', dir.edge, 1) : cellIndexOf('fine', 1, dir.edge)
        const cell = bay.cells[middleIndex]
        if (!cell) continue
        const socket = cell.sockets[dir.face]
        if (SEAM_SAFE_SOCKETS.has(socket)) continue

        issues.push({
          id: 'V2',
          severity: 'error',
          message:
            `${bayKey} cell ${middleIndex} carries a '${socket}' onto the fine/coarse seam with ${neighbourKey} — ` +
            `the middle fine cell overlaps each coarse cell by 1 block, so only a window fits ` +
            `(convert ${bayKey} or ${neighbourKey} to merged grain to adapt)`,
          refs: [
            { levelId: level.id, bayKey, cellIndex: middleIndex },
            ...coarseSeamRefs(level, neighbourKey, dir),
          ],
        })
      }
    }
  }
  return issues
}

/** The two coarse cells sitting against the seam, for UI highlighting. */
function coarseSeamRefs(level: Level, bayKey: string, dir: SeamDirection): CellRef[] {
  // The coarse bay's edge is the mirror of the fine bay's edge.
  const edge = dir.edge === 2 ? 0 : GRAIN_AXIS_CELLS.coarse - 1
  const refs: CellRef[] = []
  for (let k = 0; k < GRAIN_AXIS_CELLS.coarse; k++) {
    const cellIndex = dir.axis === 'b' ? cellIndexOf('coarse', edge, k) : cellIndexOf('coarse', k, edge)
    refs.push({ levelId: level.id, bayKey, cellIndex })
  }
  return refs
}

function neighbourBayKey(i: number, j: number, di: number, dj: number): string | null {
  const ni = i + di
  const nj = j + dj
  if (ni < 0 || nj < 0) return null
  return bayKeyOf(ni, nj)
}

// --------------------------------------------------------------------------
// V4 — Stair continuity (error)
// --------------------------------------------------------------------------

/**
 * A cell with `sockets.up === 'shaft'` needs the cell directly above it to have
 * `sockets.down === 'shaft'`, and the y-delta between the two levels must equal
 * `4 * heightCells` of the lower cell.
 *
 * A shaft with no level above it is not reported — it is a roof exit, not a
 * broken stair.
 */
export function checkStairContinuity(project: Project): Issue[] {
  const issues: Issue[] = []
  const levels = sortedLevels(project)

  for (let index = 0; index < levels.length - 1; index++) {
    const below = levels[index]!
    const above = levels[index + 1]!
    const delta = above.y - below.y

    for (const bayKey of Object.keys(below.bays).sort()) {
      const belowBay = below.bays[bayKey]
      const aboveBay = above.bays[bayKey]
      if (!belowBay) continue

      for (let i = 0; i < belowBay.cells.length; i++) {
        const cell = belowBay.cells[i]!
        if (cell.sockets.up !== 'shaft') continue
        const belowRef: CellRef = { levelId: below.id, bayKey, cellIndex: i }
        const rise = LEVEL_PITCH * cell.heightCells
        if (!aboveBay) continue
        const belowBox = cellAABB(project, belowRef)

        for (let j = 0; j < aboveBay.cells.length; j++) {
          const aboveRef: CellRef = { levelId: above.id, bayKey, cellIndex: j }
          if (!footprintsOverlap(belowBox, cellAABB(project, aboveRef))) continue
          const aboveCell = resolveCell(project, aboveRef).cell

          if (aboveCell.sockets.down !== 'shaft') {
            issues.push({
              id: 'V4',
              severity: 'error',
              message: `Stair at ${bayKey} rises into level '${above.name}' but cell ${j} above it has no shaft`,
              refs: [belowRef, aboveRef],
            })
          } else if (delta !== rise) {
            issues.push({
              id: 'V4',
              severity: 'error',
              message: `Stair at ${bayKey} rises ${rise} but the level above is ${delta} higher`,
              refs: [belowRef, aboveRef],
            })
          }
        }
      }
    }
  }
  return issues
}

// --------------------------------------------------------------------------
// The cell adjacency graph, shared by V3 and V5
// --------------------------------------------------------------------------

interface CellNode {
  key: string
  ref: CellRef
  level: Level
  bay: Bay
  cell: Cell
  outer: AABB
  interior: AABB
  plenum: AABB | null
}

/** One shared face between two cells, with the face each of them sees it through. */
interface Adjacency {
  a: string
  b: string
  faceA: Face
  faceB: Face
  vertical: boolean
}

export function cellRefKey(ref: CellRef): string {
  return `${ref.levelId}|${ref.bayKey}|${ref.cellIndex}`
}

function buildCellNodes(project: Project): CellNode[] {
  return allCellRefs(project).map((ref) => {
    const { level, bay, cell } = resolveCell(project, ref)
    return {
      key: cellRefKey(ref),
      ref,
      level,
      bay,
      cell,
      outer: cellAABB(project, ref),
      interior: cellInterior(project, ref),
      plenum: cellPlenum(project, ref),
    }
  })
}

/**
 * Which cells physically share a face. Two cells share one when the outer box
 * of one ends exactly where the other begins and their interiors overlap along
 * the remaining axes — which covers cells inside a bay, cells across a bay
 * seam, and cells stacked between levels, all with the same test.
 *
 * Sockets are not consulted here; the callers apply their own opening rules.
 */
function buildAdjacencies(nodes: CellNode[]): Adjacency[] {
  const adjacencies: Adjacency[] = []

  const byLevel = new Map<string, CellNode[]>()
  for (const node of nodes) push(byLevel, node.ref.levelId, node)

  for (const group of byLevel.values()) {
    const byX0 = new Map<number, CellNode[]>()
    const byZ0 = new Map<number, CellNode[]>()
    for (const node of group) {
      push(byX0, node.outer.x0, node)
      push(byZ0, node.outer.z0, node)
    }
    for (const node of group) {
      for (const other of byX0.get(node.outer.x1) ?? []) {
        if (!spansOverlap(node.interior.z0, node.interior.z1, other.interior.z0, other.interior.z1)) continue
        adjacencies.push({ a: node.key, b: other.key, faceA: 'e', faceB: 'w', vertical: false })
      }
      for (const other of byZ0.get(node.outer.z1) ?? []) {
        if (!spansOverlap(node.interior.x0, node.interior.x1, other.interior.x0, other.interior.x1)) continue
        adjacencies.push({ a: node.key, b: other.key, faceA: 's', faceB: 'n', vertical: false })
      }
    }
  }

  // Vertical: the lower cell's ceiling plane is the upper cell's floor plane.
  const byFloorY = new Map<number, CellNode[]>()
  for (const node of nodes) push(byFloorY, node.outer.y0, node)
  for (const node of nodes) {
    for (const other of byFloorY.get(node.outer.y1) ?? []) {
      if (other.ref.levelId === node.ref.levelId) continue
      if (!spansOverlap(node.interior.x0, node.interior.x1, other.interior.x0, other.interior.x1)) continue
      if (!spansOverlap(node.interior.z0, node.interior.z1, other.interior.z0, other.interior.z1)) continue
      adjacencies.push({ a: node.key, b: other.key, faceA: 'up', faceB: 'down', vertical: true })
    }
  }

  return adjacencies
}

/** §5.4 — a face is passable unless it is closed or merely glazed. */
function isOpenSocket(socket: Socket): boolean {
  return socket !== 'solid' && socket !== 'window'
}

// --------------------------------------------------------------------------
// V3 — Connectivity (warning)
// --------------------------------------------------------------------------

/**
 * Flood-fill the socket graph from every `spine` cell and report whatever it
 * never reaches. A warning rather than an error, because intentionally sealed
 * secret rooms are a legitimate design.
 *
 * A project with no spine at all is skipped entirely: with no anchor to fill
 * from, every cell would be reported, which is noise rather than a finding.
 */
export function checkConnectivity(project: Project): Issue[] {
  const nodes = buildCellNodes(project)
  const spines = nodes.filter((node) => node.cell.module === SPINE_MODULE_ID)
  if (spines.length === 0) return []

  const byKey = new Map(nodes.map((node) => [node.key, node]))
  const graph = new Map<string, string[]>()
  for (const link of buildAdjacencies(nodes)) {
    const a = byKey.get(link.a)
    const b = byKey.get(link.b)
    if (!a || !b) continue
    if (!isOpenSocket(a.cell.sockets[link.faceA])) continue
    if (!isOpenSocket(b.cell.sockets[link.faceB])) continue
    push(graph, a.key, b.key)
    push(graph, b.key, a.key)
  }

  const reached = floodFill(
    spines.map((node) => node.key),
    graph,
  )

  return nodes
    .filter((node) => !reached.has(node.key))
    .map((node) => ({
      id: 'V3' as const,
      severity: 'warning' as const,
      message: `${node.ref.bayKey} cell ${node.ref.cellIndex} has no path to a spine`,
      refs: [node.ref],
    }))
}

// --------------------------------------------------------------------------
// V5 — Plenum reachability (warning)
// --------------------------------------------------------------------------

/**
 * Per level, connect plenum volumes that sit against each other through a wall
 * that is not solid, then flood-fill from every plenum next to a spine cell.
 * A hopper trunk in a disconnected island has nowhere to terminate.
 *
 * §8 words the wall test as "not `solid`" — looser than the §5.4 connectivity
 * rule, so a `window` counts here. That is deliberate: this is the same wall
 * plane the room below shares, and the plenum is carved above the room, so any
 * non-solid face marks a wall the builder intended to run services through.
 *
 * Levels with no spine are skipped, for the same reason V3 skips a spineless
 * project. A level that has a spine but no plenum touching it reports every
 * island, which is the honest answer: nothing can reach the trunk.
 */
export function checkPlenumReachability(project: Project): Issue[] {
  const issues: Issue[] = []
  const nodes = buildCellNodes(project)
  const byKey = new Map(nodes.map((node) => [node.key, node]))
  const adjacencies = buildAdjacencies(nodes).filter((link) => !link.vertical)

  for (const level of sortedLevels(project)) {
    const onLevel = nodes.filter((node) => node.ref.levelId === level.id)
    const plenums = onLevel.filter((node) => node.plenum !== null)
    if (plenums.length === 0) continue
    if (!onLevel.some((node) => node.cell.module === SPINE_MODULE_ID)) continue

    const plenumKeys = new Set(plenums.map((node) => node.key))
    const graph = new Map<string, string[]>()
    const anchors = new Set<string>()

    for (const link of adjacencies) {
      const a = byKey.get(link.a)
      const b = byKey.get(link.b)
      if (!a || !b || a.ref.levelId !== level.id || b.ref.levelId !== level.id) continue

      // A plenum next to a spine cell is where the trunk terminates.
      if (plenumKeys.has(a.key) && b.cell.module === SPINE_MODULE_ID) anchors.add(a.key)
      if (plenumKeys.has(b.key) && a.cell.module === SPINE_MODULE_ID) anchors.add(b.key)

      if (!plenumKeys.has(a.key) || !plenumKeys.has(b.key)) continue
      if (a.cell.sockets[link.faceA] === 'solid' || b.cell.sockets[link.faceB] === 'solid') continue
      if (!a.plenum || !b.plenum || !spansOverlap(a.plenum.y0, a.plenum.y1, b.plenum.y0, b.plenum.y1)) continue
      push(graph, a.key, b.key)
      push(graph, b.key, a.key)
    }

    for (const node of plenums) {
      if (node.cell.module === SPINE_MODULE_ID) anchors.add(node.key)
    }

    for (const island of connectedComponents(plenums.map((node) => node.key), graph)) {
      if (island.some((key) => anchors.has(key))) continue
      const refs = island.map((key) => byKey.get(key)!.ref)
      const first = refs[0]!
      issues.push({
        id: 'V5',
        severity: 'warning',
        message:
          `Plenum island of ${island.length} cell${island.length === 1 ? '' : 's'} starting at ` +
          `${first.bayKey} cell ${first.cellIndex} has no route to a spine`,
        refs,
        levelId: level.id,
      })
    }
  }

  return issues
}

// --------------------------------------------------------------------------
// V6 — Level y alignment (error)
// --------------------------------------------------------------------------

/**
 * Should be prevented at the store level, but validate defensively on import.
 */
export function checkLevelAlignment(project: Project): Issue[] {
  const issues: Issue[] = []
  for (const level of sortedLevels(project)) {
    if (Number.isInteger(level.y) && level.y % LEVEL_PITCH === 0) continue
    issues.push({
      id: 'V6',
      severity: 'error',
      message: `Level '${level.name}' sits at y ${level.y}, which is not a multiple of ${LEVEL_PITCH}`,
      refs: [],
      levelId: level.id,
    })
  }
  return issues
}

// --------------------------------------------------------------------------
// V7 — Merge group integrity (error)
// --------------------------------------------------------------------------

interface GroupMember {
  ref: CellRef
  level: Level
  grain: Grain
  cell: Cell
}

/**
 * Cells that render and export as one room must actually be one room: same
 * level, same grain, same height, same ceiling, and a filled rectangle.
 */
export function checkMergeGroups(project: Project): Issue[] {
  const issues: Issue[] = []
  const groups = new Map<string, GroupMember[]>()

  for (const ref of allCellRefs(project)) {
    const { level, bay, cell } = resolveCell(project, ref)
    if (!cell.mergeGroup) continue
    push(groups, cell.mergeGroup, { ref, level, grain: bay.grain, cell })
  }

  for (const groupId of [...groups.keys()].sort()) {
    const members = groups.get(groupId)!
    const refs = members.map((member) => member.ref)
    const report = (message: string) => issues.push({ id: 'V7', severity: 'error', message, refs })

    const levelIds = distinct(members.map((member) => member.level.id))
    const grains = distinct(members.map((member) => member.grain))
    const heights = distinct(members.map((member) => String(member.cell.heightCells)))
    const ceilings = distinct(members.map((member) => member.cell.ceiling))

    if (levelIds.length > 1) report(`Merge group '${groupId}' spans levels ${levelIds.join(', ')} — a merge group is one room on one level`)
    if (grains.length > 1) report(`Merge group '${groupId}' mixes ${grains.join(' and ')} grain — merged cells must share a grain`)
    if (heights.length > 1) report(`Merge group '${groupId}' mixes heightCells ${heights.join(' and ')} — merged cells must share a height`)
    if (ceilings.length > 1) report(`Merge group '${groupId}' mixes ${ceilings.join(' and ')} ceilings — merged cells must share a ceiling`)

    // A rectangle is only meaningful once the group sits on one level at one
    // grain, since that is what makes the cell lattice uniform.
    if (levelIds.length > 1 || grains.length > 1) continue
    if (!isFilledRectangle(members)) {
      report(`Merge group '${groupId}' is not a contiguous rectangle`)
    }
  }

  return issues
}

/** Do the members tile a full rectangle of the level's cell lattice? */
function isFilledRectangle(members: GroupMember[]): boolean {
  const grain = members[0]?.grain
  if (!grain) return true
  const n = GRAIN_AXIS_CELLS[grain]
  const us: number[] = []
  const vs: number[] = []
  for (const member of members) {
    const { i, j } = parseBayKey(member.ref.bayKey)
    const { a, b } = cellAxisIndices(grain, member.ref.cellIndex)
    us.push(i * n + a)
    vs.push(j * n + b)
  }
  const width = Math.max(...us) - Math.min(...us) + 1
  const height = Math.max(...vs) - Math.min(...vs) + 1
  // Refs are unique, so a matching area means every slot is filled exactly once.
  return width * height === members.length
}

// --------------------------------------------------------------------------
// Graph and collection helpers
// --------------------------------------------------------------------------

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const existing = map.get(key)
  if (existing) existing.push(value)
  else map.set(key, [value])
}

function distinct(values: string[]): string[] {
  return [...new Set(values)].sort()
}

/** Inclusive block ranges overlap by at least one block. */
function spansOverlap(a0: number, a1: number, b0: number, b1: number): boolean {
  return a0 <= b1 && b0 <= a1
}

function floodFill(starts: string[], graph: Map<string, string[]>): Set<string> {
  const seen = new Set<string>(starts)
  const queue = [...starts]
  while (queue.length > 0) {
    const key = queue.pop()!
    for (const next of graph.get(key) ?? []) {
      if (seen.has(next)) continue
      seen.add(next)
      queue.push(next)
    }
  }
  return seen
}

/** Components in input order, so issue output is stable. */
function connectedComponents(keys: string[], graph: Map<string, string[]>): string[][] {
  const pool = new Set(keys)
  const seen = new Set<string>()
  const components: string[][] = []
  for (const key of keys) {
    if (seen.has(key)) continue
    const reached = floodFill([key], graph)
    for (const member of reached) seen.add(member)
    components.push(keys.filter((candidate) => reached.has(candidate) && pool.has(candidate)))
  }
  return components
}
