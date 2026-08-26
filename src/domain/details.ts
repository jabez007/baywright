/** Exact interior block placement for the small set of modules that own it. */
import type { AABB, Bay, Cell, MaterialRole } from './types.js'

export type DetailBlocks = Map<MaterialRole, Set<string>>

/**
 * A merged arena has an 11×11 interior. Its centred 7×7 purpose core leaves
 * a two-block circulation ring on every side. The trim marks that boundary;
 * four pillars rise from its corners, and one light hangs at the room centre.
 */
export function interiorDetailBlocks(bay: Bay, cell: Cell, interior: AABB): DetailBlocks {
  if (bay.grain !== 'merged' || cell.module !== 'arena') return new Map()

  const core = {
    x0: interior.x0 + 2,
    x1: interior.x1 - 2,
    z0: interior.z0 + 2,
    z1: interior.z1 - 2,
  }
  const out: DetailBlocks = new Map()
  const trim = roleSet(out, 'trim')
  const floorY = interior.y0 - 1
  for (let x = core.x0; x <= core.x1; x++) {
    trim.add(key(x, floorY, core.z0))
    trim.add(key(x, floorY, core.z1))
  }
  for (let z = core.z0; z <= core.z1; z++) {
    trim.add(key(core.x0, floorY, z))
    trim.add(key(core.x1, floorY, z))
  }

  const accent = roleSet(out, 'accent')
  for (const [x, z] of [
    [core.x0, core.z0],
    [core.x1, core.z0],
    [core.x0, core.z1],
    [core.x1, core.z1],
  ] as const) {
    for (let y = interior.y0; y <= interior.y1; y++) accent.add(key(x, y, z))
  }

  roleSet(out, 'light').add(key(midpoint(interior.x0, interior.x1), interior.y1, midpoint(interior.z0, interior.z1)))
  return out
}

function roleSet(out: DetailBlocks, role: MaterialRole): Set<string> {
  const existing = out.get(role)
  if (existing) return existing
  const created = new Set<string>()
  out.set(role, created)
  return created
}

function midpoint(lo: number, hi: number): number {
  return lo + Math.floor((hi - lo) / 2)
}

function key(x: number, y: number, z: number): string {
  return `${x},${y},${z}`
}
