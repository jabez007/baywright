/** Connection-aware placement for reusable bay patterns. */
import {
  bayFootprint,
  baysOver,
  cellAxisIndices,
  faceStrip,
  horizontalOpeningSpan,
  interiorSpan,
  type Footprint,
} from './geometry.js'
import { bayFromPattern, type QuarterTurns } from './patterns.js'
import { GRAIN_AXIS_CELLS, type Bay, type Face, type Project, type Socket } from './types.js'

export type HorizontalFace = Extract<Face, 'n' | 'e' | 's' | 'w'>
type ConnectionKind = 'room' | 'window' | 'bars'

interface FaceOpening {
  kind: ConnectionKind
  span: [number, number]
  /** The interior span of the cell the opening is in, along the same axis. */
  cell: [number, number]
}

interface NeighbourDirection {
  face: HorizontalFace
  opposite: HorizontalFace
}

const NEIGHBOURS: readonly NeighbourDirection[] = [
  { face: 'n', opposite: 's' },
  { face: 'e', opposite: 'w' },
  { face: 's', opposite: 'n' },
  { face: 'w', opposite: 'e' },
]

export interface PatternFit {
  quarterTurns: QuarterTurns
  compatible: boolean
  checkedNeighbours: number
  matchedOpenings: number
  conflicts: number
}

export function patternFitAt(
  project: Project,
  levelId: string,
  bayKey: string,
  patternId: string,
  quarterTurns: QuarterTurns,
): PatternFit {
  const level = project.levels.find((entry) => entry.id === levelId)
  if (!level) throw new Error(`no level '${levelId}'`)
  const bay = level.bays[bayKey]
  if (!bay) throw new Error(`no bay '${bayKey}' on level '${levelId}'`)

  // The stamp keeps the bay's offset, so the candidate stands where the bay
  // does and may meet two bays on one side.
  const candidate = bayFromPattern(patternId, quarterTurns)
  const ours = bayFootprint(project, bayKey, bay)
  let checkedNeighbours = 0
  let matchedOpenings = 0
  let conflicts = 0

  for (const direction of NEIGHBOURS) {
    for (const [neighbourKey, neighbour] of baysOver(project, level, faceStrip(ours, direction.face))) {
      if (neighbourKey === bayKey) continue
      checkedNeighbours++
      const theirs = bayFootprint(project, neighbourKey, neighbour)
      const result = compareOpenings(
        openingsAlong(candidate, direction.face, ours, theirs),
        openingsAlong(neighbour, direction.opposite, theirs, ours),
      )
      matchedOpenings += result.matches
      conflicts += result.conflicts
    }
  }

  return {
    quarterTurns,
    compatible: conflicts === 0,
    checkedNeighbours,
    matchedOpenings,
    conflicts,
  }
}

export function bestPatternFit(
  project: Project,
  levelId: string,
  bayKey: string,
  patternId: string,
): PatternFit {
  const fits = ([0, 1, 2, 3] as const).map((turn) => patternFitAt(project, levelId, bayKey, patternId, turn))
  return fits.sort((left, right) =>
    Number(right.compatible) - Number(left.compatible)
    || left.conflicts - right.conflicts
    || right.matchedOpenings - left.matchedOpenings
    || left.quarterTurns - right.quarterTurns,
  )[0]!
}

/** The bay faces that carry a doorway or arch, in n, e, s, w order. */
export function bayOpenFaces(bay: Bay): HorizontalFace[] {
  return NEIGHBOURS
    .map(({ face }) => face)
    .filter((face) => faceOpenings(bay, face).some((opening) => opening.kind === 'room'))
}

function faceOpenings(bay: Bay, face: HorizontalFace): FaceOpening[] {
  const n = GRAIN_AXIS_CELLS[bay.grain]
  const openings: FaceOpening[] = []
  for (let cellIndex = 0; cellIndex < bay.cells.length; cellIndex++) {
    const { a, b } = cellAxisIndices(bay.grain, cellIndex)
    if (face === 'n' && b !== 0) continue
    if (face === 'e' && a !== n - 1) continue
    if (face === 's' && b !== n - 1) continue
    if (face === 'w' && a !== 0) continue
    const cell = bay.cells[cellIndex]!
    const socket = cell.sockets[face]
    const cross = face === 'e' || face === 'w' ? interiorSpan(bay.grain, b) : interiorSpan(bay.grain, a)
    const span = horizontalOpeningSpan(socket, cross, cell.openingWidths?.[face])
    const kind = connectionKind(socket)
    if (span && kind) openings.push({ kind, span, cell: cross })
  }
  return openings
}

/**
 * A bay's openings on one face in plan coordinates along the seam, keeping
 * those that reach the stretch the face shares with `other`. Bays in their
 * own slots share the whole face; an offset one shares half of it with each
 * of two neighbours.
 */
function openingsAlong(bay: Bay, face: HorizontalFace, own: Footprint, other: Footprint): FaceOpening[] {
  const alongZ = face === 'e' || face === 'w'
  const start = alongZ ? own.z0 : own.x0
  const lo = Math.max(start, alongZ ? other.z0 : other.x0)
  const hi = Math.min(alongZ ? own.z1 : own.x1, alongZ ? other.z1 : other.x1)
  return faceOpenings(bay, face)
    .map((opening): FaceOpening => ({
      kind: opening.kind,
      span: [opening.span[0] + start, opening.span[1] + start],
      cell: [opening.cell[0] + start, opening.cell[1] + start],
    }))
    .filter((opening) => opening.span[1] > lo && opening.span[0] < hi)
}

function connectionKind(socket: Socket): ConnectionKind | null {
  if (socket === 'corridor' || socket === 'arch') return 'room'
  if (socket === 'window') return 'window'
  if (socket === 'bars') return 'bars'
  return null
}

function compareOpenings(left: FaceOpening[], right: FaceOpening[]): { matches: number; conflicts: number } {
  const leftMatches = left.map((opening) => right.some((other) => openingsMatch(opening, other)))
  const rightMatches = right.map((opening) => left.some((other) => openingsMatch(opening, other)))
  return {
    matches: leftMatches.filter(Boolean).length + rightMatches.filter(Boolean).length,
    conflicts: leftMatches.filter((match) => !match).length + rightMatches.filter((match) => !match).length,
  }
}

/**
 * Two openings meet when they overlap and their cells line up, as V2 asks: one
 * cell's interior span lies inside the other's. Openings in cells that straddle
 * a joint share a block or two but would meet a wall end.
 */
function openingsMatch(left: FaceOpening, right: FaceOpening): boolean {
  return (
    left.kind === right.kind
    && left.span[0] <= right.span[1]
    && right.span[0] <= left.span[1]
    && (spanWithin(left.cell, right.cell) || spanWithin(right.cell, left.cell))
  )
}

function spanWithin(inner: [number, number], outer: [number, number]): boolean {
  return outer[0] <= inner[0] && inner[1] <= outer[1]
}
