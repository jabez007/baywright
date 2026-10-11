/**
 * Where to build the Nether side of each portal room, and whether the pairs
 * would link to each other as planned.
 *
 * Vanilla linking, as of 1.16: a player entering a portal arrives near their
 * position scaled by 8, with y unchanged. The game looks for the portal block
 * nearest that spot within 16 blocks on x and z in the Nether, or 128 in the
 * Overworld, and builds a new portal only if none is found. Ties go to the
 * lower block.
 *
 * Pure: works on the portals the resolver placed.
 */
import { resolvePortals, type ResolvedPortal } from './geometry.js'
import type { AABB, CellRef, Project } from './types.js'

/** How far the game looks on x and z for an Overworld portal to link to. */
export const OVERWORLD_SEARCH = 128

/**
 * The lowest and highest opening bottom for a Nether side: its frame then
 * sits above the lava sea at y 31 and below the bedrock roof at y 123.
 */
export const NETHER_LOWEST_OPENING = 33
export const NETHER_HIGHEST_OPENING = 119

export interface PortalPair {
  ref: CellRef
  axis: ResolvedPortal['axis']
  /** The air the player lights, in the Overworld. */
  overworld: AABB
  /** The same opening, where its Nether side should go. */
  nether: AABB
}

/** One Overworld portal and the Nether portal that matches it, for every portal room. */
export function portalPairs(project: Project): PortalPair[] {
  return resolvePortals(project).map(({ ref, axis, opening }) => ({ ref, axis, overworld: opening, nether: netherSide(opening) }))
}

/** The opening centred on the scaled centre, so every way in lands inside it. */
function netherSide(opening: AABB): AABB {
  const x = Math.floor(centre(opening.x0, opening.x1) / 8)
  const z = Math.floor(centre(opening.z0, opening.z1) / 8)
  const y0 = Math.min(Math.max(opening.y0, NETHER_LOWEST_OPENING), NETHER_HIGHEST_OPENING)
  const x0 = x - (centre(opening.x0, opening.x1) - opening.x0)
  const z0 = z - (centre(opening.z0, opening.z1) - opening.z0)
  return {
    x0,
    x1: x0 + opening.x1 - opening.x0,
    y0,
    y1: y0 + opening.y1 - opening.y0,
    z0,
    z1: z0 + opening.z1 - opening.z0,
  }
}

/**
 * How two portal pairs get in each other's way:
 * - `overlap`: their Nether sides would share blocks, so one cannot be built;
 * - `back`: coming back from `from`'s Nether side can come out at `to`.
 *
 * Going in always works. Each Nether side holds every block a player going
 * in can arrive at, at the height nearest theirs, so its own portal is the
 * nearest unless another Nether side overlaps it.
 */
export interface PortalConflict {
  kind: 'overlap' | 'back'
  from: PortalPair
  to: PortalPair
}

/**
 * Conflicts between the pairs, assuming each Nether side is built where
 * {@link portalPairs} puts it. A tie counts as a conflict, since the game
 * could pick either portal.
 */
export function portalConflicts(pairs: readonly PortalPair[]): PortalConflict[] {
  const conflicts: PortalConflict[] = []
  for (let a = 0; a < pairs.length; a++) {
    for (let b = a + 1; b < pairs.length; b++) {
      if (boxesMeet(netherFrame(pairs[a]!), netherFrame(pairs[b]!))) {
        conflicts.push({ kind: 'overlap', from: pairs[a]!, to: pairs[b]! })
      }
    }
  }
  const overlapping = new Set(conflicts.flatMap((conflict) => [conflict.from, conflict.to]))

  for (const from of pairs) {
    if (overlapping.has(from)) continue
    for (const to of wrongReturns(from, pairs)) conflicts.push({ kind: 'back', from, to })
  }
  return conflicts
}

/** The other pairs a player can come out at by stepping back through `from`'s Nether side. */
function wrongReturns(from: PortalPair, pairs: readonly PortalPair[]): PortalPair[] {
  const wrong = new Set<PortalPair>()
  for (const target of returns(from)) {
    for (const reached of nearestOverworldPortals(target, pairs)) {
      if (reached !== from) wrong.add(reached)
    }
  }
  return [...wrong]
}

/**
 * Every Overworld block a player can arrive at from `pair`'s Nether side.
 * The player stands on the frame, anywhere from 0.3 blocks inside one side
 * of the opening to 0.3 inside the other, halfway through its thickness.
 * The game multiplies that position by 8 and rounds down to a block.
 */
function returns({ nether, axis }: PortalPair): Array<[number, number, number]> {
  const span = (lo: number, hi: number, wide: boolean): number[] => {
    const [from, to] = wide ? [lo + 0.3, hi + 0.7] : [lo + 0.5, hi + 0.5]
    return range(Math.floor(from * 8), Math.floor(to * 8))
  }
  const out: Array<[number, number, number]> = []
  for (const x of span(nether.x0, nether.x1, axis === 'x')) {
    for (const z of span(nether.z0, nether.z1, axis === 'z')) out.push([x, nether.y0, z])
  }
  return out
}

/** The pairs holding the nearest Overworld portal block, more than one on a tie. */
function nearestOverworldPortals([x, y, z]: [number, number, number], pairs: readonly PortalPair[]): PortalPair[] {
  const radius = OVERWORLD_SEARCH
  let best: { distance: number; y: number; pairs: Set<PortalPair> } | null = null
  for (const pair of pairs) {
    const opening = pair.overworld
    for (let bx = opening.x0; bx <= opening.x1; bx++) {
      for (let bz = opening.z0; bz <= opening.z1; bz++) {
        if (Math.abs(bx - x) > radius || Math.abs(bz - z) > radius) continue
        for (let by = opening.y0; by <= opening.y1; by++) {
          const distance = (bx - x) ** 2 + (by - y) ** 2 + (bz - z) ** 2
          if (!best || distance < best.distance || (distance === best.distance && by < best.y)) {
            best = { distance, y: by, pairs: new Set([pair]) }
          } else if (distance === best.distance && by === best.y) {
            best.pairs.add(pair)
          }
        }
      }
    }
  }
  return best ? [...best.pairs] : []
}

/** A Nether side's opening and its obsidian frame, corners included. */
function netherFrame(pair: PortalPair): AABB {
  const opening = pair.nether
  const grow = (axis: 'x' | 'z') => (pair.axis === axis ? 1 : 0)
  return {
    x0: opening.x0 - grow('x'),
    x1: opening.x1 + grow('x'),
    y0: opening.y0 - 1,
    y1: opening.y1 + 1,
    z0: opening.z0 - grow('z'),
    z1: opening.z1 + grow('z'),
  }
}

function boxesMeet(a: AABB, b: AABB): boolean {
  return a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1 && a.z0 <= b.z1 && b.z0 <= a.z1
}

function centre(lo: number, hi: number): number {
  return lo + Math.floor((hi - lo) / 2)
}

function range(lo: number, hi: number): number[] {
  return Array.from({ length: hi - lo + 1 }, (_, index) => lo + index)
}
