/** Connection-aware placement for reusable bay patterns. */
import {
  bayKeyOf,
  cellAxisIndices,
  horizontalOpeningSpan,
  interiorSpan,
  parseBayKey,
} from './geometry.js'
import { bayFromPattern, type QuarterTurns } from './patterns.js'
import { GRAIN_AXIS_CELLS, type Bay, type Face, type Project, type Socket } from './types.js'

type HorizontalFace = Extract<Face, 'n' | 'e' | 's' | 'w'>
type ConnectionKind = 'room' | 'window' | 'bars'

interface FaceOpening {
  kind: ConnectionKind
  span: [number, number]
}

interface NeighbourDirection {
  face: HorizontalFace
  opposite: HorizontalFace
  di: number
  dj: number
}

const NEIGHBOURS: readonly NeighbourDirection[] = [
  { face: 'n', opposite: 's', di: 0, dj: -1 },
  { face: 'e', opposite: 'w', di: 1, dj: 0 },
  { face: 's', opposite: 'n', di: 0, dj: 1 },
  { face: 'w', opposite: 'e', di: -1, dj: 0 },
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
  if (!level.bays[bayKey]) throw new Error(`no bay '${bayKey}' on level '${levelId}'`)

  const candidate = bayFromPattern(patternId, quarterTurns)
  const { i, j } = parseBayKey(bayKey)
  let checkedNeighbours = 0
  let matchedOpenings = 0
  let conflicts = 0

  for (const direction of NEIGHBOURS) {
    const ni = i + direction.di
    const nj = j + direction.dj
    if (ni < 0 || nj < 0 || ni >= project.bayCols || nj >= project.bayRows) continue
    const neighbour = level.bays[bayKeyOf(ni, nj)]
    if (!neighbour) continue
    checkedNeighbours++
    const result = compareOpenings(
      faceOpenings(candidate, direction.face),
      faceOpenings(neighbour, direction.opposite),
    )
    matchedOpenings += result.matches
    conflicts += result.conflicts
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
    if (span && kind) openings.push({ kind, span })
  }
  return openings
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

function openingsMatch(left: FaceOpening, right: FaceOpening): boolean {
  return left.kind === right.kind && left.span[0] <= right.span[1] && right.span[0] <= left.span[1]
}
