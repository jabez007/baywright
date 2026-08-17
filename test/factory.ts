/**
 * Small builders so the §14 acceptance fixtures read as the PRD writes them.
 */
import { PALETTES } from '../src/domain/palettes.js'
import { cellCount, type Bay, type Cell, type Face, type Grain, type Level, type Project, type Socket } from '../src/domain/types.js'

/** All six faces solid unless overridden. */
export function sockets(overrides: Partial<Record<Face, Socket>> = {}): Record<Face, Socket> {
  return { n: 'solid', e: 'solid', s: 'solid', w: 'solid', up: 'solid', down: 'solid', ...overrides }
}

export function cell(overrides: Partial<Cell> = {}): Cell {
  return { module: 'empty', heightCells: 1, ceiling: 'flat', sockets: sockets(), ...overrides }
}

/** A bay filled with the right number of cells for its grain. */
export function bay(grain: Grain, make: (index: number) => Partial<Cell> = () => ({})): Bay {
  return {
    grain,
    cells: Array.from({ length: cellCount(grain) }, (_, index) => cell(make(index))),
  }
}

export function level(id: string, y: number, bays: Record<string, Bay>, overrides: Partial<Level> = {}): Level {
  return { id, y, name: id, paletteId: 'stone-brick', bays, ...overrides }
}

export function project(levels: Level[], overrides: Partial<Project> = {}): Project {
  return {
    schemaVersion: 1,
    id: 'test-project',
    name: 'Test Project',
    origin: { x: 0, z: 0 },
    bayCols: 3,
    bayRows: 3,
    levels,
    palettes: { ...PALETTES },
    ...overrides,
  }
}
