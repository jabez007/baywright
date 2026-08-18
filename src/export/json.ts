/**
 * PRD §11 — the `.json` project export, priority v0.
 *
 * Round-trip save/load. `parseProject` is the defensive import boundary: a file
 * on disk may have been hand-edited, so every field the renderer and the
 * geometry resolver dereference is checked here rather than at the point of use.
 * Geometry problems (V6 level alignment, collisions, seams) are deliberately
 * *not* checked — those are the validator's job, and surfacing them as issues
 * in the UI is more useful than refusing to open the file.
 *
 * Pure apart from {@link downloadProject}, which is the only browser-aware part.
 */
import { cellCount, type Bay, type Cell, type Face, type Level, type Project, type Socket } from '../domain/types.js'

export const SCHEMA_VERSION = 1

const FACES: readonly Face[] = ['n', 'e', 's', 'w', 'up', 'down']
const SOCKETS: ReadonlySet<string> = new Set<Socket>(['solid', 'corridor', 'arch', 'window', 'bars', 'shaft'])
const GRAINS: ReadonlySet<string> = new Set(['fine', 'coarse', 'merged'])
const CEILINGS: ReadonlySet<string> = new Set(['dropped', 'flat', 'vaulted'])

/** Thrown by {@link parseProject}. `path` locates the offending field. */
export class ProjectParseError extends Error {
  constructor(
    message: string,
    readonly path: string,
  ) {
    super(`${path}: ${message}`)
    this.name = 'ProjectParseError'
  }
}

/** Pretty-printed so a project file stays diffable in git. */
export function serializeProject(project: Project): string {
  return `${JSON.stringify(project, null, 2)}\n`
}

/** Parse and structurally validate a project document. */
export function parseProject(text: string): Project {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (cause) {
    throw new ProjectParseError(`not valid JSON (${(cause as Error).message})`, '$')
  }
  return validateProject(raw)
}

/** Structural validation of an already-parsed value. */
export function validateProject(raw: unknown): Project {
  const doc = object(raw, '$')

  if (doc['schemaVersion'] !== SCHEMA_VERSION) {
    throw new ProjectParseError(
      `unsupported schemaVersion ${JSON.stringify(doc['schemaVersion'])} (this build reads ${SCHEMA_VERSION})`,
      '$.schemaVersion',
    )
  }

  const origin = object(doc['origin'], '$.origin')
  const levels = array(doc['levels'], '$.levels')

  const project: Project = {
    schemaVersion: SCHEMA_VERSION,
    id: string(doc['id'], '$.id'),
    name: string(doc['name'], '$.name'),
    origin: { x: integer(origin['x'], '$.origin.x'), z: integer(origin['z'], '$.origin.z') },
    bayCols: positiveInteger(doc['bayCols'], '$.bayCols'),
    bayRows: positiveInteger(doc['bayRows'], '$.bayRows'),
    levels: levels.map((level, index) => parseLevel(level, `$.levels[${index}]`)),
    palettes: parsePalettes(doc['palettes'], '$.palettes'),
  }

  if (project.levels.length === 0) throw new ProjectParseError('a project needs at least one level', '$.levels')

  const seen = new Set<string>()
  for (const level of project.levels) {
    if (seen.has(level.id)) throw new ProjectParseError(`duplicate level id '${level.id}'`, '$.levels')
    seen.add(level.id)
  }

  // §6 — levels are kept sorted ascending by y.
  project.levels.sort((left, right) => left.y - right.y)
  return project
}

function parseLevel(raw: unknown, path: string): Level {
  const doc = object(raw, path)
  const bays = object(doc['bays'], `${path}.bays`)
  const level: Level = {
    id: string(doc['id'], `${path}.id`),
    // Not checked for multiple-of-4 here: that is V6's job, so a misaligned
    // import opens with a visible error rather than failing to open at all.
    y: integer(doc['y'], `${path}.y`),
    name: string(doc['name'], `${path}.name`),
    paletteId: string(doc['paletteId'], `${path}.paletteId`),
    bays: {},
  }
  for (const [bayKey, bay] of Object.entries(bays)) {
    if (!/^[A-Z]+[1-9][0-9]*$/.test(bayKey)) {
      throw new ProjectParseError(`malformed bay key '${bayKey}'`, `${path}.bays`)
    }
    level.bays[bayKey] = parseBay(bay, `${path}.bays.${bayKey}`)
  }
  return level
}

function parseBay(raw: unknown, path: string): Bay {
  const doc = object(raw, path)
  const grain = string(doc['grain'], `${path}.grain`)
  if (!GRAINS.has(grain)) throw new ProjectParseError(`unknown grain '${grain}'`, `${path}.grain`)
  const cells = array(doc['cells'], `${path}.cells`)
  const expected = cellCount(grain as Bay['grain'])
  if (cells.length !== expected) {
    throw new ProjectParseError(`a ${grain} bay holds ${expected} cells, got ${cells.length}`, `${path}.cells`)
  }
  return {
    grain: grain as Bay['grain'],
    cells: cells.map((cell, index) => parseCell(cell, `${path}.cells[${index}]`)),
  }
}

function parseCell(raw: unknown, path: string): Cell {
  const doc = object(raw, path)
  const height = integer(doc['heightCells'], `${path}.heightCells`)
  if (height !== 1 && height !== 2 && height !== 3) {
    throw new ProjectParseError(`heightCells must be 1, 2 or 3, got ${height}`, `${path}.heightCells`)
  }
  const ceiling = string(doc['ceiling'], `${path}.ceiling`)
  if (!CEILINGS.has(ceiling)) throw new ProjectParseError(`unknown ceiling '${ceiling}'`, `${path}.ceiling`)

  const rawSockets = object(doc['sockets'], `${path}.sockets`)
  const sockets = {} as Record<Face, Socket>
  for (const face of FACES) {
    const socket = string(rawSockets[face], `${path}.sockets.${face}`)
    if (!SOCKETS.has(socket)) throw new ProjectParseError(`unknown socket '${socket}'`, `${path}.sockets.${face}`)
    sockets[face] = socket as Socket
  }

  const cell: Cell = {
    module: string(doc['module'], `${path}.module`),
    heightCells: height,
    ceiling: ceiling as Cell['ceiling'],
    sockets,
  }
  // Optional fields are omitted rather than set to undefined, so a round trip
  // through JSON.stringify is byte-identical.
  if (doc['mergeGroup'] !== undefined) cell.mergeGroup = string(doc['mergeGroup'], `${path}.mergeGroup`)
  if (doc['paletteOverride'] !== undefined) {
    cell.paletteOverride = string(doc['paletteOverride'], `${path}.paletteOverride`)
  }
  if (doc['note'] !== undefined) cell.note = string(doc['note'], `${path}.note`)
  return cell
}

function parsePalettes(raw: unknown, path: string): Project['palettes'] {
  const doc = object(raw, path)
  const palettes: Project['palettes'] = {}
  for (const [id, value] of Object.entries(doc)) {
    const palette = object(value, `${path}.${id}`)
    const blocks = object(palette['blocks'], `${path}.${id}.blocks`)
    palettes[id] = {
      id: string(palette['id'], `${path}.${id}.id`),
      name: string(palette['name'], `${path}.${id}.name`),
      blocks: {
        floor: string(blocks['floor'], `${path}.${id}.blocks.floor`),
        wall: string(blocks['wall'], `${path}.${id}.blocks.wall`),
        ceiling: string(blocks['ceiling'], `${path}.${id}.blocks.ceiling`),
        accent: string(blocks['accent'], `${path}.${id}.blocks.accent`),
        trim: string(blocks['trim'], `${path}.${id}.blocks.trim`),
        light: string(blocks['light'], `${path}.${id}.blocks.light`),
      },
    }
  }
  return palettes
}

// --------------------------------------------------------------------------
// Field readers
// --------------------------------------------------------------------------

function object(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ProjectParseError(`expected an object, got ${describe(value)}`, path)
  }
  return value as Record<string, unknown>
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new ProjectParseError(`expected an array, got ${describe(value)}`, path)
  return value
}

function string(value: unknown, path: string): string {
  if (typeof value !== 'string') throw new ProjectParseError(`expected a string, got ${describe(value)}`, path)
  return value
}

function integer(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new ProjectParseError(`expected an integer, got ${describe(value)}`, path)
  }
  return value
}

function positiveInteger(value: unknown, path: string): number {
  const n = integer(value, path)
  if (n < 1) throw new ProjectParseError(`expected a positive integer, got ${n}`, path)
  return n
}

function describe(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'an array'
  return typeof value
}

// --------------------------------------------------------------------------
// Browser glue
// --------------------------------------------------------------------------

/** Slugged from the project name so downloads do not all collide. */
export function projectFilename(project: Project): string {
  const slug = project.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return `${slug || 'baywright-project'}.json`
}

/** Hand the serialised project to the browser as a download. */
export function downloadProject(project: Project): void {
  const blob = new Blob([serializeProject(project)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = projectFilename(project)
  anchor.click()
  URL.revokeObjectURL(url)
}
