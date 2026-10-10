/**
 * Procedural assembly. The generator grows a seeded route through a footprint
 * on each level, joins the levels with the compact stair layout, and fills the
 * route with pieces from the bay pattern catalog. It writes ordinary bays and
 * named negative space into a copy of the project and runs the validators on
 * the copy, so a proposal can be previewed before anything changes.
 *
 * Pure: no Vue, no store, no I/O. The same project and request always give the
 * same proposal.
 */
import { bayOpenFaces, type HorizontalFace } from './connections.js'
import { bayKeyOf, parseBayKey, sortedLevels } from './geometry.js'
import { getLayoutPattern } from './layouts.js'
import { SPINE_MODULE_ID, cellFromModule } from './modules.js'
import { bayFromPattern, getBayPattern, type QuarterTurns } from './patterns.js'
import type { Bay, Level, NegativeSpaceKind, Project } from './types.js'
import { validate, type Issue } from './validate.js'

/**
 * Rooms the generator can place. A leaf room has one doorway and ends a
 * branch. A through room sits on a straight run and keeps it open.
 */
export interface AssemblyRoom {
  patternId: string
  shape: 'leaf' | 'through'
  /** Only on the lowest assembled level, because its floor opens downward. */
  lowestOnly?: boolean
}

export const ASSEMBLY_ROOMS: readonly AssemblyRoom[] = [
  { patternId: 'library-hall', shape: 'leaf' },
  { patternId: 'machine-hall', shape: 'leaf' },
  { patternId: 'mine-head', shape: 'leaf', lowestOnly: true },
  { patternId: 'side-chamber', shape: 'through' },
  { patternId: 'concealed-room', shape: 'through' },
]

export const MAX_ASSEMBLY_LEVELS = 4

/** The layout whose two pieces join one assembled level to the next. */
export const ASSEMBLY_STAIR_LAYOUT_ID = 'compact-stair-pair'

export interface AssemblyRequest {
  /** The lowest level. Higher levels sit one stair rise apart above it. */
  levelId: string
  /** The footprint's north-west bay. */
  anchorBayKey: string
  width: number
  height: number
  levelCount: number
  /** Room pattern ids from `ASSEMBLY_ROOMS`. Repeat an id to ask for more. */
  rooms: readonly string[]
  seed: number
}

export type AssemblyRole = 'spine' | 'passage' | 'room' | 'stair' | 'landing'

export interface AssembledBay {
  levelId: string
  bayKey: string
  patternId: string
  quarterTurns: QuarterTurns
  role: AssemblyRole
}

export interface AssemblyProposal {
  /** A copy of the project with the proposal written in. */
  project: Project
  bays: AssembledBay[]
  /** Requested rooms that found no free slot, in request order. */
  unplacedRooms: string[]
  issues: Issue[]
}

const FACES: readonly HorizontalFace[] = ['n', 'e', 's', 'w']

const STEP: Readonly<Record<HorizontalFace, { di: number; dj: number }>> = {
  n: { di: 0, dj: -1 },
  e: { di: 1, dj: 0 },
  s: { di: 0, dj: 1 },
  w: { di: -1, dj: 0 },
}

const OPPOSITE: Readonly<Record<HorizontalFace, HorizontalFace>> = { n: 's', e: 'w', s: 'n', w: 'e' }

/** One level's route: a tree of bays, plus any loop links added afterwards. */
interface Route {
  links: Map<string, Set<string>>
  /** The spine on the lowest level, the stair landing above it. */
  entry: string
  /** The bay whose stair climbs to the next level. */
  exit?: string
  /** Bays that take exactly one link: landings, stairs, and leaf rooms. */
  leaves: Set<string>
  rooms: Map<string, string>
}

export function assembleProposal(source: Project, request: AssemblyRequest): AssemblyProposal {
  checkRequest(source, request)
  const random = seededRandom(request.seed)
  const project = structuredClone(source)
  const stair = stairPieces()
  const footprint = footprintKeys(request)
  const base = project.levels.find((level) => level.id === request.levelId)!
  const levels = Array.from({ length: request.levelCount }, (_, k) => levelAt(project, base, base.y + stair.rise * k))

  // Grow every level's route first, so rooms can go wherever a slot is free.
  const routes: Route[] = []
  let available = footprint.filter((key) => !base.negativeSpaces?.[key])
  if (available.length === 0) throw new Error('The footprint is all named negative space, so there is nowhere to build')
  for (let k = 0; k < levels.length; k++) {
    const entry = k === 0 ? centralKey(available, random) : routes[k - 1]!.exit!
    const route = growRoute(available, entry, k > 0, targetSize(available.length, random), random)
    if (route.links.get(entry)!.size === 0) {
      throw new Error(`'${levels[k]!.name}' has only one open bay in the footprint, so no route can leave it`)
    }
    routes.push(route)
    if (k === levels.length - 1) break
    const above = levels[k + 1]!
    const climbable = (key: string) => !above.negativeSpaces?.[key]
    route.exit = chooseExit(route, available, climbable, random) ?? undefined
    if (!route.exit) throw new Error(`There is no room for a stair up from '${levels[k]!.name}' inside the footprint`)
    // Upper levels build only over bays the level below builds.
    available = [...route.links.keys()].filter(climbable).sort(compareKeys)
  }

  const unplacedRooms = placeRooms(request.rooms, routes, random)
  for (const route of routes) addLoops(route, random)

  const bays: AssembledBay[] = []
  for (let k = 0; k < levels.length; k++) {
    const level = levels[k]!
    const route = routes[k]!
    const below = k > 0 ? levels[k - 1]! : undefined
    for (const key of footprint) {
      if (level.negativeSpaces?.[key]) continue
      const links = route.links.get(key)
      if (!links) {
        delete level.bays[key]
        level.negativeSpaces ??= {}
        level.negativeSpaces[key] = { kind: voidKind(below, key) }
        continue
      }
      const faces = FACES.filter((face) => links.has(neighbourKey(key, face)))
      const role = roleOf(route, key, k)
      const patternId = pieceFor(role, route, key, faces, k === 0, stair, random)
      const { bay, quarterTurns } = oriented(patternId, faces)
      if (role === 'spine') makeSpine(bay)
      level.bays[key] = bay
      bays.push({ levelId: level.id, bayKey: key, patternId, quarterTurns, role })
    }
  }

  return { project, bays, unplacedRooms, issues: validate(project) }
}

function checkRequest(project: Project, request: AssemblyRequest): void {
  if (!project.levels.some((level) => level.id === request.levelId)) throw new Error(`no level '${request.levelId}'`)
  const { i, j } = parseBayKey(request.anchorBayKey)
  for (const [label, extent] of [['width', request.width], ['height', request.height]] as const) {
    if (!Number.isInteger(extent) || extent < 1) throw new RangeError(`footprint ${label} ${extent} is not a positive integer`)
  }
  if (i + request.width > project.bayCols || j + request.height > project.bayRows) {
    throw new RangeError(`a ${request.width}×${request.height} footprint at ${request.anchorBayKey} leaves the bay field`)
  }
  if (!Number.isInteger(request.levelCount) || request.levelCount < 1 || request.levelCount > MAX_ASSEMBLY_LEVELS) {
    throw new RangeError(`level count ${request.levelCount} must be 1 to ${MAX_ASSEMBLY_LEVELS}`)
  }
  for (const room of request.rooms) {
    if (!ASSEMBLY_ROOMS.some((entry) => entry.patternId === room)) throw new Error(`'${room}' is not an assembly room`)
  }
}

function stairPieces(): { up: string; landing: string; rise: number } {
  const layout = getLayoutPattern(ASSEMBLY_STAIR_LAYOUT_ID)!
  const up = layout.placements.find((placement) => !placement.dy)!
  const landing = layout.placements.find((placement) => placement.dy)!
  return { up: up.patternId, landing: landing.patternId, rise: landing.dy! }
}

function footprintKeys(request: AssemblyRequest): string[] {
  const { i, j } = parseBayKey(request.anchorBayKey)
  const keys: string[] = []
  for (let dj = 0; dj < request.height; dj++) {
    for (let di = 0; di < request.width; di++) keys.push(bayKeyOf(i + di, j + dj))
  }
  return keys
}

/** The level at `y`, added with a stable id when the project has none there. */
function levelAt(project: Project, base: Level, y: number): Level {
  const existing = project.levels.find((level) => level.y === y)
  if (existing) return existing
  let id = `assembled-${y}`
  for (let n = 2; project.levels.some((level) => level.id === id); n++) id = `assembled-${y}-${n}`
  const level: Level = { id, y, name: `Level ${y}`, paletteId: base.paletteId, bays: {} }
  project.levels.push(level)
  project.levels.splice(0, project.levels.length, ...sortedLevels(project))
  return level
}

/** Fill most of the available bays, at least two, and leave the rest open. */
function targetSize(available: number, random: () => number): number {
  return Math.max(2, Math.round(available * (0.6 + 0.25 * random())))
}

function centralKey(keys: readonly string[], random: () => number): string {
  const points = keys.map((key) => parseBayKey(key))
  const ci = points.reduce((sum, point) => sum + point.i, 0) / points.length
  const cj = points.reduce((sum, point) => sum + point.j, 0) / points.length
  const distances = points.map((point) => Math.abs(point.i - ci) + Math.abs(point.j - cj))
  const nearest = Math.min(...distances)
  return pick(random, keys.filter((_, index) => distances[index] === nearest))
}

/**
 * Randomised Prim's: link a random frontier bay to the route until it reaches
 * the target size. A landing is a leaf, so it links to one bay only.
 */
function growRoute(available: readonly string[], entry: string, entryIsLeaf: boolean, target: number, random: () => number): Route {
  const route: Route = {
    links: new Map([[entry, new Set()]]),
    entry,
    leaves: new Set(entryIsLeaf ? [entry] : []),
    rooms: new Map(),
  }
  const open = new Set(available)
  while (route.links.size < target) {
    const options = frontier(route, (key) => open.has(key))
    if (options.length === 0) break
    const [from, to] = pick(random, options)
    link(route, from, to)
  }
  return route
}

function frontier(route: Route, canAdd: (key: string) => boolean): Array<[string, string]> {
  const options: Array<[string, string]> = []
  for (const from of route.links.keys()) {
    if (route.leaves.has(from) && route.links.get(from)!.size > 0) continue
    for (const face of FACES) {
      const to = neighbourKey(from, face)
      if (!route.links.has(to) && canAdd(to)) options.push([from, to])
    }
  }
  return options
}

/**
 * The stair goes in the dead end farthest from the entry, so each level has to
 * be crossed to reach the next. With no usable dead end, grow a new one.
 */
function chooseExit(route: Route, available: readonly string[], climbable: (key: string) => boolean, random: () => number): string | null {
  const depth = distances(route)
  const leaves = [...route.links.keys()].filter((key) =>
    key !== route.entry && route.links.get(key)!.size === 1 && climbable(key))
  if (leaves.length > 0) {
    const deepest = Math.max(...leaves.map((key) => depth.get(key)!))
    const exit = pick(random, leaves.filter((key) => depth.get(key) === deepest))
    route.leaves.add(exit)
    return exit
  }
  const open = new Set(available)
  const options = frontier(route, (key) => open.has(key) && climbable(key))
  if (options.length === 0) return null
  const [from, to] = pick(random, options)
  link(route, from, to)
  route.leaves.add(to)
  return to
}

function distances(route: Route): Map<string, number> {
  const depth = new Map([[route.entry, 0]])
  const queue = [route.entry]
  for (let index = 0; index < queue.length; index++) {
    const key = queue[index]!
    for (const next of route.links.get(key)!) {
      if (depth.has(next)) continue
      depth.set(next, depth.get(key)! + 1)
      queue.push(next)
    }
  }
  return depth
}

/**
 * Give each room a free slot of its shape, trying a different level first for
 * each room so they spread up the stack. Returns the rooms that did not fit.
 */
function placeRooms(rooms: readonly string[], routes: Route[], random: () => number): string[] {
  const unplaced: string[] = []
  rooms.forEach((patternId, index) => {
    const room = ASSEMBLY_ROOMS.find((entry) => entry.patternId === patternId)!
    const order = room.lowestOnly ? [0] : routes.map((_, k) => (index + k) % routes.length)
    for (const k of order) {
      const route = routes[k]!
      const slots = [...route.links.keys()].filter((key) => isFreeSlot(route, key, room.shape))
      if (slots.length === 0) continue
      const slot = pick(random, slots)
      route.rooms.set(slot, patternId)
      // A through room keeps its two doorways, so it is as fixed as a leaf.
      route.leaves.add(slot)
      return
    }
    unplaced.push(patternId)
  })
  return unplaced
}

function isFreeSlot(route: Route, key: string, shape: AssemblyRoom['shape']): boolean {
  if (key === route.entry || route.leaves.has(key)) return false
  const faces = FACES.filter((face) => route.links.get(key)!.has(neighbourKey(key, face)))
  if (shape === 'leaf') return faces.length === 1
  return faces.length === 2 && OPPOSITE[faces[0]!] === faces[1]
}

/**
 * Join some neighbouring corridor bays that the tree left apart, so routes
 * loop the way a Stronghold's do. Rooms, stairs and landings keep their shape.
 */
function addLoops(route: Route, random: () => number): void {
  const flexible = (key: string) => !route.leaves.has(key)
  const pairs: Array<[string, string]> = []
  for (const from of route.links.keys()) {
    for (const face of ['e', 's'] as const) {
      const to = neighbourKey(from, face)
      if (route.links.has(to) && !route.links.get(from)!.has(to) && flexible(from) && flexible(to)) pairs.push([from, to])
    }
  }
  let budget = Math.floor(route.links.size / 5)
  for (const [from, to] of shuffle(random, pairs)) {
    if (budget === 0) break
    if (random() < 0.5) continue
    link(route, from, to)
    budget--
  }
}

function roleOf(route: Route, key: string, k: number): AssemblyRole {
  if (key === route.entry) return k === 0 ? 'spine' : 'landing'
  if (key === route.exit) return 'stair'
  if (route.rooms.has(key)) return 'room'
  return 'passage'
}

function pieceFor(
  role: AssemblyRole,
  route: Route,
  key: string,
  faces: readonly HorizontalFace[],
  lowest: boolean,
  stair: { up: string; landing: string },
  random: () => number,
): string {
  if (role === 'landing') return stair.landing
  if (role === 'stair') return stair.up
  if (role === 'room') return route.rooms.get(key)!
  const straight = faces.length === 2 && OPPOSITE[faces[0]!] === faces[1]
  if (faces.length <= 1) return role === 'passage' && lowest && random() < 0.3 ? 'cave-mouth' : 'dead-end'
  if (straight) return role === 'passage' && random() < 0.2 ? 'side-chamber' : 'straight-passage'
  if (faces.length === 2) return 'corner-passage'
  return faces.length === 3 ? 't-junction' : 'four-way-junction'
}

/** Rotate a catalog piece until its doorways are exactly `faces`. */
function oriented(patternId: string, faces: readonly HorizontalFace[]): { bay: Bay; quarterTurns: QuarterTurns } {
  const wanted = faces.join()
  for (const quarterTurns of [0, 1, 2, 3] as const) {
    const bay = bayFromPattern(patternId, quarterTurns)
    if (bayOpenFaces(bay).join() === wanted) return { bay, quarterTurns }
  }
  const name = getBayPattern(patternId)?.name ?? patternId
  throw new Error(`${name} has no rotation that opens exactly ${wanted || 'nowhere'}`)
}

/** The centre cell of the lowest level's entry becomes the spine. */
function makeSpine(bay: Bay): void {
  const centre = bay.cells[Math.floor(bay.cells.length / 2)]!
  bay.cells[Math.floor(bay.cells.length / 2)] = cellFromModule(SPINE_MODULE_ID, { sockets: centre.sockets })
}

/** Open ground stays a courtyard. Space over a built bay waits for expansion. */
function voidKind(below: Level | undefined, key: string): NegativeSpaceKind {
  if (!below) return 'courtyard'
  return below.negativeSpaces?.[key]?.kind ?? (below.bays[key] ? 'reserved' : 'courtyard')
}

function link(route: Route, from: string, to: string): void {
  if (!route.links.has(to)) route.links.set(to, new Set())
  route.links.get(from)!.add(to)
  route.links.get(to)!.add(from)
}

function neighbourKey(key: string, face: HorizontalFace): string {
  const { i, j } = parseBayKey(key)
  const step = STEP[face]
  // Off-field keys never appear in a route, so a placeholder is enough.
  return i + step.di < 0 || j + step.dj < 0 ? '' : bayKeyOf(i + step.di, j + step.dj)
}

function compareKeys(left: string, right: string): number {
  const a = parseBayKey(left)
  const b = parseBayKey(right)
  return a.j - b.j || a.i - b.i
}

/** Mulberry32: small, fast, and the same sequence for the same seed everywhere. */
function seededRandom(seed: number): () => number {
  let state = Math.trunc(seed) >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pick<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)]!
}

function shuffle<T>(random: () => number, items: readonly T[]): T[] {
  const result = [...items]
  for (let index = result.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1))
    ;[result[index], result[other]] = [result[other]!, result[index]!]
  }
  return result
}
