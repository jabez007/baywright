<script setup lang="ts">
/**
 * PRD §10 — one bay, in either zoom mode.
 *
 * Bay mode draws the bay as a single tile with its grain hinted by division
 * lines; cell mode subdivides it into real cells. A 3x3 field of fine bays is
 * 81 cell rects, which is why §10 specifies SVG over canvas.
 *
 * Pointer handling is delegated to PlanCanvas via `data-bay` / `data-cell`,
 * so there is one drag state machine rather than one per tile.
 */
import { computed } from 'vue'

import { outerSpan } from '../domain/geometry.js'
import { getModule } from '../domain/modules.js'
import { BAY_PITCH, GRAIN_AXIS_CELLS, type Bay } from '../domain/types.js'
import CellTile from './CellTile.vue'
import { moduleFill } from './fills.js'

const props = defineProps<{
  bayKey: string
  bay: Bay
  /** Bay column and row, 0-indexed. */
  i: number
  j: number
  mode: 'bay' | 'cell'
  selectedCells: ReadonlySet<number>
  errorCells: ReadonlySet<number>
  baySelected: boolean
  interactive: boolean
  activeTarget: string | null
}>()

const bayX = computed(() => BAY_PITCH * props.i)
const bayZ = computed(() => BAY_PITCH * props.j)

/** Half of each shared wall block, so bays partition the plane. See CellTile. */
const outer = computed(() => ({
  x: bayX.value + 0.5,
  y: bayZ.value + 0.5,
  width: BAY_PITCH,
  height: BAY_PITCH,
}))

const interior = computed(() => ({
  x: bayX.value + 1,
  y: bayZ.value + 1,
  width: BAY_PITCH - 1,
  height: BAY_PITCH - 1,
}))

/** Bay mode needs one fill for the whole bay: the shared module, or 'mixed'. */
const uniformModule = computed<string | null>(() => {
  const first = props.bay.cells[0]
  if (!first) return null
  return props.bay.cells.every((cell) => cell.module === first.module) ? first.module : null
})

const bayFill = computed(() => (uniformModule.value ? moduleFill(uniformModule.value) : 'url(#mixed-hatch)'))

/** Interior division lines, so grain is legible without subdividing. */
const grainLines = computed(() => {
  const n = GRAIN_AXIS_CELLS[props.bay.grain]
  const lines: { x1: number; y1: number; x2: number; y2: number }[] = []
  for (let index = 1; index < n; index++) {
    const [lo] = outerSpan(props.bay.grain, index as 0 | 1 | 2)
    lines.push({ x1: bayX.value + lo + 0.5, y1: interior.value.y, x2: bayX.value + lo + 0.5, y2: interior.value.y + interior.value.height })
    lines.push({ x1: interior.value.x, y1: bayZ.value + lo + 0.5, x2: interior.value.x + interior.value.width, y2: bayZ.value + lo + 0.5 })
  }
  return lines
})

const bayHasError = computed(() => props.errorCells.size > 0)

const label = computed(() => {
  const module = uniformModule.value ? getModule(uniformModule.value)?.name : 'mixed'
  return `${props.bayKey} — ${props.bay.grain} grain, ${module ?? uniformModule.value}`
})

/** Bay mode has the whole bay to label; cell mode leaves it to the gutter. */
const keyAnchor = computed(() => ({ x: bayX.value + BAY_PITCH / 2 + 0.5, y: bayZ.value + BAY_PITCH / 2 + 0.5 }))
</script>

<template>
  <g class="bay" :class="{ selected: baySelected, error: bayHasError }">
    <template v-if="mode === 'cell'">
      <CellTile
        v-for="(cell, index) in bay.cells"
        :key="index"
        :data-bay="bayKey"
        :data-cell="index"
        :bay-key="bayKey"
        :cell="cell"
        :grain="bay.grain"
        :cell-index="index"
        :bay-x="bayX"
        :bay-z="bayZ"
        :selected="selectedCells.has(index)"
        :has-error="errorCells.has(index)"
        :interactive="interactive"
        :tab-index="activeTarget === `${bayKey}:${index}` ? 0 : -1"
        detailed
      />
    </template>

    <g
      v-else
      :data-bay="bayKey"
      :data-plan-target="interactive ? 'bay' : undefined"
      :tabindex="interactive ? (activeTarget === bayKey ? 0 : -1) : undefined"
      :role="interactive ? 'button' : undefined"
      :aria-label="interactive ? label : undefined"
      class="bay-tile"
    >
      <title>{{ label }}</title>
      <rect class="shell" v-bind="outer" />
      <rect class="interior" v-bind="interior" :fill="bayFill" />
      <line v-for="(line, index) in grainLines" :key="index" class="grain-line" v-bind="line" />
      <rect v-if="bayHasError" class="error-overlay" v-bind="outer" />
      <rect v-if="baySelected" class="selection-overlay" v-bind="interior" />
      <rect class="focus-overlay" v-bind="interior" />
    </g>

    <text v-if="mode === 'bay'" class="bay-key" v-bind="keyAnchor">{{ bayKey }}</text>
  </g>
</template>

<style scoped>
.shell {
  fill: var(--wall);
}

.grain-line {
  stroke: var(--wall-edge);
  stroke-width: 0.3;
  opacity: 0.7;
  pointer-events: none;
}

.bay-key {
  font-family: var(--mono);
  font-size: 3px;
  fill: var(--text);
  opacity: 0.55;
  text-anchor: middle;
  dominant-baseline: central;
  pointer-events: none;
}

.error-overlay {
  fill: none;
  stroke: var(--danger);
  stroke-width: 0.5;
  stroke-dasharray: 1.2 0.9;
  pointer-events: none;
}

.selection-overlay {
  fill: none;
  stroke: var(--accent);
  stroke-width: 0.5;
  pointer-events: none;
}

.focus-overlay {
  fill: none;
  stroke: var(--accent);
  stroke-width: 0.7;
  opacity: 0;
  pointer-events: none;
}

.bay-tile:focus-visible {
  outline: none;
}

.bay-tile:focus-visible .focus-overlay {
  opacity: 1;
}

.bay-tile:hover .interior {
  filter: brightness(1.12);
}
</style>
