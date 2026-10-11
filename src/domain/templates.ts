/** Optional starting projects. Templates expand into ordinary schema-v1 data. */
import { cellFromModule, type CellOverrides } from './modules.js'
import { PALETTES } from './palettes.js'
import { bayFromPattern, type QuarterTurns } from './patterns.js'
import type { Bay, Level, Project } from './types.js'

export type ProjectTemplateId = 'layered-base'

export interface ProjectTemplate {
  id: ProjectTemplateId
  name: string
  description: string
}

export const PROJECT_TEMPLATE_LIST: readonly ProjectTemplate[] = [
  {
    id: 'layered-base',
    name: 'Layered base example',
    description: 'A sparse 5×5 field with mansion, stronghold, trial, and mineshaft levels joined by stairs.',
  },
]

type PatternPlacement = readonly [bayKey: string, patternId: string, quarterTurns?: QuarterTurns]

const INFRASTRUCTURE: readonly PatternPlacement[] = [
  ['C3', 'straight-passage', 1],
  ['C4', 'straight-passage', 1],
  ['A5', 'rail-line-bay'],
  ['B5', 'rail-line-bay'],
  ['C5', 't-junction'],
  ['D5', 'rail-line-bay'],
  ['E5', 'rail-line-bay'],
]

const MACHINERY: readonly PatternPlacement[] = [
  ['C2', 'straight-passage', 1],
  ['B3', 'workshop-bay', 2],
  ['C3', 'feature-chamber'],
  ['D3', 'workshop-bay'],
  ['C4', 'straight-passage', 1],
]

const CORE: readonly PatternPlacement[] = [
  ['C1', 'library-hall', 3],
  ['C2', 'straight-passage', 1],
  ['A3', 'library-hall', 2],
  ['B3', 'straight-passage'],
  ['C3', 'four-way-junction'],
  ['D3', 'straight-passage'],
  ['E3', 'library-hall'],
  ['C4', 'straight-passage', 1],
  ['C5', 'library-hall', 1],
]

const LIVING: readonly PatternPlacement[] = [
  ['B1', 'library-hall', 2],
  ['C1', 't-junction', 2],
  ['D1', 'library-hall'],
  ['C2', 'straight-passage', 1],
  ['A3', 'library-hall', 2],
  ['B3', 'straight-passage'],
  ['C3', 'four-way-junction'],
  ['D3', 'straight-passage'],
  ['E3', 'library-hall'],
]

/** Replaces one cell of a placed pattern. */
type CellEdit = readonly [bayKey: string, cellIndex: number, moduleId: string, overrides?: CellOverrides]

/**
 * The stairs and the spine. Rotated straight passages run north to south, so
 * cell 4 is the middle of the run. One stair climbs through C4 from the
 * mineshaft to the stronghold, and a second climbs through C2 to the mansion.
 * Each stair is as tall as the rise to the level it lands on.
 */
const STAIR_SOCKETS = { s: 'corridor' } as const

const INFRASTRUCTURE_CELLS: readonly CellEdit[] = [
  ['C4', 4, 'stair', { heightCells: 1, sockets: STAIR_SOCKETS }],
]

const MACHINERY_CELLS: readonly CellEdit[] = [
  ['C4', 4, 'stair', { heightCells: 3, sockets: { ...STAIR_SOCKETS, down: 'shaft' } }],
]

const CORE_CELLS: readonly CellEdit[] = [
  ['C2', 4, 'stair', { heightCells: 2, sockets: STAIR_SOCKETS }],
  ['C3', 4, 'spine'],
  ['C4', 4, 'corridor', { sockets: { down: 'shaft' } }],
]

const LIVING_CELLS: readonly CellEdit[] = [['C2', 4, 'corridor', { sockets: { down: 'shaft' } }]]

function bays(placements: readonly PatternPlacement[], edits: readonly CellEdit[]): Record<string, Bay> {
  const result: Record<string, Bay> = Object.fromEntries(
    placements.map(([bayKey, patternId, quarterTurns = 0]) => [bayKey, bayFromPattern(patternId, quarterTurns)]),
  )
  for (const [bayKey, cellIndex, moduleId, overrides] of edits) {
    const bay = result[bayKey]
    if (!bay?.cells[cellIndex]) throw new Error(`template edit targets missing cell ${bayKey}[${cellIndex}]`)
    bay.cells[cellIndex] = cellFromModule(moduleId, overrides)
  }
  return result
}

function level(
  newId: () => string,
  name: string,
  y: number,
  paletteId: string,
  placements: readonly PatternPlacement[],
  edits: readonly CellEdit[],
): Level {
  return { id: newId(), name, y, paletteId, bays: bays(placements, edits) }
}

export function projectFromTemplate(templateId: ProjectTemplateId, newId: () => string): Project {
  if (templateId !== 'layered-base') throw new Error(`no project template '${templateId}'`)
  return {
    schemaVersion: 1,
    id: newId(),
    name: 'Layered base example',
    origin: { x: 0, z: 0 },
    bayCols: 5,
    bayRows: 5,
    levels: [
      level(newId, 'Mineshaft infrastructure', -4, 'mineshaft-oak', INFRASTRUCTURE, INFRASTRUCTURE_CELLS),
      level(newId, 'Trial machinery', 0, 'tuff-copper', MACHINERY, MACHINERY_CELLS),
      level(newId, 'Stronghold core', 12, 'stone-brick', CORE, CORE_CELLS),
      level(newId, 'Mansion living', 20, 'dark-oak', LIVING, LIVING_CELLS),
    ],
    // A deep copy, so editing this project's palettes leaves the shipped ones alone.
    palettes: structuredClone(PALETTES),
  }
}
