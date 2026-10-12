/**
 * The stair kit: a stair room exports something a player can climb.
 *
 * The checks walk the blocks the way a player would. Each step sits one
 * block up and one block across from the last and faces the way the player
 * walks onto it. Every step has three blocks of air above it, the clearance
 * a player's head needs while moving up from one step to the next. The top
 * step lies in the landing's floor plane, next to floor the player can walk
 * off onto.
 */
import { describe, expect, it } from 'vitest'
import { blockKey, parseBlockKey, resolveBlocks } from '../src/domain/geometry.js'
import { parseBlockId } from '../src/domain/lighting.js'
import { cellFromModule } from '../src/domain/modules.js'
import { PALETTES } from '../src/domain/palettes.js'
import { validate } from '../src/domain/validate.js'
import { bay, level, project, sockets } from './factory.js'

interface Step {
  x: number
  y: number
  z: number
  blockId: string
}

const DIRECTIONS: Readonly<Record<string, readonly [number, number]>> = {
  north: [0, -1],
  east: [1, 0],
  south: [0, 1],
  west: [-1, 0],
}

/** Every stair inside the columns `x0..x1`, `z0..z1`, lowest first. */
function stairsWithin(blocks: Map<string, string>, x0: number, x1: number, z0: number, z1: number): Step[] {
  const steps: Step[] = []
  for (const [key, blockId] of blocks) {
    if (!parseBlockId(blockId).name.endsWith('_stairs')) continue
    const { x, y, z } = parseBlockKey(key)
    if (x >= x0 && x <= x1 && z >= z0 && z <= z1) steps.push({ x, y, z, blockId })
  }
  return steps.sort((l, r) => l.y - r.y)
}

/** A player can walk from the floor at `floorY` up the steps to the floor at `topY`. */
function expectClimb(blocks: Map<string, string>, steps: Step[], floorY: number, topY: number): void {
  const at = (x: number, y: number, z: number) => blocks.get(blockKey(x, y, z))
  expect(steps.map((step) => step.y)).toEqual(Array.from({ length: topY - floorY }, (_, index) => floorY + 1 + index))

  steps.forEach((step, index) => {
    const { facing = 'north', half = 'bottom' } = parseBlockId(step.blockId).state
    const [dx, dz] = DIRECTIONS[facing]!
    expect(half, `step at y ${step.y}`).toBe('bottom')
    const previous = steps[index - 1]
    if (previous) {
      expect([step.x - previous.x, step.z - previous.z], `step at y ${step.y} follows the last`).toEqual([dx, dz])
    } else {
      // The first step rises off the floor, from a spot with room to stand.
      expect(at(step.x - dx, floorY, step.z - dz), 'floor before the first step').toBeDefined()
      expect(at(step.x - dx, floorY + 1, step.z - dz), 'room before the first step').toBeUndefined()
      expect(at(step.x - dx, floorY + 2, step.z - dz), 'room before the first step').toBeUndefined()
    }
    for (let y = step.y + 1; y <= step.y + 3; y++) {
      expect(at(step.x, y, step.z), `headroom over the step at y ${step.y}`).toBeUndefined()
    }
  })

  expectWalkOff(blocks, steps.at(-1)!)
}

/** A floor block beside the climb's block at `top`, flush with it and clear above, to step off onto. */
function expectWalkOff(blocks: Map<string, string>, top: { x: number; y: number; z: number }): void {
  const at = (x: number, y: number, z: number) => blocks.get(blockKey(x, y, z))
  const exits = Object.values(DIRECTIONS).filter(([dx, dz]) => {
    const floor = at(top.x + dx, top.y, top.z + dz)
    return (
      floor !== undefined &&
      !/_stairs$|^ladder$/.test(parseBlockId(floor).name) &&
      at(top.x + dx, top.y + 1, top.z + dz) === undefined &&
      at(top.x + dx, top.y + 2, top.z + dz) === undefined
    )
  })
  expect(exits.length, `floor beside the climb at y ${top.y}`).toBeGreaterThan(0)
}

/** A ladder runs from the floor at `floorY` to the plane at `topY`, each rung on a solid block. */
function expectLadder(blocks: Map<string, string>, x: number, z: number, facing: string, floorY: number, topY: number): void {
  const [dx, dz] = DIRECTIONS[facing]!
  for (let y = floorY + 1; y <= topY; y++) {
    expect(blocks.get(blockKey(x, y, z)), `rung at y ${y}`).toBe(`minecraft:ladder[facing=${facing}]`)
    expect(blocks.get(blockKey(x - dx, y, z - dz)), `wall behind the rung at y ${y}`).toBeDefined()
  }
  expect(blocks.get(blockKey(x, topY + 1, z)), 'room above the top rung').toBeUndefined()
  expectWalkOff(blocks, { x, y: topY, z })
}

/** Every block of the plane at `y` over the columns `x0..x1`, `z0..z1`. */
function plane(blocks: Map<string, string>, y: number, x0: number, x1: number, z0: number, z1: number): Array<string | undefined> {
  const out: Array<string | undefined> = []
  for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) out.push(blocks.get(blockKey(x, y, z)))
  return out
}

const landing = (open: Parameters<typeof sockets>[0] = {}) => ({ module: 'junction', sockets: sockets({ w: 'corridor', down: 'shaft', ...open }) })

describe('stair kit', () => {
  describe('in a merged stair hall', () => {
    const hall = () =>
      project([
        level('low', 0, { A1: bay('merged', () => cellFromModule('stair')) }),
        level('high', 8, { A1: bay('merged', () => ({ module: 'junction', sockets: sockets({ w: 'corridor', down: 'shaft' }) })) }, { paletteId: 'dark-oak' }),
      ])

    it('climbs from the floor to the landing on the palette trim', () => {
      const blocks = resolveBlocks(hall())
      const steps = stairsWithin(blocks, 1, 11, 1, 11)
      expectClimb(blocks, steps, 0, 8)
      for (const step of steps.slice(0, -1)) expect(parseBlockId(step.blockId).name).toBe('stone_brick_stairs')
    })

    it('opens only a stairwell in the landing floor, which keeps its own palette', () => {
      const floor = plane(resolveBlocks(hall()), 8, 1, 11, 1, 11)
      // Three blocks of the well stay open over the steps below the top one.
      expect(floor.filter((blockId) => blockId === undefined)).toHaveLength(3)
      expect(floor.filter((blockId) => blockId === PALETTES['dark-oak']!.blocks.floor)).toHaveLength(121 - 4)
    })

    it('lights the hall and its landing without a dark floor', () => {
      expect(validate(hall()).filter((issue) => issue.id === 'V9')).toEqual([])
    })
  })

  it('carries on up a stack of stair halls, with a floor to step off at each level', () => {
    const stack = project([
      level('low', 0, { A1: bay('merged', () => cellFromModule('stair')) }),
      level('mid', 8, { A1: bay('merged', () => ({ ...cellFromModule('stair'), sockets: sockets({ n: 'corridor', up: 'shaft', down: 'shaft' }) })) }),
      level('high', 16, { A1: bay('merged', () => landing()) }),
    ])
    const blocks = resolveBlocks(stack)
    const steps = stairsWithin(blocks, 1, 11, 1, 11)
    expectClimb(blocks, steps, 0, 16)
    expectWalkOff(blocks, steps.find((step) => step.y === 8)!)
    expect(validate(stack).filter((issue) => issue.id === 'V9')).toEqual([])
  })

  it('winds a spiral round a five-wide room', () => {
    const room = project([
      level('low', 0, { A1: bay('coarse', (index) => (index === 0 ? { ...cellFromModule('stair'), heightCells: 1 } : {})) }),
      level('high', 4, { A1: bay('coarse', (index) => (index === 0 ? landing() : {})) }),
    ])
    const blocks = resolveBlocks(room)
    expectClimb(blocks, stairsWithin(blocks, 1, 5, 1, 5), 0, 4)
    expect(plane(blocks, 4, 1, 5, 1, 5).filter((blockId) => blockId === undefined)).toHaveLength(3)
  })

  it('hangs a ladder in a three-wide room, on the wall facing its door', () => {
    // Cell 4 is the middle of a fine bay, with its interior at x 5 to 7.
    const compact = project([
      level('low', 0, { A1: bay('fine', (index) => (index === 4 ? { ...cellFromModule('stair'), sockets: sockets({ w: 'corridor', up: 'shaft' }) } : {})) }),
      level('high', 8, { A1: bay('fine', (index) => (index === 4 ? landing() : {})) }),
    ])
    const blocks = resolveBlocks(compact)
    expectLadder(blocks, 7, 6, 'west', 0, 8)
    // The landing floor is whole but for the top rung.
    expect(plane(blocks, 8, 5, 7, 5, 7).filter((blockId) => blockId === undefined)).toEqual([])
    expect(validate(compact).filter((issue) => issue.id === 'V9')).toEqual([])
  })

  it('climbs on by ladder from a five-wide room whose floor is a shaft', () => {
    // A spiral would fill the room and leave its floor no way onto the steps.
    const stack = project([
      level('low', 0, { A1: bay('coarse', (index) => (index === 0 ? { ...cellFromModule('stair'), heightCells: 1 } : {})) }),
      level('mid', 4, {
        A1: bay('coarse', (index) =>
          index === 0 ? { ...cellFromModule('stair'), heightCells: 1, sockets: sockets({ e: 'corridor', up: 'shaft', down: 'shaft' }) } : {},
        ),
      }),
      level('high', 8, { A1: bay('coarse', (index) => (index === 0 ? landing() : {})) }),
    ])
    const blocks = resolveBlocks(stack)
    expectClimb(blocks, stairsWithin(blocks, 1, 5, 1, 5), 0, 4)
    expectLadder(blocks, 1, 3, 'east', 4, 8)
  })
})
