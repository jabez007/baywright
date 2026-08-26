/** Optional starting projects. Templates expand into ordinary schema-v1 data. */
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
    description: 'A sparse 5×5 field with mansion, stronghold, trial, and mineshaft levels.',
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
  ['B3', 'workshop-bay'],
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
  ['C1', 'straight-passage'],
  ['D1', 'library-hall'],
  ['C2', 'straight-passage', 1],
  ['A3', 'library-hall', 2],
  ['B3', 'straight-passage'],
  ['C3', 'four-way-junction'],
  ['D3', 'straight-passage'],
  ['E3', 'library-hall'],
]

function bays(placements: readonly PatternPlacement[]): Record<string, Bay> {
  return Object.fromEntries(
    placements.map(([bayKey, patternId, quarterTurns = 0]) => [bayKey, bayFromPattern(patternId, quarterTurns)]),
  )
}

function level(
  newId: () => string,
  name: string,
  y: number,
  paletteId: string,
  placements: readonly PatternPlacement[],
): Level {
  return { id: newId(), name, y, paletteId, bays: bays(placements) }
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
      level(newId, 'Mineshaft infrastructure', -4, 'mineshaft-oak', INFRASTRUCTURE),
      level(newId, 'Trial machinery', 0, 'tuff-copper', MACHINERY),
      level(newId, 'Stronghold core', 12, 'stone-brick', CORE),
      level(newId, 'Mansion living', 20, 'dark-oak', LIVING),
    ],
    palettes: { ...PALETTES },
  }
}
