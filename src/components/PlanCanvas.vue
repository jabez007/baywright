<script setup lang="ts">
/**
 * PRD §10 — the plan canvas.
 *
 * SVG, per §10: under 100 rects per level, so declarative templating and free
 * hit-testing beat canvas. One drag state machine lives here and reaches the
 * tiles by `data-bay` / `data-cell` delegation.
 *
 * A stroke previews rather than mutating as it goes, and commits once inside
 * `store.batch` on pointer-up. The store's undo buffer snapshots per `mutate`
 * call, so painting live would cost one undo step per pointer-move; this way a
 * whole drag is one step, which is what §10's ring buffer is for.
 */
import { computed, onBeforeUnmount, ref } from 'vue'

import { bayKeyOf, cellAxisIndices, interiorSpan, parseBayKey } from '../domain/geometry.js'
import { BAY_PITCH, GRAIN_AXIS_CELLS, type CellRef, type Face, type Grain } from '../domain/types.js'
import { useProjectStore } from '../stores/project.js'
import BayTile from './BayTile.vue'
import { moduleFill } from './fills.js'

const props = defineProps<{
  mode: 'bay' | 'cell'
  moduleId: string
  grain: Grain
}>()

const store = useProjectStore()
const svg = ref<SVGSVGElement | null>(null)

/** `"A1"` in bay mode, `"A1:4"` in cell mode. */
type Target = string

type Stroke =
  | { kind: 'paint'; targets: Set<Target> }
  | { kind: 'merge'; grain: Grain; anchor: { u: number; v: number }; head: { u: number; v: number } }

const stroke = ref<Stroke | null>(null)

// --------------------------------------------------------------------------
// Layout
// --------------------------------------------------------------------------

const PAD = 3

const viewBox = computed(() => {
  const width = BAY_PITCH * store.project.bayCols + 1
  const height = BAY_PITCH * store.project.bayRows + 1
  return `${-PAD} ${-PAD} ${width + PAD * 2} ${height + PAD * 2}`
})

/** §5.1 — column letters across the top, row numbers down the left. */
const columnHeaders = computed(() =>
  Array.from({ length: store.project.bayCols }, (_, i) => ({
    key: bayKeyOf(i, 0).replace(/[0-9]+$/, ''),
    x: BAY_PITCH * i + BAY_PITCH / 2 + 0.5,
  })),
)

const rowHeaders = computed(() =>
  Array.from({ length: store.project.bayRows }, (_, j) => ({
    key: String(j + 1),
    y: BAY_PITCH * j + BAY_PITCH / 2 + 0.5,
  })),
)

const bays = computed(() => {
  const level = store.currentLevel
  if (!level) return []
  return Object.entries(level.bays)
    .map(([bayKey, bay]) => ({ bayKey, bay, ...parseBayKey(bayKey) }))
    .sort((left, right) => left.j - right.j || left.i - right.i)
})

/** Cells the validator flagged, so tiles can draw the §10 dashed overlay. */
const errorCellsByBay = computed(() => {
  const byBay = new Map<string, Set<number>>()
  const levelId = store.currentLevel?.id
  if (!levelId) return byBay
  for (const issue of store.issues) {
    if (issue.severity !== 'error') continue
    for (const ref of issue.refs) {
      if (ref.levelId !== levelId) continue
      let set = byBay.get(ref.bayKey)
      if (!set) byBay.set(ref.bayKey, (set = new Set()))
      set.add(ref.cellIndex)
    }
  }
  return byBay
})

const selectedCellsByBay = computed(() => {
  const byBay = new Map<string, Set<number>>()
  const levelId = store.currentLevel?.id
  for (const ref of store.selectedRefs) {
    if (ref.levelId !== levelId) continue
    let set = byBay.get(ref.bayKey)
    if (!set) byBay.set(ref.bayKey, (set = new Set()))
    set.add(ref.cellIndex)
  }
  return byBay
})

const selectedBayKey = computed(() =>
  store.selection.kind === 'bay' && store.selection.levelId === store.currentLevel?.id
    ? store.selection.bayKey
    : null,
)

const EMPTY: ReadonlySet<number> = new Set()

function errorCells(bayKey: string): ReadonlySet<number> {
  return errorCellsByBay.value.get(bayKey) ?? EMPTY
}

function selectedCells(bayKey: string): ReadonlySet<number> {
  return selectedCellsByBay.value.get(bayKey) ?? EMPTY
}

// --------------------------------------------------------------------------
// Preview
// --------------------------------------------------------------------------

const previewFill = computed(() => moduleFill(props.moduleId))

/** Interior rects for whatever the current stroke would touch. */
const preview = computed(() => {
  const current = stroke.value
  if (!current) return []
  if (current.kind === 'merge') return mergeTargets(current).map((ref) => cellInteriorRect(ref))
  return [...current.targets].map((target) => targetRect(target)).filter((rect) => rect !== null)
})

function targetRect(target: Target) {
  const [bayKey, index] = splitTarget(target)
  if (index === null) {
    const { i, j } = parseBayKey(bayKey)
    return { x: BAY_PITCH * i + 1, y: BAY_PITCH * j + 1, width: BAY_PITCH - 1, height: BAY_PITCH - 1 }
  }
  return cellInteriorRect({ levelId: store.currentLevelId, bayKey, cellIndex: index })
}

function cellInteriorRect(ref: CellRef) {
  const grain = grainOf(ref.bayKey)
  const { i, j } = parseBayKey(ref.bayKey)
  const { a, b } = cellAxisIndices(grain, ref.cellIndex)
  const [x0, x1] = interiorSpan(grain, a)
  const [z0, z1] = interiorSpan(grain, b)
  return {
    x: BAY_PITCH * i + x0,
    y: BAY_PITCH * j + z0,
    width: x1 - x0 + 1,
    height: z1 - z0 + 1,
  }
}

// --------------------------------------------------------------------------
// Pointer handling
// --------------------------------------------------------------------------

function onPointerDown(event: PointerEvent): void {
  const target = targetAt(event.target)
  if (!target) return
  event.preventDefault()

  const [bayKey, index] = splitTarget(target)

  // §10 — alt-click a cell edge cycles that face's socket. Single click only.
  if (event.altKey && index !== null) {
    const face = nearestFace(event, { levelId: store.currentLevelId, bayKey, cellIndex: index })
    if (face) store.cycleSocket({ levelId: store.currentLevelId, bayKey, cellIndex: index }, face)
    return
  }

  // §10 — shift-drag creates a merge group across a rectangle.
  if (event.shiftKey && index !== null) {
    const grain = grainOf(bayKey)
    const anchor = lattice(bayKey, grain, index)
    stroke.value = { kind: 'merge', grain, anchor, head: anchor }
  } else {
    stroke.value = { kind: 'paint', targets: new Set([target]) }
  }

  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp, { once: true })
}

function onPointerMove(event: PointerEvent): void {
  const current = stroke.value
  if (!current) return
  // Pointer capture routes moves back to the origin element, so the tile under
  // the cursor has to be looked up by position rather than read off the event.
  const target = targetAt(document.elementFromPoint(event.clientX, event.clientY))
  if (!target) return
  const [bayKey, index] = splitTarget(target)

  if (current.kind === 'merge') {
    if (index === null || grainOf(bayKey) !== current.grain) return
    current.head = lattice(bayKey, current.grain, index)
  } else {
    current.targets.add(target)
  }
}

function onPointerUp(): void {
  window.removeEventListener('pointermove', onPointerMove)
  const current = stroke.value
  stroke.value = null
  if (!current) return

  const levelId = store.currentLevel?.id
  if (!levelId) return

  if (current.kind === 'merge') {
    const refs = mergeTargets(current)
    if (refs.length === 0) return
    store.batch(() => store.mergeCells(refs))
    store.selectCells(refs)
    return
  }

  const targets = [...current.targets]
  if (props.mode === 'bay') {
    store.batch(() => {
      for (const target of targets) store.paintBay(levelId, target, props.moduleId, props.grain)
    })
    const last = targets.at(-1)
    if (last) store.select({ kind: 'bay', levelId, bayKey: last })
    return
  }

  const refs = targets.map((target) => {
    const [bayKey, index] = splitTarget(target)
    return { levelId, bayKey, cellIndex: index ?? 0 }
  })
  store.batch(() => store.paintCells(refs, props.moduleId))
  store.selectCells(refs)
}

onBeforeUnmount(() => window.removeEventListener('pointermove', onPointerMove))

// --------------------------------------------------------------------------
// Target helpers
// --------------------------------------------------------------------------

function targetAt(node: EventTarget | Element | null): Target | null {
  if (!(node instanceof Element)) return null
  const host = node.closest('[data-bay]')
  const bayKey = host?.getAttribute('data-bay')
  if (!bayKey) return null
  const cell = host?.getAttribute('data-cell')
  return cell === null || cell === undefined ? bayKey : `${bayKey}:${cell}`
}

function splitTarget(target: Target): [string, number | null] {
  const colon = target.indexOf(':')
  if (colon === -1) return [target, null]
  return [target.slice(0, colon), Number(target.slice(colon + 1))]
}

function grainOf(bayKey: string): Grain {
  return store.currentLevel?.bays[bayKey]?.grain ?? 'fine'
}

/**
 * Position in the level-wide cell lattice, matching V7's rectangle test:
 * `u = i * n + a`, so a merge rectangle can legally span bays of equal grain.
 */
function lattice(bayKey: string, grain: Grain, cellIndex: number): { u: number; v: number } {
  const { i, j } = parseBayKey(bayKey)
  const { a, b } = cellAxisIndices(grain, cellIndex)
  const n = GRAIN_AXIS_CELLS[grain]
  return { u: i * n + a, v: j * n + b }
}

/** Every same-grain cell inside the shift-drag rectangle. */
function mergeTargets(current: Extract<Stroke, { kind: 'merge' }>): CellRef[] {
  const level = store.currentLevel
  if (!level) return []
  const u0 = Math.min(current.anchor.u, current.head.u)
  const u1 = Math.max(current.anchor.u, current.head.u)
  const v0 = Math.min(current.anchor.v, current.head.v)
  const v1 = Math.max(current.anchor.v, current.head.v)

  const refs: CellRef[] = []
  for (const [bayKey, bay] of Object.entries(level.bays)) {
    if (bay.grain !== current.grain) continue
    for (let cellIndex = 0; cellIndex < bay.cells.length; cellIndex++) {
      const { u, v } = lattice(bayKey, current.grain, cellIndex)
      if (u >= u0 && u <= u1 && v >= v0 && v <= v1) refs.push({ levelId: level.id, bayKey, cellIndex })
    }
  }
  return refs
}

/** Which face of the cell the click landed nearest, for alt-click socket cycling. */
function nearestFace(event: PointerEvent, ref: CellRef): Face | null {
  const element = svg.value
  const matrix = element?.getScreenCTM()
  if (!element || !matrix) return null
  const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
  const rect = cellInteriorRect(ref)
  const distances: [Face, number][] = [
    ['w', point.x - rect.x],
    ['e', rect.x + rect.width - point.x],
    ['n', point.y - rect.y],
    ['s', rect.y + rect.height - point.y],
  ]
  return distances.reduce((best, entry) => (entry[1] < best[1] ? entry : best))[0]
}
</script>

<template>
  <svg
    ref="svg"
    class="plan"
    :viewBox="viewBox"
    preserveAspectRatio="xMidYMid meet"
    role="application"
    aria-label="Floor plan"
    @pointerdown="onPointerDown"
    @contextmenu.prevent
  >
    <defs>
      <!-- Bays whose cells do not share a module, in bay mode. -->
      <pattern id="mixed-hatch" width="2" height="2" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="2" height="2" fill="var(--void)" />
        <rect width="1" height="2" fill="var(--panel-2)" />
      </pattern>
      <!-- §5.4 — bars are visually open but not passable. -->
      <pattern id="bars-hatch" width="0.8" height="0.8" patternUnits="userSpaceOnUse">
        <rect width="0.8" height="0.8" fill="var(--void)" />
        <rect width="0.3" height="0.8" fill="var(--wall-edge)" />
      </pattern>
    </defs>

    <rect class="ground" :x="-PAD" :y="-PAD" :width="BAY_PITCH * store.project.bayCols + 1 + PAD * 2" :height="BAY_PITCH * store.project.bayRows + 1 + PAD * 2" />
    <!-- Tiles own only half of each shared wall, so the outer rim is painted here. -->
    <rect class="field" x="0" y="0" :width="BAY_PITCH * store.project.bayCols + 1" :height="BAY_PITCH * store.project.bayRows + 1" />

    <g class="headers">
      <text v-for="header in columnHeaders" :key="header.key" :x="header.x" :y="-PAD / 2">{{ header.key }}</text>
      <text v-for="header in rowHeaders" :key="header.key" :x="-PAD / 2" :y="header.y">{{ header.key }}</text>
    </g>

    <BayTile
      v-for="entry in bays"
      :key="entry.bayKey"
      :bay-key="entry.bayKey"
      :bay="entry.bay"
      :i="entry.i"
      :j="entry.j"
      :mode="mode"
      :selected-cells="selectedCells(entry.bayKey)"
      :error-cells="errorCells(entry.bayKey)"
      :bay-selected="selectedBayKey === entry.bayKey"
    />

    <g class="preview" :fill="previewFill">
      <rect v-for="(rect, index) in preview" :key="index" v-bind="rect" />
    </g>
  </svg>
</template>

<style scoped>
.plan {
  width: 100%;
  height: 100%;
  display: block;
  touch-action: none;
  user-select: none;
}

.ground {
  fill: var(--panel-2);
}

.field {
  fill: var(--wall);
  pointer-events: none;
}

.headers text {
  font-family: var(--mono);
  font-size: 2px;
  fill: var(--text);
  opacity: 0.55;
  text-anchor: middle;
  dominant-baseline: central;
  pointer-events: none;
}

.preview rect {
  opacity: 0.6;
  pointer-events: none;
}
</style>
