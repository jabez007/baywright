/**
 * PRD §14 — acceptance test fixtures, validation half (F5–F8, F10).
 *
 * These assert against the V1/V2/V4 subset of §8 implemented so far.
 */
import { describe, expect, it } from 'vitest'
import { blockKey, cellAABB, cellPlenum, resolveBlocks, validMergeGroupIds } from '../src/domain/geometry.js'
import { validate, type Issue, type IssueId } from '../src/domain/validate.js'
import type { Cell, Project, Socket } from '../src/domain/types.js'
import { PALETTES } from '../src/domain/palettes.js'
import { cellFromModule } from '../src/domain/modules.js'
import { bayKeyOf } from '../src/domain/geometry.js'
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

  it('rejects a stairwell that climbs into a solid floor', () => {
    // The hall's spiral tops out by the east wall, but only the middle fine
    // cell of the landing opens its floor.
    const p = project([
      level('low', 0, { A1: bay('merged', () => cellFromModule('stair')) }),
      level('high', 8, { A1: bay('fine', (index) => (index === 4 ? { module: 'junction', sockets: sockets({ w: 'corridor', down: 'shaft' }) } : {})) }, { name: 'High' }),
    ])
    const issues = only(validate(p), 'V4')
    expect(issues).toHaveLength(1)
    expect(issues[0]!.message).toBe("Stair at A1 climbs into a solid floor in level 'High'")
    expect(issues[0]!.refs).toEqual([{ levelId: 'low', bayKey: 'A1', cellIndex: 0 }])
  })

  it('rises past a level that has nothing built over the shaft', () => {
    const p = project([
      level('lower', 0, { A1: bay('merged', () => ({ heightCells: 2, sockets: sockets({ up: 'shaft' }) })) }),
      level('elsewhere', 4, { C3: bay('merged') }),
      level('upper', 8, { A1: bay('merged', () => ({ sockets: sockets({ down: 'shaft' }) })) }),
    ])
    expect(only(validate(p), 'V4')).toEqual([])
  })

  describe('under a dropped ceiling', () => {
    const sealed = () =>
      project([
        level('lower', 0, {
          A1: bay('merged', () => ({ module: 'spine', heightCells: 2, ceiling: 'dropped', sockets: sockets({ up: 'shaft' }) })),
        }),
        level('upper', 8, { A1: bay('merged', () => ({ module: 'library', sockets: sockets({ down: 'shaft' }) })) }),
      ])

    it('rejects a shaft the plenum plane at y + 4 closes off', () => {
      const issues = only(validate(sealed()), 'V4')
      expect(issues).toHaveLength(1)
      expect(issues[0]!.message).toBe('Stair at A1 is sealed by its dropped ceiling at y 4')
      expect(resolveBlocks(sealed()).has(blockKey(6, 4, 6))).toBe(true)
    })

    it('does not let V3 climb through the sealed shaft', () => {
      const issues = only(validate(sealed()), 'V3')
      expect(issues).toHaveLength(1)
      expect(issues[0]!.refs).toEqual([{ levelId: 'upper', bayKey: 'A1', cellIndex: 0 }])
    })
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

  it('needs the two centred opening spans to overlap', () => {
    const p = project(
      [
        level('L1', 0, {
          A1: bay('fine', (index) =>
            index === 2 ? { module: 'spine', sockets: sockets({ e: 'corridor' }) } : {},
          ),
          B1: bay('merged', () => ({
            sockets: sockets({ w: 'corridor' }),
            openingWidths: { w: 5 },
          })),
        }),
      ],
      { bayCols: 2, bayRows: 1 },
    )

    expect(only(validate(p), 'V3').flatMap((issue) => issue.refs).some((ref) => ref.bayKey === 'B1')).toBe(true)
    delete p.levels[0]!.bays['B1']!.cells[0]!.openingWidths
    expect(only(validate(p), 'V3').flatMap((issue) => issue.refs).some((ref) => ref.bayKey === 'B1')).toBe(false)
  })

  it('reports the missing spine once when connectivity cannot be checked', () => {
    const issues = only(validate(row({}, {}, {})), 'V3')
    expect(issues).toHaveLength(1)
    expect(issues[0]!.message).toBe('Add a spine to check connectivity')
    // No cell is at fault, so the issue points at none of them.
    expect(issues[0]!.refs).toEqual([])
  })

  it('still reports the missing spine once across a stack, and pins it to no level', () => {
    const p = project([
      level('lower', 0, { A1: bay('merged') }),
      level('upper', 4, { A1: bay('merged') }),
    ])
    const issues = only(validate(p), 'V3')
    expect(issues).toHaveLength(1)
    expect(issues[0]!.message).toBe('Add a spine to check connectivity')
    // Refs spanning levels is what the issue list cannot navigate, so there are
    // none, and no `levelId` either — the whole project is missing a spine.
    expect(issues[0]!.refs).toEqual([])
    expect(issues[0]!.levelId).toBeUndefined()
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

  describe('beside a taller room on a lower level', () => {
    /** A1 is a three-cell-tall spine at y 0; B1 is a one-cell balcony at y 8. */
    const balcony = (tall: Socket, high: Socket): Project =>
      project(
        [
          level('low', 0, {
            A1: bay('merged', () => ({ module: 'spine', heightCells: 3, sockets: sockets({ e: tall }) })),
          }),
          level('high', 8, { B1: bay('merged', () => ({ sockets: sockets({ w: high }) })) }),
        ],
        { bayCols: 2, bayRows: 1 },
      )

    it('walks a doorway the two rooms share at balcony height', () => {
      const p = balcony('corridor', 'corridor')
      // The shared wall at x 12 is open at y 9 to 11, inside both rooms.
      expect(resolveBlocks(p).has(blockKey(12, 10, 6))).toBe(false)
      expect(only(validate(p), 'V3')).toEqual([])
    })

    it('does not walk openings that sit at different heights', () => {
      // The arch opens y 1 and 2 of the tall room, below the balcony floor.
      const p = balcony('arch', 'corridor')
      expect(resolveBlocks(p).has(blockKey(12, 10, 6))).toBe(true)
      expect(only(validate(p), 'V3').map((issue) => issue.refs[0]!.bayKey)).toEqual(['B1'])
    })
  })

  it('walks a valid merge group whose members kept their default solid sockets', () => {
    const p = row(
      { module: 'spine', sockets: sockets({ e: 'corridor' }) },
      { mergeGroup: 'r1', sockets: sockets({ w: 'corridor' }) },
      { mergeGroup: 'r1' },
    )
    // The exporter carves the B1/C1 seam away, so the two are one room.
    expect(resolveBlocks(p).has(blockKey(24, 3, 6))).toBe(false)
    expect(only(validate(p), 'V7')).toHaveLength(0)
    expect(only(validate(p), 'V3')).toHaveLength(0)
  })

  it('does not open a seam for a merge group the exporter refuses to carve', () => {
    const p = row(
      { module: 'spine', sockets: sockets({ e: 'corridor' }) },
      { mergeGroup: 'r1', sockets: sockets({ w: 'corridor' }) },
      { mergeGroup: 'r1', heightCells: 2 },
    )
    // Mixed heights: V7 rejects the group, the seam stands, sockets still rule.
    expect(resolveBlocks(p).has(blockKey(24, 3, 6))).toBe(true)
    expect(only(validate(p), 'V7')).toHaveLength(1)
    expect(only(validate(p), 'V3')).toHaveLength(1)
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

  it('routes a plenum through a valid merge group with default solid sockets', () => {
    const p = strip({ B1: plenumCell({ mergeGroup: 'r1' }), C1: plenumCell({ mergeGroup: 'r1' }) }, 3)
    // The carved seam is the opening; the sockets never had to describe it.
    expect(resolveBlocks(p).has(blockKey(24, 6, 6))).toBe(false)
    expect(only(validate(p), 'V7')).toHaveLength(0)
    expect(only(validate(p), 'V5')).toHaveLength(0)
  })

  it('agrees with the block map at every socket, width, and grain seam', () => {
    const faces: Socket[] = ['solid', 'corridor', 'arch', 'window', 'bars']
    for (const grain of ['merged', 'coarse', 'fine'] as const) {
      for (const east of faces) {
        for (const west of faces) {
          for (const width of ['full', 3, 5] as const) {
            const p = project(
              [
                level('L1', 0, {
                  A1: bay('merged', () =>
                    plenumCell({ module: 'spine', sockets: sockets({ e: east }), openingWidths: { e: width } }),
                  ),
                  B1: bay(grain, () => plenumCell({ sockets: sockets({ w: west }) })),
                }),
              ],
              { bayCols: 2, bayRows: 1 },
            )
            // A B1 cell reaches the spine when the shared plane at x 12 has
            // air somewhere across its plenum.
            const blocks = resolveBlocks(p)
            const cells = p.levels[0]!.bays['B1']!.cells
            let reached = 0
            cells.forEach((_, cellIndex) => {
              const ref = { levelId: 'L1', bayKey: 'B1', cellIndex }
              if (cellAABB(p, ref).x0 !== 12) return
              const plenum = cellPlenum(p, ref)!
              for (let y = plenum.y0; y <= plenum.y1; y++) {
                for (let z = plenum.z0; z <= plenum.z1; z++) {
                  if (!blocks.has(blockKey(12, y, z))) {
                    reached++
                    return
                  }
                }
              }
            })
            const islands = only(validate(p), 'V5')
            expect(islands.flatMap((issue) => issue.refs), `${grain} e:${east} w:${west} width:${width}`).toHaveLength(
              cells.length - reached,
            )
          }
        }
      }
    }
  })

  it('still requires an opening when the merge group is invalid', () => {
    const p = strip({ B1: plenumCell({ mergeGroup: 'r1' }), C1: plenumCell({ mergeGroup: 'r1', ceiling: 'flat' }) }, 3)
    // Mixed ceilings: nothing is carved, and C1 has no plenum of its own.
    expect(resolveBlocks(p).has(blockKey(24, 6, 6))).toBe(true)
    expect(only(validate(p), 'V7')).toHaveLength(1)
    expect(only(validate(p), 'V5')).toHaveLength(0)
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

  /**
   * The exporter carves a group's shared walls, and V3/V5 treat those seams as
   * open, so both must agree with V7 about which groups qualify. Duplicated
   * copies of that condition are what let them disagree in the first place.
   */
  it("carves exactly the groups V7 accepts", () => {
    const cases: [string, Project][] = [
      ['contiguous pair', merged([0, 1])],
      ['2x2 square', merged([0, 1, 3, 4])],
      ['gap between members', merged([0, 2])],
      ['L shape', merged([0, 1, 3])],
      ['mixed heights', merged([0, 1], (index) => ({ heightCells: index === 0 ? 1 : 2 }))],
      ['mixed ceilings', merged([0, 1], (index) => ({ heightCells: 2, ceiling: index === 0 ? 'flat' : 'dropped' }))],
    ]
    for (const [name, p] of cases) {
      const accepted = only(validate(p), 'V7').length === 0
      expect([name, validMergeGroupIds(p).has('g')]).toEqual([name, accepted])
    }
  })

  it('never carves a lone member, which V7 has nothing to reject', () => {
    const p = merged([0])
    expect(only(validate(p), 'V7')).toHaveLength(0)
    expect(validMergeGroupIds(p).has('g')).toBe(false)
  })
})

// --------------------------------------------------------------------------
// V8 — World build limits
// --------------------------------------------------------------------------

describe('V8 — world build limits', () => {
  it('accepts a stack that spans the whole overworld, -64 to 319', () => {
    const p = project([
      level('bottom', -64, { A1: bay('merged') }),
      level('top', 312, { A1: bay('merged', () => ({ heightCells: 1 })) }),
    ])
    // The top cell's ceiling plane sits at 316, inside the limit.
    expect(only(validate(p), 'V8')).toEqual([])
  })

  it('rejects a ceiling plane at y 320, one past the top block', () => {
    const p = project([level('roof', 312, { A1: bay('merged', () => ({ heightCells: 2 })) }, { name: 'Roof' })])
    const issues = only(validate(p), 'V8')
    expect(issues).toHaveLength(1)
    expect(issues[0]!.severity).toBe('error')
    expect(issues[0]!.message).toBe("Level 'Roof' builds up to y 320, above the world's top block at y 319")
    expect(issues[0]!.refs).toEqual([{ levelId: 'roof', bayKey: 'A1', cellIndex: 0 }])
    expect(issues[0]!.levelId).toBe('roof')
  })

  it('rejects a floor below bedrock level -64', () => {
    const p = project([level('deep', -68, { A1: bay('coarse') }, { name: 'Deep' })])
    const issues = only(validate(p), 'V8')
    expect(issues).toHaveLength(1)
    expect(issues[0]!.message).toBe("Level 'Deep' sits at y -68, below the world's bottom block at y -64")
    expect(issues[0]!.refs).toHaveLength(4)
  })

  it('names only the cells that cross the limit', () => {
    const p = project([
      level('roof', 312, { A1: bay('coarse', (index) => ({ heightCells: index === 0 ? 2 : 1 })) }),
    ])
    expect(only(validate(p), 'V8')[0]!.refs).toEqual([{ levelId: 'roof', bayKey: 'A1', cellIndex: 0 }])
  })
})

// --------------------------------------------------------------------------
// Unbuilt cells
// --------------------------------------------------------------------------

describe('empty cells are unbuilt', () => {
  const empty = () => ({ module: 'empty' })

  it('cannot collide with the level above (V1)', () => {
    const p = project([
      level('lower', 16, { A1: bay('merged', () => ({ module: 'empty', heightCells: 3 })) }),
      level('upper', 24, { A1: bay('merged') }),
    ])
    expect(only(validate(p), 'V1')).toEqual([])
  })

  it('need no path to a spine (V3)', () => {
    const p = project([
      level('L', 0, {
        A1: bay('merged', () => ({ module: 'spine', sockets: sockets({ e: 'corridor' }) })),
        B1: bay('merged', empty),
      }),
    ])
    expect(only(validate(p), 'V3')).toEqual([])
  })

  it('do not catch a stair rising through them (V4)', () => {
    const p = project([
      level('lower', 0, { A1: bay('merged', () => ({ heightCells: 2, sockets: sockets({ up: 'shaft' }) })) }),
      level('cleared', 4, { A1: bay('merged', empty) }),
      level('upper', 8, { A1: bay('merged', () => ({ sockets: sockets({ down: 'shaft' }) })) }),
    ])
    expect(only(validate(p), 'V4')).toEqual([])
  })

  it('cannot cross the world limits (V8)', () => {
    const p = project([level('roof', 316, { A1: bay('merged', empty) })])
    expect(only(validate(p), 'V8')).toEqual([])
  })
})

// --------------------------------------------------------------------------
// V9 — Dark floors
// --------------------------------------------------------------------------

describe('V9 — dark floors', () => {
  /** A one-bay room whose level palette uses `light` as its light block. */
  const litBy = (light: string, overrides: Partial<Cell> = {}) => {
    const p = project([level('ground', 0, { A1: bay('merged', () => overrides) }, { name: 'Ground' })])
    p.palettes = { ...p.palettes, 'stone-brick': { ...p.palettes['stone-brick']!, blocks: { ...p.palettes['stone-brick']!.blocks, light } } }
    return p
  }

  it('counts every floor block a mob could spawn on when the light gives none', () => {
    // A copper bulb is unlit until a redstone pulse turns it on.
    const issues = only(validate(litBy('minecraft:copper_bulb')), 'V9')
    expect(issues).toHaveLength(1)
    expect(issues[0]!.severity).toBe('warning')
    expect(issues[0]!.message).toBe(
      "Level 'Ground' has 121 dark floor blocks where mobs can spawn. Its palette light minecraft:copper_bulb gives no light",
    )
    expect(issues[0]!.refs).toEqual([{ levelId: 'ground', bayKey: 'A1', cellIndex: 0 }])
    expect(issues[0]!.levelId).toBe('ground')
  })

  it('lights a plain room in every shipped palette', () => {
    for (const paletteId of Object.keys(PALETTES)) {
      const p = project([level('ground', 0, { A1: bay('merged') }, { paletteId })])
      expect(only(validate(p), 'V9'), paletteId).toEqual([])
      // One light hangs under the ceiling at the room centre.
      expect(resolveBlocks(p).get(blockKey(6, 3, 6)), paletteId).toBe(PALETTES[paletteId]!.blocks.light)
    }
  })

  it('lowers the light on a chain so a tall room has no dark floor', () => {
    const p = project([level('ground', 0, { A1: bay('merged', () => ({ heightCells: 2 })) })])
    const blocks = resolveBlocks(p)
    expect(only(validate(p), 'V9')).toEqual([])
    expect(blocks.get(blockKey(6, 4, 6))).toBe('minecraft:lantern[hanging=true]')
    for (const y of [5, 6, 7]) expect(blocks.get(blockKey(6, y, 6))).toBe('minecraft:chain')
  })

  it('lights the plenum above a dropped ceiling as well as the room', () => {
    const p = project([level('ground', 0, { A1: bay('merged', () => ({ heightCells: 2, ceiling: 'dropped' })) })])
    const blocks = resolveBlocks(p)
    expect(only(validate(p), 'V9')).toEqual([])
    expect(blocks.get(blockKey(6, 3, 6))).toBe('minecraft:lantern[hanging=true]')
    expect(blocks.get(blockKey(6, 7, 6))).toBe('minecraft:lantern[hanging=true]')
  })

  it('lets one light serve the neighbours it reaches through doorways', () => {
    // Nine 3x3 rooms joined by full-width doorways. The first light, in the
    // north-west room, reaches every floor but the far east column's.
    const inner = (index: number): Partial<Cell> => {
      const a = index % 3
      const b = Math.floor(index / 3)
      const open = (edge: boolean): Socket => (edge ? 'solid' : 'corridor')
      return { sockets: sockets({ w: open(a === 0), e: open(a === 2), n: open(b === 0), s: open(b === 2) }) }
    }
    const p = project([level('ground', 0, { A1: bay('fine', inner) })])
    const lamps = [...resolveBlocks(p)].filter(([, id]) => id === 'minecraft:lantern[hanging=true]').map(([at]) => at)
    expect(only(validate(p), 'V9')).toEqual([])
    expect(lamps.sort()).toEqual([blockKey(10, 3, 6), blockKey(2, 3, 2)].sort())
  })

  it('lights a stair shaft from the landing it climbs to', () => {
    // A lamp in the room north of the landing lights the landing, but not
    // the far side of the stair 10 blocks below it.
    const p = project([
      level('lower', 0, {
        A1: bay('fine', (index) => (index === 4 ? { heightCells: 2, sockets: sockets({ up: 'shaft' }) } : { module: 'empty' })),
      }),
      level('upper', 8, {
        A1: bay('fine', (index) =>
          index === 1
            ? { sockets: sockets({ s: 'corridor' }) }
            : index === 4
              ? { sockets: sockets({ n: 'corridor', down: 'shaft' }) }
              : { module: 'empty' }),
      }),
    ])
    expect(only(validate(p), 'V9')).toEqual([])
    expect(resolveBlocks(p).get(blockKey(6, 11, 6))).toBe('minecraft:lantern[hanging=true]')
  })
})

// --------------------------------------------------------------------------
// V10 — Portal links
// --------------------------------------------------------------------------

describe('V10 — portal links', () => {
  const portalBay = (grain: 'coarse' | 'merged' = 'merged') => bay(grain, () => cellFromModule('nether-portal'))
  const twoPortals = (i: number) =>
    project([level('L', 64, { A1: portalBay(), [bayKeyOf(i, 0)]: portalBay() }, { name: 'Ground' })], { bayCols: 8 })

  it('warns when two Nether sides would overlap', () => {
    // Bays 12 apart put their Nether openings at x -1..1 and 1..3.
    const issues = only(validate(twoPortals(1)), 'V10')
    expect(issues).toEqual([
      {
        id: 'V10',
        severity: 'warning',
        message: "The portals at A1 on level 'Ground' and B1 on level 'Ground' need Nether portals that would overlap",
        refs: [
          { levelId: 'L', bayKey: 'A1', cellIndex: 0 },
          { levelId: 'L', bayKey: 'B1', cellIndex: 0 },
        ],
      },
    ])
  })

  it('accepts portal rooms three bays apart', () => {
    expect(only(validate(twoPortals(3)), 'V10')).toEqual([])
  })

  it('names the cells of a split bay', () => {
    const p = project([level('L', 64, { A1: portalBay('coarse') }, { name: 'Ground' })])
    expect(only(validate(p), 'V10').map((issue) => issue.message)).toEqual([
      "The portals at A1 cell 1 on level 'Ground' and A1 cell 2 on level 'Ground' need Nether portals that would overlap",
      "The portals at A1 cell 3 on level 'Ground' and A1 cell 4 on level 'Ground' need Nether portals that would overlap",
    ])
  })

  it('accepts stacked portal rooms whose Nether sides keep their heights', () => {
    const p = project([level('L', 64, { A1: portalBay() }), level('M', 72, { A1: portalBay() })])
    expect(only(validate(p), 'V10')).toEqual([])
  })

  it('warns when coming back can land at the other portal room', () => {
    // From the far west of B1's Nether side, a player arrives at x 10, y 74,
    // z 4. A1's opening at x 7, y 68, z 6 is 49 away squared; B1's own at
    // x 17, y 74 is 53.
    const p = project([
      level('L', 64, { A1: portalBay() }, { name: 'Ground' }),
      level('M', 72, { B1: portalBay() }, { name: 'Upper' }),
    ])
    const issues = only(validate(p), 'V10')
    expect(issues.map((issue) => issue.message)).toEqual([
      "The Nether portal for B1 on level 'Upper' can lead back to the portal at A1 on level 'Ground'",
    ])
    expect(issues[0]!.refs).toEqual([
      { levelId: 'M', bayKey: 'B1', cellIndex: 0 },
      { levelId: 'L', bayKey: 'A1', cellIndex: 0 },
    ])
  })
})
