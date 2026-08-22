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

  it('rejects a shaft on a horizontal face', () => {
    expect(mangle((doc) => (doc.levels[0]!.bays['A1']!.cells[0]!.sockets.n = 'shaft'))).toThrow(/not valid on horizontal face/)
  })

  it('rejects a horizontal opening on a vertical face', () => {
    expect(mangle((doc) => (doc.levels[0]!.bays['A1']!.cells[0]!.sockets.up = 'corridor'))).toThrow(/not valid on vertical face/)
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

  it('normalizes a legacy height-1 dropped ceiling to flat', () => {
    const doc = structuredClone(good)
    const legacyCell = doc.levels[0]!.bays['A1']!.cells[0]!
    legacyCell.heightCells = 1
    legacyCell.ceiling = 'dropped'

    expect(validateProject(doc).levels[0]!.bays['A1']!.cells[0]).toEqual({
      ...legacyCell,
      ceiling: 'flat',
    })
    expect(legacyCell.ceiling).toBe('dropped')
  })

  it('preserves a legacy height-3 dropped ceiling and its plenum intent', () => {
    const doc = structuredClone(good)
    const legacyCell = doc.levels[0]!.bays['A1']!.cells[0]!
    legacyCell.heightCells = 3
    legacyCell.ceiling = 'dropped'

    expect(validateProject(doc).levels[0]!.bays['A1']!.cells[0]!.ceiling).toBe('dropped')
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

/**
 * A file on disk may be hand-edited or hostile. These are the cases where the
 * old importer let something through that later corrupted the document.
 */
describe('import boundary hardening', () => {
  it('refuses a bay outside the recorded field', () => {
    const doc = project([level('ground', 0, { A1: bay('fine'), D1: bay('fine') })])
    expect(() => validateProject(doc)).toThrow(ProjectParseError)
    expect(() => validateProject(doc)).toThrow(/bay 'D1' is outside the 3×3 field/)
  })

  it('refuses a bay below the recorded field', () => {
    const doc = project([level('ground', 0, { A1: bay('fine'), A4: bay('fine') })])
    expect(() => validateProject(doc)).toThrow(/outside the 3×3 field/)
  })

  it('accepts a bay on the far edge of the field', () => {
    const doc = project([level('ground', 0, { C3: bay('fine') })])
    expect(Object.keys(validateProject(doc).levels[0]!.bays)).toEqual(['C3'])
  })

  it('checks against the field the file declares, not the default', () => {
    const wide = project([level('ground', 0, { F1: bay('fine') })], { bayCols: 6, bayRows: 1 })
    expect(Object.keys(validateProject(wide).levels[0]!.bays)).toEqual(['F1'])
  })

  it('refuses field dimensions above the supported cap', () => {
    expect(() => validateProject(project([level('ground', 0, { A1: bay('fine') })], { bayCols: 9 }))).toThrow(
      /bayCols.*at most 8/,
    )
    expect(() => validateProject(project([level('ground', 0, { A1: bay('fine') })], { bayRows: 9 }))).toThrow(
      /bayRows.*at most 8/,
    )
  })

  it('accepts palette references from the file or the shipped palettes', () => {
    const custom = createProject().palettes['stone-brick']!
    const doc = project(
      [
        level('ground', 0, {
          A1: bay('fine', (index) => (index === 0 ? { paletteOverride: 'stone-brick' } : {})),
        }, { paletteId: 'custom' }),
      ],
      { palettes: { custom: { ...custom, id: 'custom', name: 'Custom' } } },
    )

    expect(validateProject(doc).levels[0]!.paletteId).toBe('custom')
  })

  it('refuses dangling level and cell palette references', () => {
    const missingLevel = project(
      [level('ground', 0, { A1: bay('fine') }, { paletteId: 'missing' })],
      { palettes: {} },
    )
    expect(() => validateProject(missingLevel)).toThrow(/paletteId.*unknown palette 'missing'/)

    const missingCell = project(
      [level('ground', 0, { A1: bay('fine', (index) => (index === 0 ? { paletteOverride: 'missing' } : {})) })],
      { palettes: {} },
    )
    expect(() => validateProject(missingCell)).toThrow(/paletteOverride.*unknown palette 'missing'/)
  })

  it('refuses a palette whose id differs from its map key', () => {
    const doc = structuredClone(createProject())
    doc.palettes['stone-brick']!.id = 'not-stone-brick'
    expect(() => validateProject(doc)).toThrow(/palettes\.stone-brick\.id.*must match map key 'stone-brick'/)
  })

  it('refuses a __proto__ palette id rather than swapping the map prototype', () => {
    // Built as text: assigning `__proto__` in JS runs the setter before the
    // value ever reaches JSON, so the key has to arrive through JSON.parse.
    const text = serializeProject(createProject())
    const entry =
      '"__proto__": {"id":"x","name":"x","blocks":' +
      '{"floor":"a","wall":"a","ceiling":"a","accent":"a","trim":"a","light":"a"}},'
    const injected = text.replace('"palettes": {', `"palettes": {${entry}`)
    expect(injected).not.toEqual(text)
    expect(() => parseProject(injected)).toThrow(/reserved palette id/)
  })

  it('leaves an ordinary palette id alone', () => {
    const parsed = parseProject(serializeProject(createProject()))
    expect(Object.getPrototypeOf(parsed.palettes)).toBe(Object.prototype)
    expect(Object.keys(parsed.palettes).length).toBeGreaterThan(0)
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
