/**
 * PRD §14 — acceptance test fixtures, geometry half (F1–F4, F9).
 */
import { describe, expect, it } from 'vitest'
import {
  blockKey,
  cellAABB,
  cellInterior,
  cellPlenum,
  interiorSpan,
  resolveBlocks,
  shellBlocks,
  volume,
} from '../src/domain/geometry.js'
import type { CellRef, Socket } from '../src/domain/types.js'
import { bay, level, project, sockets } from './factory.js'

/** Inclusive block count along one axis. */
const span = (lo: number, hi: number) => hi - lo + 1

describe('§5.2 interior spans', () => {
  it('matches the grain table', () => {
    expect(interiorSpan('fine', 0)).toEqual([1, 3])
    expect(interiorSpan('fine', 1)).toEqual([5, 7])
    expect(interiorSpan('fine', 2)).toEqual([9, 11])
    expect(interiorSpan('coarse', 0)).toEqual([1, 5])
    expect(interiorSpan('coarse', 1)).toEqual([7, 11])
    expect(interiorSpan('merged', 0)).toEqual([1, 11])
  })
})

describe('F1 — fine cell AABB', () => {
  const p = project([level('L1', 24, { A1: bay('fine', () => ({ heightCells: 1 })) })])
  const ref: CellRef = { levelId: 'L1', bayKey: 'A1', cellIndex: 4 }

  it('has the outer bounds from the fixture', () => {
    expect(cellAABB(p, ref)).toEqual({ x0: 4, y0: 24, z0: 4, x1: 8, y1: 28, z1: 8 })
  })

  it('has the interior bounds from the fixture', () => {
    expect(cellInterior(p, ref)).toEqual({ x0: 5, y0: 25, z0: 5, x1: 7, y1: 27, z1: 7 })
  })
})

describe('F2 — coarse cell AABB', () => {
  const p = project([level('L1', 24, { A1: bay('coarse', () => ({ heightCells: 2 })) })])
  const ref: CellRef = { levelId: 'L1', bayKey: 'A1', cellIndex: 3 }

  it('has the outer bounds from the fixture', () => {
    expect(cellAABB(p, ref)).toEqual({ x0: 6, y0: 24, z0: 6, x1: 12, y1: 32, z1: 12 })
  })

  it('is 7 blocks of interior height, y 25 to y 31', () => {
    const interior = cellInterior(p, ref)
    expect(interior.y0).toBe(25)
    expect(interior.y1).toBe(31)
    expect(span(interior.y0, interior.y1)).toBe(7)
  })
})

describe('F3 — merged bay', () => {
  const p = project([level('L1', 0, { B2: bay('merged', () => ({ heightCells: 3 })) })])
  const ref: CellRef = { levelId: 'L1', bayKey: 'B2', cellIndex: 0 }

  it('places the interior at world x 13..23 (bay B2 starts at x 12, local 1..11)', () => {
    const interior = cellInterior(p, ref)
    expect([interior.x0, interior.x1]).toEqual([13, 23])
    expect([interior.z0, interior.z1]).toEqual([13, 23])
  })

  it('is 11 blocks of interior height', () => {
    const interior = cellInterior(p, ref)
    expect(span(interior.y0, interior.y1)).toBe(11)
  })
})

describe('F4 — plenum', () => {
  const p = project([level('L1', 24, { A1: bay('fine', () => ({ heightCells: 2, ceiling: 'dropped' })) })])
  const ref: CellRef = { levelId: 'L1', bayKey: 'A1', cellIndex: 4 }

  it('puts the occupiable room at y 25..27', () => {
    const interior = cellInterior(p, ref)
    expect([interior.y0, interior.y1]).toEqual([25, 27])
  })

  it('puts the service plenum at y 29..31', () => {
    const plenum = cellPlenum(p, ref)
    expect(plenum).not.toBeNull()
    expect([plenum!.y0, plenum!.y1]).toEqual([29, 31])
  })

  it('inserts a solid ceiling plane at y 28', () => {
    const shell = shellBlocks(p, ref)
    const ceiling = shell.get('ceiling') ?? new Set<string>()
    const interior = cellInterior(p, ref)
    for (let z = interior.z0; z <= interior.z1; z++) {
      for (let x = interior.x0; x <= interior.x1; x++) {
        expect(ceiling.has(blockKey(x, 28, z))).toBe(true)
      }
    }
  })

  it('leaves the room and the plenum as air', () => {
    const occupied = new Set<string>()
    for (const coords of shellBlocks(p, ref).values()) for (const key of coords) occupied.add(key)
    expect(occupied.has(blockKey(6, 26, 6))).toBe(false) // room
    expect(occupied.has(blockKey(6, 30, 6))).toBe(false) // plenum
  })

  it('returns null for a cell with no dropped ceiling', () => {
    const flat = project([level('L1', 24, { A1: bay('fine', () => ({ heightCells: 2 })) })])
    expect(cellPlenum(flat, ref)).toBeNull()
  })

  it('preserves the seven-block plenum of a legacy height-3 schema-v1 cell', () => {
    const legacy = project([
      level('L1', 24, { A1: bay('fine', () => ({ heightCells: 3, ceiling: 'dropped' })) }),
    ])
    expect(cellPlenum(legacy, ref)).toEqual({ x0: 5, y0: 29, z0: 5, x1: 7, y1: 35, z1: 7 })
  })
})

describe('F9 — shell dedup', () => {
  const p = project([
    level('L1', 0, { A1: bay('merged', () => ({ heightCells: 2, ceiling: 'flat', sockets: sockets() })) }),
  ])
  const ref: CellRef = { levelId: 'L1', bayKey: 'A1', cellIndex: 0 }

  it('has a 13 x 9 x 13 outer volume of 1521', () => {
    expect(volume(cellAABB(p, ref))).toBe(1521)
  })

  it('has an 11 x 7 x 11 interior volume of 847', () => {
    expect(volume(cellInterior(p, ref))).toBe(847)
  })

  it('resolves to exactly 674 block entries', () => {
    expect(resolveBlocks(p).size).toBe(674)
  })

  it('assigns every shell coordinate exactly one role', () => {
    const shell = shellBlocks(p, ref)
    const seen = new Set<string>()
    let total = 0
    for (const coords of shell.values()) {
      total += coords.size
      for (const key of coords) seen.add(key)
    }
    expect(total).toBe(674)
    expect(seen.size).toBe(674)
  })
})

describe('shared planes are counted once', () => {
  it('does not double-count the wall two bays share', () => {
    const one = project([level('L1', 0, { A1: bay('merged', () => ({ heightCells: 2 })) })])
    const two = project([
      level('L1', 0, {
        A1: bay('merged', () => ({ heightCells: 2 })),
        B1: bay('merged', () => ({ heightCells: 2 })),
      }),
    ])
    // Naive summing would give 1348; the shared x = 12 plane (9 x 13 = 117) is one wall.
    expect(resolveBlocks(one).size).toBe(674)
    expect(resolveBlocks(two).size).toBe(674 * 2 - 117)
  })
})

describe('merge groups', () => {
  it('removes internal partition walls but keeps every horizontal plane and the outer shell', () => {
    const p = project([
      level('L1', 0, {
        A1: bay('fine', (index) =>
          index === 0 || index === 1
            ? { heightCells: 2, ceiling: 'dropped', mergeGroup: 'room' }
            : { heightCells: 2, ceiling: 'dropped' },
        ),
      }),
    ])
    const blocks = resolveBlocks(p)

    expect(blocks.has(blockKey(4, 2, 2))).toBe(false)
    expect(blocks.has(blockKey(0, 2, 2))).toBe(true)
    expect(blocks.has(blockKey(4, 0, 2))).toBe(true)
    expect(blocks.has(blockKey(4, 4, 2))).toBe(true)
    expect(blocks.has(blockKey(4, 8, 2))).toBe(true)
  })

  it('does not carve a merge group that is not a filled rectangle', () => {
    const p = project([
      level('L1', 0, {
        A1: bay('fine', (index) => (index === 0 || index === 2 ? { mergeGroup: 'broken' } : {})),
      }),
    ])

    expect(resolveBlocks(p).has(blockKey(4, 2, 2))).toBe(true)
  })
})

/**
 * Not a §14 fixture, but §5.4 defines what each socket opens and §7 says the
 * shell must carve it, so the openings are pinned here too. Baseline is the F9
 * bay: a merged bay at y 0, heightCells 2, 674 shell blocks, interior 11 x 7 x 11.
 */
describe('§5.4 socket openings', () => {
  const withEast = (socket: Socket) =>
    project([
      level('L1', 0, { A1: bay('merged', () => ({ heightCells: 2, sockets: sockets({ e: socket }) })) }),
    ])
  const ref: CellRef = { levelId: 'L1', bayKey: 'A1', cellIndex: 0 }

  it('carves the full interior width and height for a corridor', () => {
    expect(resolveBlocks(withEast('corridor')).size).toBe(674 - 11 * 7)
  })

  it('carves 2 blocks of height for an arch', () => {
    expect(resolveBlocks(withEast('arch')).size).toBe(674 - 11 * 2)
  })

  it('carves a single centred block for a window', () => {
    const blocks = resolveBlocks(withEast('window'))
    expect(blocks.size).toBe(674 - 1)
    expect(blocks.has(blockKey(12, 4, 6))).toBe(false)
  })

  it('fills a bars opening with iron bars rather than air', () => {
    const blocks = resolveBlocks(withEast('bars'))
    expect(blocks.size).toBe(674)
    expect(blocks.get(blockKey(12, 4, 6))).toBe('minecraft:iron_bars')
    expect(shellBlocks(withEast('bars'), ref).get('bars')?.size).toBe(11 * 7)
  })

  it('carves the full interior footprint for a shaft', () => {
    const p = project([
      level('L1', 0, { A1: bay('merged', () => ({ heightCells: 2, sockets: sockets({ up: 'shaft' }) })) }),
    ])
    expect(resolveBlocks(p).size).toBe(674 - 11 * 11)
  })

  it('lets a solid neighbour fill an opening back in — both sides must open', () => {
    const p = project([
      level('L1', 0, {
        A1: bay('merged', () => ({ heightCells: 2, sockets: sockets({ e: 'corridor' }) })),
        B1: bay('merged', () => ({ heightCells: 2 })),
      }),
    ])
    expect(resolveBlocks(p).size).toBe(674 * 2 - 117)
    expect(resolveBlocks(p).has(blockKey(12, 4, 6))).toBe(true)
  })

  it('opens the shared plane when both sides carry a corridor', () => {
    const p = project([
      level('L1', 0, {
        A1: bay('merged', () => ({ heightCells: 2, sockets: sockets({ e: 'corridor' }) })),
        B1: bay('merged', () => ({ heightCells: 2, sockets: sockets({ w: 'corridor' }) })),
      }),
    ])
    expect(resolveBlocks(p).has(blockKey(12, 4, 6))).toBe(false)
  })

  it('continues a corridor opening through matching plenum walls', () => {
    const p = project([
      level('L1', 0, {
        A1: bay('merged', () => ({ heightCells: 2, ceiling: 'dropped', sockets: sockets({ e: 'corridor' }) })),
        B1: bay('merged', () => ({ heightCells: 2, ceiling: 'dropped', sockets: sockets({ w: 'corridor' }) })),
      }),
    ])
    expect(resolveBlocks(p).has(blockKey(12, 6, 6))).toBe(false)
  })

  it('carves a matching one-block window through plenum walls', () => {
    const p = project([
      level('L1', 0, {
        A1: bay('merged', () => ({ heightCells: 2, ceiling: 'dropped', sockets: sockets({ e: 'window' }) })),
        B1: bay('merged', () => ({ heightCells: 2, ceiling: 'dropped', sockets: sockets({ w: 'window' }) })),
      }),
    ])
    expect(resolveBlocks(p).has(blockKey(12, 6, 6))).toBe(false)
    expect(resolveBlocks(p).has(blockKey(12, 5, 6))).toBe(true)
  })

  it('keeps bars blocked through plenum walls', () => {
    const p = project([
      level('L1', 0, {
        A1: bay('merged', () => ({ heightCells: 2, ceiling: 'dropped', sockets: sockets({ e: 'bars' }) })),
        B1: bay('merged', () => ({ heightCells: 2, ceiling: 'dropped', sockets: sockets({ w: 'bars' }) })),
      }),
    ])
    expect(resolveBlocks(p).has(blockKey(12, 6, 6))).toBe(true)
  })
})

describe('§7 memoisation', () => {
  it('returns the same blocks until the document changes', () => {
    const p = project([level('L1', 0, { A1: bay('merged', () => ({ heightCells: 2 })) })])
    const first = resolveBlocks(p)
    expect(resolveBlocks(p)).toEqual(first)

    p.levels[0]!.bays['A1']!.cells[0]!.heightCells = 3
    const second = resolveBlocks(p)
    expect(second).not.toEqual(first)
    expect(second.size).toBe(volume(cellAABB(p, { levelId: 'L1', bayKey: 'A1', cellIndex: 0 })) - 11 * 11 * 11)
  })

  it('does not let callers mutate the cached block map', () => {
    const p = project([level('L1', 0, { A1: bay('merged', () => ({ heightCells: 2 })) })])
    const first = resolveBlocks(p)
    const expectedSize = first.size
    first.clear()
    first.set('caller-owned', 'minecraft:air')

    const second = resolveBlocks(p)
    expect(second.size).toBe(expectedSize)
    expect(second.has('caller-owned')).toBe(false)
  })
})
