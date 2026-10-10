/**
 * Procedural assembly. The generator grows a seeded route through a footprint
 * on each level, joins the levels with the compact stair layout, and fills the
 * route with pieces from the bay pattern catalog and the atrium layout. It writes ordinary bays and
 * named negative space into a copy of the project and runs the validators on
 * the copy, so a proposal can be previewed before anything changes.
 *
 * Pure: no Vue, no store, no I/O. The same project and request always give the
 * same proposal.
 */
import { bayOpenFaces, type HorizontalFace } from './connections.js'
import { bayKeyOf, parseBayKey, sortedLevels } from './geometry.js'
import { getLayoutPattern, rotatedLayout } from './layouts.js'
import { SPINE_MODULE_ID, cellFromModule } from './modules.js'
import { bayFromPattern, getBayPattern, type QuarterTurns } from './patterns.js'
import type { Bay, Level, NegativeSpaceKind, Project } from './types.js'
import { validate, type Issue } from './validate.js'

/**
 * Rooms the generator can place. A leaf room has one doorway and ends a
 * branch. A through room sits on a straight run and keeps it open. An atrium
 * is the multi-level layout of that name, placed before the route grows.
 */
export interface AssemblyRoom {
  /** A bay pattern id, or the layout id for an atrium. */
  id: string
  shape: 'leaf' | 'through' | 'atrium'
  /** Only on the lowest assembled level, because its floor opens downward. */
  lowestOnly?: boolean
}

export const ASSEMBLY_ROOMS: readonly AssemblyRoom[] = [
  { id: 'library-hall', shape: 'leaf' },
  { id: 'machine-hall', shape: 'leaf' },
  { id: 'mine-head', shape: 'leaf', lowestOnly: true },
  { id: 'side-chamber', shape: 'through' },
  { id: 'concealed-room', shape: 'through' },
  { id: 'atrium', shape: 'atrium' },
]

/** The catalog name and description of an assembly room. */
export function assemblyRoomLabel(id: string): { name: string; description: string } {
  const entry = getBayPattern(id) ?? getLayoutPattern(id)
  return { name: entry?.name ?? id, description: entry?.description ?? '' }
}

export const MAX_ASSEMBLY_LEVELS = 4

/** The layout whose two pieces join one assembled level to the next. */
export const ASSEMBLY_STAIR_LAYOUT_ID = 'compact-stair-pair'

const ATRIUM_LAYOUT_ID = 'atrium'

export interface AssemblyRequest {
  /** The lowest level. Higher levels sit one stair rise apart above it. */
  levelId: string
  /** The footprint's north-west bay. */
  anchorBayKey: string
  width: number
  height: number
  levelCount: number
  /** Room ids from `ASSEMBLY_ROOMS`. Repeat an id to ask for more. */
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

interface Piece {
  patternId: string
  quarterTurns: QuarterTurns
}

/**
 * Pieces placed before a level's route grows, with the links their doorways
 * need. When `mustJoin` is set, the route keeps growing until it reaches them.
 * `through` lists pieces that reach each other through a tall room below
 * rather than by a link, as the balconies over an atrium core do.
 */
interface Preset {
  pieces: Map<string, Piece>
  links: Array<[string, string]>
  mustJoin: boolean
  through: string[]
}

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
  /** Preset pieces. Their links are final. */
  fixed: Map<string, Piece>
  /** Groups of preset pieces joined through a tall room instead of links. */
  through: string[][]
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
  // Atriums go in before the route on their level grows around them.
  const routes: Route[] = []
  const presets: Preset[][] = levels.map(() => [])
  /** Bays a tall room below rises through, left unbuilt and unnamed. */
  const risers: Array<Set<string>> = levels.map(() => new Set())
  const unplaced = new Set<number>()
  let atriums = request.rooms.flatMap((id, index) => (id === ATRIUM_LAYOUT_ID ? [index] : []))
  const isClimbable = (k: number, key: string) => !levels[k]!.negativeSpaces?.[key] && !risers[k]!.has(key)

  /** Grow level `k`'s route around its presets and choose its stair up. */
  const growLevel = (k: number, open: readonly string[], entry: string): Route => {
    const route = growRoute(open, entry, k > 0, targetSize(open.length, random), random, presets[k]!)
    if (route.links.get(entry)!.size === 0) {
      throw new Error(`'${levels[k]!.name}' has only one open bay in the footprint, so no route can leave it`)
    }
    if (k === levels.length - 1) return route
    const preset = new Set(presets[k + 1]!.flatMap(presetKeys))
    const piecesAbove = new Set(presets[k + 1]!.flatMap((entry) => [...entry.pieces.keys()]))
    // The landing needs a free bay beside it to step out into.
    const canLand = (key: string) => isClimbable(k + 1, key) && !preset.has(key) && FACES.some((face) => {
      const next = neighbourKey(key, face)
      return route.links.has(next) && isClimbable(k + 1, next) && !piecesAbove.has(next)
    })
    route.exit = chooseExit(route, open, canLand, random) ?? undefined
    return route
  }

  let available = footprint.filter((key) => !base.negativeSpaces?.[key])
  if (available.length === 0) throw new Error('The footprint is all named negative space, so there is nowhere to build')
  for (let k = 0; k < levels.length; k++) {
    const entry = k === 0 ? centralKey(available, random) : routes[k - 1]!.exit!
    const above = levels[k + 1]
    const presetsHere = presets[k]!.length
    const placedHere: number[] = []
    if (above) {
      const share = Math.ceil(atriums.length / (levels.length - 1 - k))
      for (const index of atriums.slice(0, share)) {
        const atrium = chooseAtrium(available, entry, k > 0, presets[k]!, presets[k + 1]!, above, stair.rise, random)
        if (!atrium) continue
        presets[k]!.push(atrium.lower)
        presets[k + 1]!.push(atrium.upper)
        for (const key of atrium.risers) risers[k + 1]!.add(key)
        placedHere.push(index)
      }
      atriums = atriums.filter((index) => !placedHere.includes(index))
    }

    let route = growLevel(k, available, entry)
    if (above && !route.exit && placedHere.length > 0) {
      // The atriums left no room for a stair, so they wait for a higher level.
      presets[k]!.length = presetsHere
      presets[k + 1]!.length = 0
      risers[k + 1]!.clear()
      atriums = [...placedHere, ...atriums]
      route = growLevel(k, available, entry)
    }
    if (above && !route.exit) throw new Error(`There is no room for a stair up from '${levels[k]!.name}' inside the footprint`)
    routes.push(route)
    // Upper levels build only over bays the level below builds.
    if (above) available = [...route.links.keys()].filter((key) => isClimbable(k + 1, key)).sort(compareKeys)
  }
  for (const index of atriums) unplaced.add(index)

  for (const index of placeRooms(request.rooms, routes, random)) unplaced.add(index)
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
        if (risers[k]!.has(key)) continue
        const builtBelow = k > 0 && (routes[k - 1]!.links.has(key) || risers[k - 1]!.has(key))
        level.negativeSpaces ??= {}
        level.negativeSpaces[key] = { kind: voidKind(below, builtBelow, key) }
        continue
      }
      const faces = FACES.filter((face) => links.has(neighbourKey(key, face)))
      const role = roleOf(route, key, k)
      const fixed = route.fixed.get(key)
      const patternId = fixed?.patternId ?? pieceFor(role, route, key, faces, k === 0, stair, random)
      const { bay, quarterTurns } = fixed ? { bay: bayFromPattern(fixed.patternId, fixed.quarterTurns), quarterTurns: fixed.quarterTurns } : oriented(patternId, faces)
      if (role === 'spine') makeSpine(bay)
      level.bays[key] = bay
      bays.push({ levelId: level.id, bayKey: key, patternId, quarterTurns, role })
    }
  }

  const unplacedRooms = request.rooms.filter((_, index) => unplaced.has(index))
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
    if (!ASSEMBLY_ROOMS.some((entry) => entry.id === room)) throw new Error(`'${room}' is not an assembly room`)
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
 *
 * Presets start as separate pieces of the route. A link between two pieces
 * joins them, and growth goes on past the target until every preset that must
 * join the entry has.
 */
function growRoute(
  available: readonly string[],
  entry: string,
  entryIsLeaf: boolean,
  target: number,
  random: () => number,
  presets: readonly Preset[],
): Route {
  const route: Route = {
    links: new Map([[entry, new Set()]]),
    entry,
    leaves: new Set(entryIsLeaf ? [entry] : []),
    rooms: new Map(),
    fixed: new Map(),
    through: presets.filter((preset) => preset.through.length > 1).map((preset) => preset.through),
  }
  const parent = new Map<string, string>()
  const root = (key: string): string => {
    let at = key
    while (parent.has(at) && parent.get(at) !== at) at = parent.get(at)!
    return at
  }
  const join = (from: string, to: string) => {
    link(route, from, to)
    parent.set(root(from), root(to))
  }
  for (const preset of presets) {
    for (const [key, piece] of preset.pieces) {
      route.fixed.set(key, piece)
      if (!route.links.has(key)) route.links.set(key, new Set())
    }
    for (const [from, to] of preset.links) join(from, to)
  }
  const joined = () => presets.every((preset) => !preset.mustJoin || presetKeys(preset).every((key) => root(key) === root(entry)))
  // Presets can fill the target on their own, but the entry still needs a way out.
  const done = () => route.links.size >= target && joined() && route.links.get(entry)!.size > 0

  const open = new Set(available)
  while (!done()) {
    const options = [...frontier(route, (key) => open.has(key)), ...bridges(route, root)]
    if (options.length === 0) break
    const [from, to] = pick(random, options)
    join(from, to)
  }
  return route
}

function presetKeys(preset: Preset): string[] {
  return [...preset.pieces.keys(), ...preset.links.flat()]
}

/** A route bay may take another link unless it is preset or a used leaf. */
function isSealed(route: Route, key: string): boolean {
  return route.fixed.has(key) || (route.leaves.has(key) && route.links.get(key)!.size > 0)
}

/** Links between neighbouring route bays that are not yet joined. */
function bridges(route: Route, root: (key: string) => string): Array<[string, string]> {
  const options: Array<[string, string]> = []
  for (const from of route.links.keys()) {
    if (isSealed(route, from)) continue
    for (const face of ['e', 's'] as const) {
      const to = neighbourKey(from, face)
      if (route.links.has(to) && !isSealed(route, to) && root(from) !== root(to)) options.push([from, to])
    }
  }
  return options
}

function frontier(route: Route, canAdd: (key: string) => boolean): Array<[string, string]> {
  const options: Array<[string, string]> = []
  for (const from of route.links.keys()) {
    if (isSealed(route, from)) continue
    for (const face of FACES) {
      const to = neighbourKey(from, face)
      if (!route.links.has(to) && canAdd(to)) options.push([from, to])
    }
  }
  return options
}

interface AtriumPlacement {
  lower: Preset
  upper: Preset
  risers: string[]
}

/**
 * A spot for the atrium layout. Its bays and the bays outside its doorways
 * must be open, and the entry must reach one of those outside bays. On the
 * level above, the balconies and the bays outside them must be free, and the
 * core rises through the bay between the balconies.
 */
function chooseAtrium(
  available: readonly string[],
  entry: string,
  entryIsLeaf: boolean,
  presetsHere: readonly Preset[],
  presetsAbove: readonly Preset[],
  above: Level,
  rise: number,
  random: () => number,
): AtriumPlacement | null {
  const open = new Set(available)
  const takenHere = new Set(presetsHere.flatMap((preset) => [...preset.pieces.keys()]))
  const takenAbove = new Set(presetsAbove.flatMap(presetKeys))
  const candidates: AtriumPlacement[] = []
  for (const quarterTurns of [0, 1] as const) {
    const layout = rotatedLayout(ATRIUM_LAYOUT_ID, quarterTurns)
    for (const anchor of available) {
      const { i, j } = parseBayKey(anchor)
      const piecesAt = (dy: number) => new Map(layout.placements
        .filter((placement) => (placement.dy ?? 0) === dy)
        .map((placement) => [bayKeyOf(i + placement.i, j + placement.j), { patternId: placement.patternId, quarterTurns: placement.quarterTurns }]))
      const lower = piecesAt(0)
      const upper = piecesAt(rise)
      if ([...lower.keys()].some((key) => !open.has(key) || key === entry || takenHere.has(key))) continue
      if ([...lower.keys()].some((key) => above.negativeSpaces?.[key] || takenAbove.has(key))) continue

      const lowerLinks = doorwayLinks(lower, () => true)
      const ports = lowerLinks.map(([, to]) => to).filter((key) => !lower.has(key))
      if (ports.some((key) => !open.has(key) || takenHere.has(key) || (entryIsLeaf && key === entry))) continue
      if (!reachesAny(open, entry, ports, new Set([...lower.keys(), ...takenHere]))) continue

      // A balcony's doorway over the core opens onto the core, not a bay.
      const upperLinks = doorwayLinks(upper, (key) => upper.has(key) || !lower.has(key))
      const upperPorts = upperLinks.map(([, to]) => to).filter((key) => !upper.has(key))
      if (upperPorts.some((key) => !ports.includes(key) || above.negativeSpaces?.[key] || takenAbove.has(key))) continue

      candidates.push({
        lower: { pieces: lower, links: lowerLinks, mustJoin: true, through: [] },
        upper: { pieces: upper, links: upperLinks, mustJoin: false, through: [...upper.keys()] },
        risers: [...lower.keys()].filter((key) => !upper.has(key)),
      })
    }
  }
  return candidates.length > 0 ? pick(random, candidates) : null
}

/** A link through each doorway of each piece, once per pair of pieces. */
function doorwayLinks(pieces: ReadonlyMap<string, Piece>, keep: (to: string) => boolean): Array<[string, string]> {
  const links: Array<[string, string]> = []
  for (const [key, piece] of pieces) {
    for (const face of bayOpenFaces(bayFromPattern(piece.patternId, piece.quarterTurns))) {
      const to = neighbourKey(key, face)
      if (!keep(to) || (pieces.has(to) && to < key)) continue
      links.push([key, to])
    }
  }
  return links
}

function reachesAny(open: ReadonlySet<string>, from: string, targets: readonly string[], blocked: ReadonlySet<string>): boolean {
  const seen = new Set([from])
  const queue = [from]
  for (let index = 0; index < queue.length; index++) {
    const key = queue[index]!
    if (targets.includes(key)) return true
    for (const face of FACES) {
      const next = neighbourKey(key, face)
      if (open.has(next) && !blocked.has(next) && !seen.has(next)) {
        seen.add(next)
        queue.push(next)
      }
    }
  }
  return false
}

/**
 * The stair goes in the dead end farthest from the entry, so each level has to
 * be crossed to reach the next. With no usable dead end, grow a new one.
 */
function chooseExit(route: Route, available: readonly string[], climbable: (key: string) => boolean, random: () => number): string | null {
  const depth = distances(route)
  const leaves = [...route.links.keys()].filter((key) =>
    key !== route.entry && depth.has(key) && !route.fixed.has(key) && route.links.get(key)!.size === 1 && climbable(key))
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
    const across = route.through.filter((group) => group.includes(key)).flat()
    for (const next of [...route.links.get(key)!, ...across]) {
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
function placeRooms(rooms: readonly string[], routes: Route[], random: () => number): number[] {
  const unplaced: number[] = []
  rooms.forEach((id, index) => {
    const room = ASSEMBLY_ROOMS.find((entry) => entry.id === id)!
    if (room.shape === 'atrium') return
    const order = room.lowestOnly ? [0] : routes.map((_, k) => (index + k) % routes.length)
    for (const k of order) {
      const route = routes[k]!
      const slots = [...route.links.keys()].filter((key) => isFreeSlot(route, key, room.shape))
      if (slots.length === 0) continue
      const slot = pick(random, slots)
      route.rooms.set(slot, id)
      // A through room keeps its two doorways, so it is as fixed as a leaf.
      route.leaves.add(slot)
      return
    }
    unplaced.push(index)
  })
  return unplaced
}

function isFreeSlot(route: Route, key: string, shape: AssemblyRoom['shape']): boolean {
  if (key === route.entry || route.leaves.has(key) || route.fixed.has(key)) return false
  const faces = FACES.filter((face) => route.links.get(key)!.has(neighbourKey(key, face)))
  if (shape === 'leaf') return faces.length === 1
  return faces.length === 2 && OPPOSITE[faces[0]!] === faces[1]
}

/**
 * Join some neighbouring corridor bays that the tree left apart, so routes
 * loop the way a Stronghold's do. Rooms, stairs and landings keep their shape.
 */
function addLoops(route: Route, random: () => number): void {
  const flexible = (key: string) => !route.leaves.has(key) && !route.fixed.has(key)
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
  if (route.rooms.has(key) || route.fixed.has(key)) return 'room'
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
function voidKind(below: Level | undefined, builtBelow: boolean, key: string): NegativeSpaceKind {
  if (builtBelow) return 'reserved'
  return below?.negativeSpaces?.[key]?.kind ?? 'courtyard'
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
