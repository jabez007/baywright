/**
 * PRD §14 — acceptance test fixtures, validation half (F5–F8, F10).
 *
 * These assert against the V1/V2/V4 subset of §8 implemented so far.
 */
import { describe, expect, it } from 'vitest'
import { blockKey, resolveBlocks } from '../src/domain/geometry.js'
import { validate, type Issue, type IssueId } from '../src/domain/validate.js'
import type { Cell, Project, Socket } from '../src/domain/types.js'
import { bay, level, project, sockets } from './factory.js'

const only = (issues: Issue[], id: IssueId) => issues.filter((issue) => issue.id === id)

describe('F5 — collision detected', () => {
  const p: Project = project([
    level('lower', 16, { A1: bay('merged', () => ({ heightCells: 3 })) }, { name: 'Lower' }),
    level('upper', 24, { A1: bay('merged', () => ({ heightCells: 1 })) }, { name: 'Upper' }),
  ])

  it("reports one V1 error: the lower vault's top of 28 punches past y 24", () => {
    const issues = only(validate(p), 'V1')
    expect(issues).toHaveLength(1)
    expect(issues[0]!.severity).toBe('error')
    expect(issues[0]!.message).toBe("A1 vault at y 16 reaches y 28 — collides with level 'Upper' at y 24")
  })

  it('names both cells so the UI can highlight them', () => {
    expect(only(validate(p), 'V1')[0]!.refs).toEqual([
      { levelId: 'lower', bayKey: 'A1', cellIndex: 0 },
      { levelId: 'upper', bayKey: 'A1', cellIndex: 0 },
    ])
  })
})

describe('F6 — no false collision', () => {
  const p: Project = project([
    level('lower', 16, { A1: bay('merged', () => ({ heightCells: 2 })) }),
    level('upper', 24, { A1: bay('merged', () => ({ heightCells: 1 })) }),
  ])

  it('treats touching at exactly one shared plane as legal', () => {
    expect(only(validate(p), 'V1')).toEqual([])
  })
})

/** Bay A1 fine, bay B1 coarse — a seam along A1's east face. */
function seamProject(fineCellIndex: number, socket: 'corridor' | 'window', coarsePartner: 'coarse' | 'merged' = 'coarse'): Project {
  return project(
    [
      level('L1', 0, {
        A1: bay('fine', (index) => (index === fineCellIndex ? { sockets: sockets({ e: socket }) } : {})),
        B1: bay(coarsePartner),
      }),
    ],
    { bayCols: 2, bayRows: 1 },
  )
}

describe('F7 — grain seam, legal', () => {
  it('lets the outer fine cell carry a full corridor onto the seam', () => {
    expect(only(validate(seamProject(2, 'corridor')), 'V2')).toHaveLength(0)
  })
})

describe('F8 — grain seam, illegal', () => {
  it('rejects a corridor on the middle fine cell', () => {
    const issues = only(validate(seamProject(5, 'corridor')), 'V2')
    expect(issues).toHaveLength(1)
    expect(issues[0]!.severity).toBe('error')
    expect(issues[0]!.refs[0]).toEqual({ levelId: 'L1', bayKey: 'A1', cellIndex: 5 })
  })

  it('rejects a window on the middle fine cell too', () => {
    expect(only(validate(seamProject(5, 'window')), 'V2')).toHaveLength(1)
  })

  it('clears once the coarse bay is converted to merged grain', () => {
    expect(only(validate(seamProject(5, 'corridor', 'merged')), 'V2')).toHaveLength(0)
  })
})

describe('F10 — stair continuity', () => {
  const stairProject = (upperY: number): Project =>
    project([
      level('lower', 24, {
        A1: bay('merged', () => ({ heightCells: 2, sockets: sockets({ up: 'shaft' }) })),
      }),
      level('upper', upperY, {
        A1: bay('merged', () => ({ heightCells: 1, sockets: sockets({ down: 'shaft' }) })),
      }),
    ])

  it('accepts a rise of 8 under a heightCells = 2 cell', () => {
    expect(only(validate(stairProject(32)), 'V4')).toEqual([])
  })

  it('rejects a rise that does not match the level gap', () => {
    const issues = only(validate(stairProject(36)), 'V4')
    expect(issues).toHaveLength(1)
    expect(issues[0]!.message).toBe('Stair at A1 rises 8 but the level above is 12 higher')
  })

  it('rejects a level above with no matching shaft', () => {
    const p = project([
      level('lower', 24, { A1: bay('merged', () => ({ heightCells: 2, sockets: sockets({ up: 'shaft' }) })) }),
      level('upper', 32, { A1: bay('merged', () => ({ heightCells: 1 })) }),
    ])
    expect(only(validate(p), 'V4')).toHaveLength(1)
  })

  it('rejects an upward shaft with no next level', () => {
    const p = project([
      level('roof', 24, { A1: bay('merged', () => ({ heightCells: 2, sockets: sockets({ up: 'shaft' }) })) }),
    ])
    expect(only(validate(p), 'V4')).toHaveLength(1)
  })

  it('rejects an upward shaft when the next level has no matching bay', () => {
    const p = project([
      level('lower', 0, { A1: bay('merged', () => ({ heightCells: 2, sockets: sockets({ up: 'shaft' }) })) }),
      level('upper', 8, { B1: bay('merged') }),
    ])
    expect(only(validate(p), 'V4')).toHaveLength(1)
  })

  it('rejects an upward shaft when no cell above overlaps it', () => {
    const p = project([
      level('lower', 0, { A1: bay('fine', (index) => (index === 0 ? { heightCells: 2, sockets: sockets({ up: 'shaft' }) } : {})) }),
      level('upper', 8, { A1: bay('fine', () => ({ sockets: sockets() })) }),
    ])
    p.levels[1]!.bays['A1']!.cells = []
    expect(only(validate(p), 'V4')).toHaveLength(1)
  })
})

// --------------------------------------------------------------------------
// V3 — Connectivity
// --------------------------------------------------------------------------

describe('V3 — connectivity', () => {
  /** Three merged bays in a row: A1 (x 0..12), B1 (12..24), C1 (24..36). */
  const row = (a: Partial<Cell>, b: Partial<Cell>, c: Partial<Cell>): Project =>
    project([level('L1', 0, { A1: bay('merged', () => a), B1: bay('merged', () => b), C1: bay('merged', () => c) })], {
      bayCols: 3,
      bayRows: 1,
    })

  it('reports the cell a spine cannot reach', () => {
    const p = row(
      { module: 'spine', sockets: sockets({ e: 'corridor' }) },
      { sockets: sockets({ w: 'corridor' }) },
      { sockets: sockets({ w: 'corridor' }) },
    )
    const issues = only(validate(p), 'V3')
    expect(issues).toHaveLength(1)
    expect(issues[0]!.severity).toBe('warning')
    expect(issues[0]!.message).toBe('C1 cell 1 has no path to a spine')
  })

  it('stays quiet when every cell chains back to the spine', () => {
    const p = row(
      { module: 'spine', sockets: sockets({ e: 'corridor' }) },
      { sockets: sockets({ w: 'corridor', e: 'corridor' }) },
      { sockets: sockets({ w: 'corridor' }) },
    )
    expect(only(validate(p), 'V3')).toHaveLength(0)
  })

  it('does not treat a window as a path (§5.4)', () => {
    const p = row({ module: 'spine', sockets: sockets({ e: 'window' }) }, { sockets: sockets({ w: 'window' }) }, {})
    expect(only(validate(p), 'V3')).toHaveLength(2)
  })

  it('does not treat bars as a path', () => {
    const p = row({ module: 'spine', sockets: sockets({ e: 'bars' }) }, { sockets: sockets({ w: 'bars' }) }, {})
    expect(only(validate(p), 'V3')).toHaveLength(2)
  })

  it('needs both sides open, not just one', () => {
    const p = row({ module: 'spine', sockets: sockets({ e: 'corridor' }) }, {}, {})
    expect(only(validate(p), 'V3').map((issue) => issue.refs[0]!.bayKey)).toEqual(['B1', 'C1'])
  })

  it('reports the missing spine once when connectivity cannot be checked', () => {
    const issues = only(validate(row({}, {}, {})), 'V3')
    expect(issues).toHaveLength(1)
    expect(issues[0]!.message).toBe('Add a spine to check connectivity')
    expect(issues[0]!.refs).toHaveLength(3)
  })

  it('walks cells inside a bay, not just across bay seams', () => {
    const p = project([
      level('L1', 0, {
        A1: bay('fine', (index) => {
          if (index === 0) return { module: 'spine', sockets: sockets({ e: 'corridor' }) }
          if (index === 1) return { sockets: sockets({ w: 'corridor' }) }
          return {}
        }),
      }),
    ])
    // Cells 0 and 1 are joined; the other seven are sealed and grouped by bay.
    const issues = only(validate(p), 'V3')
    expect(issues).toHaveLength(1)
    expect(issues[0]!.refs).toHaveLength(7)
    expect(issues[0]!.message).toBe('7 cells in Bay A1 have no path to a spine')
  })

  it('walks a shaft between levels', () => {
    const stacked = (upperDown: Socket): Project =>
      project([
        level('lower', 0, {
          A1: bay('merged', () => ({ module: 'spine', heightCells: 2, sockets: sockets({ up: 'shaft' }) })),
        }),
        level('upper', 8, { A1: bay('merged', () => ({ sockets: sockets({ down: upperDown }) })) }),
      ])
    expect(only(validate(stacked('shaft')), 'V3')).toHaveLength(0)
    expect(only(validate(stacked('solid')), 'V3')).toHaveLength(1)
  })
})

// --------------------------------------------------------------------------
// V5 — Plenum reachability
// --------------------------------------------------------------------------

describe('V5 — plenum reachability', () => {
  const plenumCell = (overrides: Partial<Cell> = {}): Partial<Cell> => ({
    heightCells: 2,
    ceiling: 'dropped',
    ...overrides,
  })

  /** A1 is the spine; B1 onwards carry the plenums. */
  const strip = (bays: Record<string, Partial<Cell>>, bayCols: number): Project =>
    project(
      [
        level('L1', 0, {
          A1: bay('merged', () => plenumCell({ module: 'spine', sockets: sockets({ e: 'corridor' }) })),
          ...Object.fromEntries(
            Object.entries(bays).map(([key, proto]) => [
              key,
              bay('merged', () =>
                key === 'B1'
                  ? { ...proto, sockets: { ...sockets(), ...proto.sockets, w: 'corridor' } }
                  : proto,
              ),
            ]),
          ),
        }),
      ],
      { bayCols, bayRows: 1 },
    )

  it('reports a plenum walled off from the trunk', () => {
    const p = strip({ B1: plenumCell(), C1: plenumCell() }, 3)
    const issues = only(validate(p), 'V5')
    expect(issues).toHaveLength(1)
    expect(issues[0]!.severity).toBe('warning')
    expect(issues[0]!.message).toBe('Plenum island of 1 cell starting at C1 cell 1 has no route to a spine')
    expect(issues[0]!.levelId).toBe('L1')
  })

  it('stays quiet once the plenums share a non-solid wall', () => {
    const p = strip(
      { B1: plenumCell({ sockets: sockets({ e: 'corridor' }) }), C1: plenumCell({ sockets: sockets({ w: 'corridor' }) }) },
      3,
    )
    expect(only(validate(p), 'V5')).toHaveLength(0)
  })

  it('agrees with the block map about passable plenum openings', () => {
    const connected = project(
      [
        level('L1', 0, {
          A1: bay('merged', () => plenumCell({ module: 'spine', sockets: sockets({ e: 'window' }) })),
          B1: bay('merged', () => plenumCell({ sockets: sockets({ w: 'window' }) })),
        }),
      ],
      { bayCols: 2, bayRows: 1 },
    )
    const blocked = project(
      [
        level('L1', 0, {
          A1: bay('merged', () => plenumCell({ module: 'spine', sockets: sockets({ e: 'bars' }) })),
          B1: bay('merged', () => plenumCell({ sockets: sockets({ w: 'bars' }) })),
        }),
      ],
      { bayCols: 2, bayRows: 1 },
    )

    expect(resolveBlocks(connected).has(blockKey(12, 6, 6))).toBe(false)
    expect(only(validate(connected), 'V5')).toHaveLength(0)
    expect(resolveBlocks(blocked).has(blockKey(12, 6, 6))).toBe(true)
    expect(only(validate(blocked), 'V5')).toHaveLength(1)
  })

  it('groups an island rather than reporting each of its cells', () => {
    const p = strip(
      {
        B1: plenumCell(),
        C1: plenumCell({ sockets: sockets({ e: 'corridor' }) }),
        D1: plenumCell({ sockets: sockets({ w: 'corridor' }) }),
      },
      4,
    )
    const issues = only(validate(p), 'V5')
    expect(issues).toHaveLength(1)
    expect(issues[0]!.message).toBe('Plenum island of 2 cells starting at C1 cell 1 has no route to a spine')
    expect(issues[0]!.refs.map((ref) => ref.bayKey)).toEqual(['C1', 'D1'])
  })

  it('reports every island when no plenum touches the spine', () => {
    const p = strip({ B1: {}, C1: plenumCell() }, 3)
    expect(only(validate(p), 'V5')).toHaveLength(1)
  })

  it('reports plenums on a level with no spine', () => {
    const p = project(
      [level('L1', 0, { A1: bay('merged', () => plenumCell()), B1: bay('merged', () => plenumCell()) })],
      { bayCols: 2, bayRows: 1 },
    )
    const issues = only(validate(p), 'V5')
    expect(issues).toHaveLength(2)
    expect(issues.flatMap((issue) => issue.refs).map((ref) => ref.bayKey)).toEqual(['A1', 'B1'])
  })
})

// --------------------------------------------------------------------------
// V6 — Level y alignment
// --------------------------------------------------------------------------

describe('V6 — level y alignment', () => {
  const at = (y: number): Project => project([level('L1', y, { A1: bay('merged') })])

  it('rejects a level off the 4-block lattice', () => {
    const issues = only(validate(at(18)), 'V6')
    expect(issues).toHaveLength(1)
    expect(issues[0]!.severity).toBe('error')
    expect(issues[0]!.message).toBe("Level 'L1' sits at y 18, which is not a multiple of 4")
    expect(issues[0]!.levelId).toBe('L1')
    expect(issues[0]!.refs).toEqual([])
  })

  it('accepts multiples of 4, including below y 0', () => {
    expect(only(validate(at(0)), 'V6')).toHaveLength(0)
    expect(only(validate(at(24)), 'V6')).toHaveLength(0)
    expect(only(validate(at(-8)), 'V6')).toHaveLength(0)
  })

  it('rejects a non-integer y', () => {
    expect(only(validate(at(4.5)), 'V6')).toHaveLength(1)
  })
})

// --------------------------------------------------------------------------
// V7 — Merge group integrity
// --------------------------------------------------------------------------

describe('V7 — merge group integrity', () => {
  /** One fine bay A1; `group` names the cell indices that share a merge group. */
  const merged = (group: number[], per: (index: number) => Partial<Cell> = () => ({})): Project =>
    project([
      level('L1', 0, {
        A1: bay('fine', (index) => ({ ...per(index), ...(group.includes(index) ? { mergeGroup: 'g' } : {}) })),
      }),
    ])

  it('accepts a contiguous pair', () => {
    expect(only(validate(merged([0, 1])), 'V7')).toHaveLength(0)
  })

  it('accepts a 2x2 square', () => {
    expect(only(validate(merged([0, 1, 3, 4])), 'V7')).toHaveLength(0)
  })

  it('accepts a group that crosses a bay seam at the same grain', () => {
    const p = project(
      [
        level('L1', 0, {
          A1: bay('fine', (index) => (index === 2 ? { mergeGroup: 'g' } : {})),
          B1: bay('fine', (index) => (index === 0 ? { mergeGroup: 'g' } : {})),
        }),
      ],
      { bayCols: 2, bayRows: 1 },
    )
    expect(only(validate(p), 'V7')).toHaveLength(0)
  })

  it('rejects a gap between members', () => {
    const issues = only(validate(merged([0, 2])), 'V7')
    expect(issues).toHaveLength(1)
    expect(issues[0]!.message).toBe("Merge group 'g' is not a contiguous rectangle")
    expect(issues[0]!.refs.map((ref) => ref.cellIndex)).toEqual([0, 2])
  })

  it('rejects an L shape', () => {
    expect(only(validate(merged([0, 1, 3])), 'V7')).toHaveLength(1)
  })

  it('rejects mixed heights', () => {
    const issues = only(validate(merged([0, 1], (index) => ({ heightCells: index === 0 ? 1 : 2 }))), 'V7')
    expect(issues).toHaveLength(1)
    expect(issues[0]!.message).toBe("Merge group 'g' mixes heightCells 1 and 2 — merged cells must share a height")
  })

  it('rejects mixed ceilings', () => {
    const issues = only(
      validate(merged([0, 1], (index) => ({ heightCells: 2, ceiling: index === 0 ? 'flat' : 'dropped' }))),
      'V7',
    )
    expect(issues).toHaveLength(1)
    expect(issues[0]!.message).toBe("Merge group 'g' mixes dropped and flat ceilings — merged cells must share a ceiling")
  })

  it('rejects mixed grain, and does not then guess at a rectangle', () => {
    const p = project(
      [
        level('L1', 0, {
          A1: bay('fine', (index) => (index === 2 ? { mergeGroup: 'g' } : {})),
          B1: bay('coarse', (index) => (index === 0 ? { mergeGroup: 'g' } : {})),
        }),
      ],
      { bayCols: 2, bayRows: 1 },
    )
    const issues = only(validate(p), 'V7')
    expect(issues).toHaveLength(1)
    expect(issues[0]!.message).toBe("Merge group 'g' mixes coarse and fine grain — merged cells must share a grain")
  })

  it('rejects a group split across levels', () => {
    const p = project([
      level('L1', 0, { A1: bay('fine', (index) => (index === 0 ? { mergeGroup: 'g' } : {})) }),
      level('L2', 4, { A1: bay('fine', (index) => (index === 0 ? { mergeGroup: 'g' } : {})) }),
    ])
    const issues = only(validate(p), 'V7')
    expect(issues).toHaveLength(1)
    expect(issues[0]!.message).toBe("Merge group 'g' spans levels L1, L2 — a merge group is one room on one level")
  })
})
