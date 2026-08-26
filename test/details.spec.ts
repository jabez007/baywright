import { describe, expect, it } from 'vitest'

import { interiorDetailBlocks } from '../src/domain/details.js'
import { blockKey, cellInterior, resolveBlocks } from '../src/domain/geometry.js'
import { cellFromModule } from '../src/domain/modules.js'
import type { CellRef } from '../src/domain/types.js'
import { bay, level, project } from './factory.js'

const arena = project([
  level('L1', 0, { A1: bay('merged', () => cellFromModule('arena')) }),
])
const ref: CellRef = { levelId: 'L1', bayKey: 'A1', cellIndex: 0 }

describe('arena core and circulation ring', () => {
  it('marks a centred 7×7 core inside the 11×11 interior', () => {
    const cell = arena.levels[0]!.bays['A1']!.cells[0]!
    const details = interiorDetailBlocks(arena.levels[0]!.bays['A1']!, cell, cellInterior(arena, ref))

    expect(details.get('trim')?.size).toBe(24)
    expect(details.get('trim')).toContain(blockKey(3, 0, 3))
    expect(details.get('trim')).toContain(blockKey(9, 0, 9))
    expect(details.get('trim')).not.toContain(blockKey(2, 0, 3))
  })

  it('places four full-height pillars and one central ceiling light', () => {
    const cell = arena.levels[0]!.bays['A1']!.cells[0]!
    const details = interiorDetailBlocks(arena.levels[0]!.bays['A1']!, cell, cellInterior(arena, ref))

    expect(details.get('accent')?.size).toBe(44)
    expect(details.get('accent')).toContain(blockKey(3, 1, 3))
    expect(details.get('accent')).toContain(blockKey(9, 11, 9))
    expect(details.get('light')).toEqual(new Set([blockKey(6, 11, 6)]))
  })

  it('resolves detail roles through the room palette', () => {
    const blocks = resolveBlocks(arena)

    expect(blocks.get(blockKey(4, 0, 3))).toBe('minecraft:stone_brick_stairs')
    expect(blocks.get(blockKey(3, 5, 3))).toBe('minecraft:chiseled_stone_bricks')
    expect(blocks.get(blockKey(6, 11, 6))).toBe('minecraft:lantern')
  })

  it('does not detail non-arena or subdivided cells', () => {
    const library = cellFromModule('library')
    expect(interiorDetailBlocks(bay('merged'), library, cellInterior(arena, ref)).size).toBe(0)
    expect(interiorDetailBlocks(bay('fine'), cellFromModule('arena'), cellInterior(arena, ref)).size).toBe(0)
  })
})
