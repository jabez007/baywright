/**
 * Where each portal room's Nether side goes. Expected openings come from the
 * portal kit's frame, worked out by hand: a merged room's 3×3 opening sits at
 * local x 5 to 7 and y 2 to 4 in the plane z 6, and the Nether side centres
 * on that middle column divided by 8 and rounded down.
 */
import { describe, expect, it } from 'vitest'
import { cellFromModule } from '../src/domain/modules.js'
import { portalPairs } from '../src/domain/portals.js'
import type { Cell, Grain } from '../src/domain/types.js'
import { bay, level, project, sockets } from './factory.js'

const portalBay = (grain: Grain = 'merged', overrides: Partial<Cell> = {}) =>
  bay(grain, () => ({ ...cellFromModule('nether-portal'), ...overrides }))

describe('portal pairs', () => {
  it('puts the Nether side at the opening scaled by 8, above the lava sea', () => {
    const [pair, ...rest] = portalPairs(project([level('L', 0, { A1: portalBay() })]))
    expect(rest).toEqual([])
    expect(pair!.ref).toEqual({ levelId: 'L', bayKey: 'A1', cellIndex: 0 })
    expect(pair!.axis).toBe('x')
    expect(pair!.overworld).toEqual({ x0: 5, x1: 7, y0: 2, y1: 4, z0: 6, z1: 6 })
    // y 2 would sit under the lava sea, so the opening rises to y 33.
    expect(pair!.nether).toEqual({ x0: -1, x1: 1, y0: 33, y1: 35, z0: 0, z1: 0 })
  })

  it('works in world coordinates and rounds negative positions down', () => {
    const p = project([level('L', 64, { A1: portalBay() })], { origin: { x: 1000, z: -2000 } })
    const [pair] = portalPairs(p)
    expect(pair!.overworld).toEqual({ x0: 1005, x1: 1007, y0: 66, y1: 68, z0: -1994, z1: -1994 })
    // 1006 / 8 = 125.75 and -1994 / 8 = -249.25.
    expect(pair!.nether).toEqual({ x0: 124, x1: 126, y0: 66, y1: 68, z0: -250, z1: -250 })
  })

  it('turns with a frame that runs north to south', () => {
    const [pair] = portalPairs(project([level('L', 64, { A1: portalBay('merged', { sockets: sockets({ w: 'arch' }) }) })]))
    expect(pair!.axis).toBe('z')
    expect(pair!.overworld).toEqual({ x0: 6, x1: 6, y0: 66, y1: 68, z0: 5, z1: 7 })
    expect(pair!.nether).toEqual({ x0: 0, x1: 0, y0: 66, y1: 68, z0: -1, z1: 1 })
  })

  it('keeps the Nether side under the bedrock roof', () => {
    const [pair] = portalPairs(project([level('L', 200, { A1: portalBay() })]))
    expect(pair!.overworld.y0).toBe(202)
    expect(pair!.nether).toMatchObject({ y0: 119, y1: 121 })
  })

  it('lists only rooms that got a frame', () => {
    expect(portalPairs(project([level('L', 0, { A1: portalBay('fine') })]))).toEqual([])
    expect(portalPairs(project([level('L', 0, { A1: portalBay('coarse') })]))).toHaveLength(4)
  })
})
