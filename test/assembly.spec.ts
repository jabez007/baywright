import { describe, expect, it } from 'vitest'

import { ASSEMBLY_ROOMS, assembleProposal, type AssemblyRequest } from '../src/domain/assembly.js'
import { bayOpenFaces } from '../src/domain/connections.js'
import { bayKeyOf, parseBayKey } from '../src/domain/geometry.js'
import type { Level } from '../src/domain/types.js'
import { validate } from '../src/domain/validate.js'
import { level, project } from './factory.js'

function field(cols = 4, rows = 4) {
  return project([level('ground', 0, {})], { bayCols: cols, bayRows: rows })
}

function request(overrides: Partial<AssemblyRequest> = {}): AssemblyRequest {
  return { levelId: 'ground', anchorBayKey: 'A1', width: 4, height: 4, levelCount: 1, rooms: [], seed: 1, ...overrides }
}

function footprintKeys(width: number, height: number, i0 = 0, j0 = 0): string[] {
  const keys: string[] = []
  for (let j = j0; j < j0 + height; j++) for (let i = i0; i < i0 + width; i++) keys.push(bayKeyOf(i, j))
  return keys
}

describe('procedural assembly', () => {
  it('proposes one level with a spine that reaches every cell', () => {
    const proposal = assembleProposal(field(), request())
    const ground = proposal.project.levels[0]!

    expect(validate(proposal.project)).toEqual([])
    expect(proposal.issues).toEqual([])
    expect(Object.values(ground.bays).flatMap((bay) => bay.cells).filter((cell) => cell.module === 'spine')).toHaveLength(1)
    for (const key of footprintKeys(4, 4)) {
      const built = ground.bays[key] !== undefined
      const named = ground.negativeSpaces?.[key] !== undefined
      expect(built !== named, key).toBe(true)
    }
  })

  it('returns the same proposal for the same inputs and leaves the project alone', () => {
    const source = field()
    const before = JSON.stringify(source)
    const first = assembleProposal(source, request({ levelCount: 3, rooms: ['library-hall'], seed: 42 }))
    const second = assembleProposal(source, request({ levelCount: 3, rooms: ['library-hall'], seed: 42 }))

    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
    expect(JSON.stringify(source)).toBe(before)
    const others = [1, 2, 3].map((seed) => JSON.stringify(assembleProposal(source, request({ seed })).project))
    expect(new Set(others).size).toBeGreaterThan(1)
  })

  it('stacks levels one compact stair apart and climbs each by a stair', () => {
    const proposal = assembleProposal(field(), request({ levelCount: 3, seed: 7 }))

    expect(proposal.project.levels.map((entry) => entry.y)).toEqual([0, 8, 16])
    expect(proposal.issues).toEqual([])
    const roles = (levelId: string) => proposal.bays.filter((entry) => entry.levelId === levelId).map((entry) => entry.role)
    const [ground, middle, top] = proposal.project.levels.map((entry) => entry.id) as [string, string, string]
    expect(roles(ground).filter((role) => role === 'stair')).toHaveLength(1)
    expect(roles(middle).filter((role) => role === 'landing')).toHaveLength(1)
    expect(roles(middle).filter((role) => role === 'stair')).toHaveLength(1)
    expect(roles(top).filter((role) => role === 'landing')).toHaveLength(1)
    expect(roles(top)).not.toContain('stair')
  })

  it('builds upper levels only over bays the level below builds', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const levels = assembleProposal(field(), request({ levelCount: 3, seed })).project.levels
      for (let k = 1; k < levels.length; k++) {
        for (const key of Object.keys(levels[k]!.bays)) expect(levels[k - 1]!.bays[key], `seed ${seed} ${key}`).toBeDefined()
      }
    }
  })

  it('validates clean across seeds, footprints, level counts, and rooms', () => {
    const rooms = ASSEMBLY_ROOMS.map((room) => room.id)
    for (const [width, height] of [[2, 1], [3, 2], [4, 4], [6, 5]] as const) {
      for (let levelCount = 1; levelCount <= 3; levelCount++) {
        for (let seed = 1; seed <= 12; seed++) {
          const label = `${width}×${height}, ${levelCount} levels, seed ${seed}`
          const proposal = assembleProposal(field(6, 6), request({ width, height, levelCount, rooms, seed }))
          expect(proposal.issues.map((issue) => issue.message), label).toEqual([])
        }
      }
    }
  })

  it('places requested rooms and reports the ones that did not fit', () => {
    const proposal = assembleProposal(field(), request({ levelCount: 2, rooms: ['library-hall', 'machine-hall', 'concealed-room'], seed: 3 }))
    const rooms = proposal.bays.filter((entry) => entry.role === 'room').map((entry) => entry.patternId).sort()
    expect([...rooms, ...proposal.unplacedRooms].sort()).toEqual(['concealed-room', 'library-hall', 'machine-hall'])
    expect(rooms.length).toBeGreaterThan(0)

    const crowded = assembleProposal(field(), request({ width: 2, height: 1, rooms: ['library-hall', 'library-hall', 'library-hall'] }))
    expect(crowded.unplacedRooms).toEqual(['library-hall', 'library-hall'])
  })

  it('places an atrium with a balcony over each hall on the level above', () => {
    for (let seed = 1; seed <= 15; seed++) {
      const proposal = assembleProposal(field(6, 6), request({ width: 6, height: 6, levelCount: 3, rooms: ['atrium', 'library-hall'], seed }))
      const [ground, upper] = proposal.project.levels as [Level, Level]
      const at = (levelId: string, patternId: string) =>
        proposal.bays.filter((entry) => entry.levelId === levelId && entry.patternId === patternId).map((entry) => entry.bayKey)
      const label = `seed ${seed}`

      expect(proposal.issues.map((issue) => issue.message), label).toEqual([])
      if (proposal.unplacedRooms.includes('atrium')) continue
      const atriumLevel = at(ground.id, 'atrium-core').length === 1 ? ground : upper
      const above = proposal.project.levels[proposal.project.levels.indexOf(atriumLevel) + 1]!
      const [core] = at(atriumLevel.id, 'atrium-core')
      expect(at(atriumLevel.id, 'atrium-hall').sort(), label).toEqual(at(above.id, 'atrium-balcony').sort())
      expect(at(above.id, 'atrium-balcony'), label).toHaveLength(2)
      // The 12-high core rises through the level above, so nothing is built or named there.
      expect(above.bays[core!], label).toBeUndefined()
      expect(above.negativeSpaces?.[core!], label).toBeUndefined()
    }
    const placed = Array.from({ length: 15 }, (_, index) =>
      assembleProposal(field(6, 6), request({ width: 6, height: 6, levelCount: 3, rooms: ['atrium'], seed: index + 1 })))
      .filter((proposal) => proposal.unplacedRooms.length === 0)
    expect(placed.length).toBeGreaterThan(10)
  })

  it('climbs on from a balcony the landing reaches only across the atrium core', () => {
    // On level 16 of this plan, the only dead ends lie past the far balcony.
    const proposal = assembleProposal(field(8, 8), request({
      width: 8, height: 8, levelCount: 4, rooms: ['atrium', 'atrium', 'library-hall', 'concealed-room', 'machine-hall'], seed: 32,
    }))
    expect(proposal.issues).toEqual([])
    expect(proposal.bays.filter((entry) => entry.role === 'stair')).toHaveLength(3)
  })

  it('needs a level above for an atrium', () => {
    expect(assembleProposal(field(), request({ rooms: ['atrium'] })).unplacedRooms).toEqual(['atrium'])
  })

  it('puts a mine head only on the lowest level', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const proposal = assembleProposal(field(), request({ levelCount: 3, rooms: ['mine-head', 'mine-head'], seed }))
      const levels = new Set(proposal.bays.filter((entry) => entry.patternId === 'mine-head').map((entry) => entry.levelId))
      expect([...levels].every((id) => id === 'ground'), `seed ${seed}`).toBe(true)
    }
  })

  it('keeps named negative space and names the bays it leaves open', () => {
    const source = field()
    source.levels[0]!.negativeSpaces = { B2: { kind: 'garden', note: 'Keep the oak' } }
    for (let seed = 1; seed <= 10; seed++) {
      const ground = assembleProposal(source, request({ seed })).project.levels[0]!
      expect(ground.bays.B2).toBeUndefined()
      expect(ground.negativeSpaces?.B2).toEqual({ kind: 'garden', note: 'Keep the oak' })
    }
    const kinds = new Set<string>()
    for (let seed = 1; seed <= 10; seed++) {
      const [ground, upper] = assembleProposal(field(), request({ levelCount: 2, seed })).project.levels as [Level, Level]
      for (const space of Object.values(ground.negativeSpaces ?? {})) kinds.add(`ground ${space.kind}`)
      for (const [key, space] of Object.entries(upper.negativeSpaces ?? {})) {
        expect(space.kind, `seed ${seed} ${key}`).toBe(ground.bays[key] ? 'reserved' : 'courtyard')
      }
    }
    expect(kinds).toEqual(new Set(['ground courtyard']))
  })

  it('closes some loops instead of building only a tree', () => {
    const loops = Array.from({ length: 10 }, (_, index) => {
      const ground = assembleProposal(field(), request({ seed: index + 1 })).project.levels[0]!
      const keys = Object.keys(ground.bays)
      let joins = 0
      for (const key of keys) {
        const { i, j } = parseBayKey(key)
        const east = bayKeyOf(i + 1, j)
        const south = bayKeyOf(i, j + 1)
        if (ground.bays[east] && bayOpenFaces(ground.bays[key]!).includes('e')) joins++
        if (ground.bays[south] && bayOpenFaces(ground.bays[key]!).includes('s')) joins++
      }
      return joins - (keys.length - 1)
    })
    expect(Math.max(...loops)).toBeGreaterThan(0)
    expect(Math.min(...loops)).toBeGreaterThanOrEqual(0)
  })

  it('changes nothing outside the footprint', () => {
    const source = field()
    const outside = (p: typeof source) => JSON.stringify(Object.entries(p.levels[0]!.bays).filter(([key]) => !footprintKeys(2, 2, 1, 1).includes(key)))
    const proposal = assembleProposal(source, request({ anchorBayKey: 'B2', width: 2, height: 2 }))
    expect(outside(proposal.project)).toBe(outside(source))
    expect(Object.keys(proposal.project.levels[0]!.bays).every((key) => footprintKeys(2, 2, 1, 1).includes(key))).toBe(true)
  })

  it('rejects a footprint off the field, a bad level count, and an unknown room', () => {
    expect(() => assembleProposal(field(), request({ anchorBayKey: 'C1', width: 3 }))).toThrow('leaves the bay field')
    expect(() => assembleProposal(field(), request({ levelCount: 5 }))).toThrow('level count 5 must be 1 to 4')
    expect(() => assembleProposal(field(), request({ rooms: ['arena'] }))).toThrow("'arena' is not an assembly room")
    expect(() => assembleProposal(field(), request({ width: 1, height: 1 }))).toThrow("'ground' has only one open bay")
  })
})
