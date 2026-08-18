/**
 * PRD §11 — the `.json` project export must round-trip, and must refuse
 * documents the geometry resolver would choke on.
 */
import { describe, expect, it } from 'vitest'

import {
  ProjectParseError,
  parseProject,
  projectFilename,
  serializeProject,
  validateProject,
} from '../src/export/json.js'
import { createProject } from '../src/stores/project.js'
import { bay, cell, level, project, sockets } from './factory.js'

describe('round trip', () => {
  it('survives serialise/parse unchanged', () => {
    const original = project([level('ground', 0, { A1: bay('fine'), B1: bay('coarse'), A2: bay('merged') })])
    expect(parseProject(serializeProject(original))).toEqual(original)
  })

  it('preserves the optional cell fields', () => {
    const original = project([
      level('ground', 0, {
        A1: bay('coarse', (index) =>
          index === 0
            ? { mergeGroup: 'g1', paletteOverride: 'dark-oak', note: 'the big hall', heightCells: 3 }
            : {},
        ),
      }),
    ])
    const round = parseProject(serializeProject(original))
    expect(round.levels[0]?.bays['A1']?.cells[0]).toEqual(original.levels[0]?.bays['A1']?.cells[0])
  })

  it('omits absent optional fields rather than writing null', () => {
    const round = parseProject(serializeProject(project([level('ground', 0, { A1: bay('merged') })])))
    expect(Object.keys(round.levels[0]!.bays['A1']!.cells[0]!).sort()).toEqual([
      'ceiling',
      'heightCells',
      'module',
      'sockets',
    ])
  })

  it('round-trips a freshly created project', () => {
    const original = createProject({ name: 'Deep Hall', bayCols: 4, bayRows: 2 })
    expect(parseProject(serializeProject(original))).toEqual(original)
  })

  it('sorts levels ascending by y on import (§6)', () => {
    const unsorted = project([
      level('upper', 24, { A1: bay('fine') }),
      level('ground', 0, { A1: bay('fine') }),
    ])
    expect(parseProject(JSON.stringify(unsorted)).levels.map((l) => l.y)).toEqual([0, 24])
  })
})

describe('defensive import', () => {
  const good = project([level('ground', 0, { A1: bay('fine') })])

  function mangle(change: (doc: ReturnType<typeof structuredClone<typeof good>>) => void): () => unknown {
    const doc = structuredClone(good)
    change(doc)
    return () => validateProject(doc)
  }

  it('rejects malformed JSON with the path', () => {
    expect(() => parseProject('{ nope')).toThrow(ProjectParseError)
    expect(() => parseProject('{ nope')).toThrow(/^\$:/)
  })

  it('rejects an unknown schemaVersion', () => {
    expect(mangle((doc) => ((doc as { schemaVersion: number }).schemaVersion = 2))).toThrow(/schemaVersion/)
  })

  it('rejects a bay whose cell count does not match its grain', () => {
    expect(mangle((doc) => doc.levels[0]!.bays['A1']!.cells.pop())).toThrow(/a fine bay holds 9 cells, got 8/)
  })

  it('rejects an unknown grain', () => {
    expect(mangle((doc) => ((doc.levels[0]!.bays['A1']!.grain as string) = 'chunky'))).toThrow(/unknown grain/)
  })

  it('rejects an unknown socket', () => {
    expect(mangle((doc) => ((doc.levels[0]!.bays['A1']!.cells[0]!.sockets.n as string) = 'gate'))).toThrow(
      /unknown socket 'gate'/,
    )
  })

  it('rejects a missing socket face', () => {
    expect(
      mangle((doc) => {
        delete (doc.levels[0]!.bays['A1']!.cells[0]!.sockets as Partial<Record<'up', string>>).up
      }),
    ).toThrow(/sockets\.up/)
  })

  it('rejects an out-of-range heightCells', () => {
    expect(mangle((doc) => ((doc.levels[0]!.bays['A1']!.cells[0]!.heightCells as number) = 4))).toThrow(
      /heightCells must be 1, 2 or 3/,
    )
  })

  it('rejects a malformed bay key', () => {
    expect(
      mangle((doc) => {
        doc.levels[0]!.bays['a1'] = bay('fine')
      }),
    ).toThrow(/malformed bay key 'a1'/)
  })

  it('rejects duplicate level ids', () => {
    expect(
      mangle((doc) => {
        doc.levels.push(level('ground', 24, { A1: bay('fine') }))
      }),
    ).toThrow(/duplicate level id/)
  })

  it('rejects a project with no levels', () => {
    expect(
      mangle((doc) => {
        doc.levels.length = 0
      }),
    ).toThrow(/at least one level/)
  })

  it('rejects a non-integer origin', () => {
    expect(mangle((doc) => (doc.origin.x = 1.5))).toThrow(/\$\.origin\.x/)
  })

  /**
   * §8 V6 is the validator's job, not the parser's: a misaligned level should
   * open with a visible error rather than fail to open at all.
   */
  it('accepts a misaligned level y and leaves it to V6', () => {
    const doc = structuredClone(good)
    doc.levels[0]!.y = 6
    expect(validateProject(doc).levels[0]?.y).toBe(6)
  })

  it('reports the path of the offending field', () => {
    const doc = structuredClone(good)
    doc.levels[0]!.bays['A1']!.cells[3] = { ...cell(), sockets: sockets() }
    delete (doc.levels[0]!.bays['A1']!.cells[3] as Partial<{ module: string }>).module
    try {
      validateProject(doc)
      expect.unreachable('should have thrown')
    } catch (error) {
      expect((error as ProjectParseError).path).toBe('$.levels[0].bays.A1.cells[3].module')
    }
  })
})

describe('filenames', () => {
  it('slugs the project name', () => {
    expect(projectFilename(project([], { name: 'Deep Hall — Phase 2' }))).toBe('deep-hall-phase-2.json')
  })

  it('falls back when the name has no usable characters', () => {
    expect(projectFilename(project([], { name: '—' }))).toBe('baywright-project.json')
  })
})
