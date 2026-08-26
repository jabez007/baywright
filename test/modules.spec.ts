/**
 * PRD §5.5 — module presets.
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MODULE_ID,
  MODULES,
  MODULE_IDS,
  MODULE_LIST,
  SPINE_MODULE_ID,
  categoryOf,
  cellFromModule,
  getModule,
} from '../src/domain/modules.js'
import { validate } from '../src/domain/validate.js'
import type { Face } from '../src/domain/types.js'
import { bay, level, project } from './factory.js'

const SHIPPED = [
  'corridor',
  'junction',
  'stair',
  'spine',
  'storage',
  'library',
  'arena',
  'vault',
  'prison-cell',
  'workshop',
  'farm',
  'plenum-access',
  'vestibule',
  'empty',
]

const FACES: Face[] = ['n', 'e', 's', 'w', 'up', 'down']

describe('the shipped presets', () => {
  it('are exactly the fourteen the PRD lists', () => {
    expect([...MODULE_IDS].sort()).toEqual([...SHIPPED].sort())
  })

  it('agree between the list, the record and the ids', () => {
    expect(MODULE_LIST).toHaveLength(SHIPPED.length)
    for (const module of MODULE_LIST) expect(MODULES[module.id]).toBe(module)
  })

  it('give every module all six faces and a legal height', () => {
    for (const module of MODULE_LIST) {
      expect(Object.keys(module.sockets).sort()).toEqual([...FACES].sort())
      expect([1, 2, 3]).toContain(module.heightCells)
    }
  })

  it('never drops a ceiling on a cell too short to hold a plenum', () => {
    for (const module of MODULE_LIST) {
      if (module.ceiling === 'dropped') expect(module.heightCells).toBe(2)
    }
  })

  it('only puts a shaft on a vertical face (§5.4)', () => {
    for (const module of MODULE_LIST) {
      for (const face of ['n', 'e', 's', 'w'] as const) {
        expect(module.sockets[face]).not.toBe('shaft')
      }
      for (const face of ['up', 'down'] as const) {
        expect(['solid', 'shaft']).toContain(module.sockets[face])
      }
    }
  })

  it('starts every cell as empty', () => {
    expect(DEFAULT_MODULE_ID).toBe('empty')
    expect(MODULES[DEFAULT_MODULE_ID]!.sockets).toEqual({
      n: 'solid',
      e: 'solid',
      s: 'solid',
      w: 'solid',
      up: 'solid',
      down: 'solid',
    })
  })
})

describe('categories', () => {
  it('covers all four canvas fills (§10)', () => {
    expect(new Set(MODULE_LIST.map((module) => module.category))).toEqual(
      new Set(['circulation', 'room', 'service', 'storage']),
    )
  })

  it('falls back to room for a module this build has never heard of', () => {
    expect(categoryOf('handmade-thing')).toBe('room')
    expect(categoryOf('spine')).toBe('circulation')
  })
})

describe('cellFromModule', () => {
  it('fills in the preset', () => {
    expect(cellFromModule('library')).toEqual({
      module: 'library',
      heightCells: 2,
      ceiling: 'flat',
      sockets: { n: 'arch', e: 'solid', s: 'solid', w: 'solid', up: 'solid', down: 'solid' },
    })
  })

  it('gives every cell its own sockets object', () => {
    const a = cellFromModule('corridor')
    const b = cellFromModule('corridor')
    a.sockets.e = 'corridor'
    expect(b.sockets.e).toBe('solid')
    expect(MODULES['corridor']!.sockets.e).toBe('solid')
  })

  it('takes overrides, including partial sockets', () => {
    const cell = cellFromModule('storage', { heightCells: 3, note: 'wool only', sockets: { e: 'corridor' } })
    expect(cell.heightCells).toBe(3)
    expect(cell.note).toBe('wool only')
    expect(cell.sockets.e).toBe('corridor')
    expect(cell.sockets.n).toBe('corridor') // still from the preset
  })

  it('will not let an override rename the module', () => {
    expect(cellFromModule('vault', { module: 'corridor' }).module).toBe('vault')
  })

  it('throws on an unknown id', () => {
    expect(() => cellFromModule('cathedral')).toThrow(/no module 'cathedral'/)
    expect(getModule('cathedral')).toBeUndefined()
  })
})

describe('presets against the validator', () => {
  it('produces only the expected orphan-shaft error when painted on its own', () => {
    for (const id of MODULE_IDS) {
      const p = project([level('L1', 0, { A1: bay('merged', () => cellFromModule(id)) })])
      const errors = validate(p).filter((issue) => issue.severity === 'error')
      expect(errors.map((issue) => issue.id), `${id} should satisfy its local invariants`).toEqual(id === 'stair' ? ['V4'] : [])
    }
  })

  it('anchors the connectivity flood-fill on the spine preset', () => {
    const p = project(
      [
        level('L1', 0, {
          A1: bay('merged', () => cellFromModule(SPINE_MODULE_ID)),
          B1: bay('merged', () => cellFromModule('storage', { sockets: { w: 'corridor' } })),
        }),
      ],
      { bayCols: 2, bayRows: 1 },
    )
    expect(validate(p).filter((issue) => issue.id === 'V3')).toEqual([])
  })

  it('carries a plenum on the spine, which anchors plenum reachability', () => {
    const p = project(
      [
        level('L1', 0, {
          A1: bay('merged', () => cellFromModule(SPINE_MODULE_ID)),
          B1: bay('merged', () => cellFromModule('plenum-access', { sockets: { w: 'corridor' } })),
        }),
      ],
      { bayCols: 2, bayRows: 1 },
    )
    expect(validate(p).filter((issue) => issue.id === 'V5')).toEqual([])
  })

  it('flags a stair whose upper cell has no matching shaft', () => {
    const p = project([
      level('lower', 0, { A1: bay('merged', () => cellFromModule('stair')) }),
      level('upper', 8, { A1: bay('merged', () => cellFromModule('corridor')) }),
    ])
    expect(validate(p).filter((issue) => issue.id === 'V4')).toHaveLength(1)
  })

  it('clears once the cell above opens its shaft down', () => {
    const p = project([
      level('lower', 0, { A1: bay('merged', () => cellFromModule('stair')) }),
      level('upper', 8, {
        A1: bay('merged', () => cellFromModule('stair', { sockets: { up: 'solid', down: 'shaft' } })),
      }),
    ])
    expect(validate(p).filter((issue) => issue.id === 'V4')).toEqual([])
  })
})
