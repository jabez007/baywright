<script setup lang="ts">
/**
 * PRD §10 — one cell of a bay, drawn in plan.
 *
 * Coordinates are field-space blocks: the block at coordinate `c` occupies the
 * SVG span `c .. c + 1`, so a span of `[lo, hi]` inclusive is `hi - lo + 1`
 * wide. Adjacent cells share a wall plane, so their outer rects overlap by
 * exactly one block — which is correct, since it is one wall.
 *
 * Fill encodes module category only. Errors are a dashed overlay, never a fill
 * change, so a broken cell still reads as the thing it is.
 */
import { computed } from 'vue'

import { cellAxisIndices, interiorSpan, outerSpan } from '../domain/geometry.js'
import { getModule } from '../domain/modules.js'
import type { Cell, Face, Grain, Socket } from '../domain/types.js'
import { moduleFill } from './fills.js'

const props = defineProps<{
  bayKey: string
  cell: Cell
  grain: Grain
  cellIndex: number
  /** Field-space origin of the containing bay. */
  bayX: number
  bayZ: number
  selected: boolean
  hasError: boolean
  /** Cell mode draws sockets and labels; bay mode draws the block only. */
  detailed: boolean
  interactive: boolean
  tabIndex: number
}>()

const axes = computed(() => cellAxisIndices(props.grain, props.cellIndex))

const outer = computed(() => {
  const [x0, x1] = outerSpan(props.grain, axes.value.a)
  const [z0, z1] = outerSpan(props.grain, axes.value.b)
  return rect(props.bayX + x0, props.bayZ + z0, props.bayX + x1, props.bayZ + z1)
})

/**
 * The drawn and clickable shell: each cell owns *half* of every shared wall
 * block, so neighbours partition the plane instead of overlapping.
 *
 * Overlapping shells were a real bug, not a cosmetic one: two cells both
 * covering the shared wall meant the later-drawn one won every hit test, so
 * alt-clicking a cell's own east edge cycled the socket of the bay next door.
 * The field's outer rim is painted by the canvas backdrop.
 */
const shell = computed(() => ({
  x: outer.value.x + 0.5,
  y: outer.value.y + 0.5,
  width: outer.value.width - 1,
  height: outer.value.height - 1,
}))

const interior = computed(() => {
  const [x0, x1] = interiorSpan(props.grain, axes.value.a)
  const [z0, z1] = interiorSpan(props.grain, axes.value.b)
  return rect(props.bayX + x0, props.bayZ + z0, props.bayX + x1, props.bayZ + z1)
})

const fill = computed(() => moduleFill(props.cell.module))

/**
 * Openings in the four wall planes — drawn half a block deep, on this cell's
 * own side of the shared plane.
 *
 * §5.4: two cells connect only if *both* open the shared face. Drawing a
 * full-depth void from one cell would claim a doorway that the exporter will
 * wall up. Two facing halves meet and read as one opening; a lone half reads
 * as the dead end it is, which is the whole point of looking at the plan.
 */
const openings = computed(() => {
  const out: { face: Face; socket: Socket; x: number; y: number; width: number; height: number }[] = []
  const { x, y, width, height } = interior.value
  const o = outer.value
  const DEPTH = 0.5
  for (const face of ['n', 'e', 's', 'w'] as const) {
    const socket = props.cell.sockets[face]
    if (socket === 'solid' || socket === 'shaft') continue
    const eastWest = face === 'e' || face === 'w'
    // The near edge of this cell's half of the shared wall block.
    const plane =
      face === 'e' ? o.x + o.width - 1 : face === 'w' ? o.x + DEPTH : face === 'n' ? o.y + DEPTH : o.y + o.height - 1
    if (socket === 'window') {
      // §5.4 — 1 block, centred. Interior spans are odd, so the centre is exact.
      const centre = eastWest ? y + Math.floor(height / 2) : x + Math.floor(width / 2)
      out.push({
        face,
        socket,
        x: eastWest ? plane : centre,
        y: eastWest ? centre : plane,
        width: eastWest ? DEPTH : 1,
        height: eastWest ? 1 : DEPTH,
      })
      continue
    }
    out.push({
      face,
      socket,
      x: eastWest ? plane : x,
      y: eastWest ? y : plane,
      width: eastWest ? DEPTH : width,
      height: eastWest ? height : DEPTH,
    })
  }
  return out
})

const shaft = computed<'up' | 'down' | 'both' | null>(() => {
  const up = props.cell.sockets.up === 'shaft'
  const down = props.cell.sockets.down === 'shaft'
  return up && down ? 'both' : up ? 'up' : down ? 'down' : null
})

const centre = computed(() => ({
  x: interior.value.x + interior.value.width / 2,
  y: interior.value.y + interior.value.height / 2,
}))

/** Hover text: the plan cannot show vertical extent, so the tooltip must. */
const label = computed(() => {
  const module = getModule(props.cell.module)
  const parts = [module?.name ?? props.cell.module, `${props.cell.heightCells} cell${props.cell.heightCells > 1 ? 's' : ''} tall`, props.cell.ceiling]
  if (props.cell.mergeGroup) parts.push('merged')
  if (props.cell.note) parts.push(props.cell.note)
  return `${props.bayKey} cell ${props.cellIndex + 1} · ${parts.join(' · ')}`
})

function rect(x0: number, z0: number, x1: number, z1: number) {
  return { x: x0, y: z0, width: x1 - x0 + 1, height: z1 - z0 + 1 }
}
</script>

<template>
  <g
    class="cell"
    :class="{ selected, error: hasError }"
    :data-bay="bayKey"
    :data-cell="cellIndex"
    :data-plan-target="interactive ? 'cell' : undefined"
    :tabindex="interactive ? tabIndex : undefined"
    :role="interactive ? 'button' : undefined"
    :aria-label="interactive ? label : undefined"
  >
    <title>{{ label }}</title>

    <rect class="shell" v-bind="shell" />
    <rect class="interior" v-bind="interior" :fill="fill" />

    <template v-if="detailed">
      <rect
        v-for="opening in openings"
        :key="opening.face"
        class="opening"
        :class="`socket-${opening.socket}`"
        :x="opening.x"
        :y="opening.y"
        :width="opening.width"
        :height="opening.height"
        :fill="opening.socket === 'bars' ? 'url(#bars-hatch)' : fill"
      />

      <!-- Vertical extent has no plan footprint, so it is annotated. -->
      <text v-if="cell.heightCells > 1" class="height" :x="interior.x + 0.5" :y="interior.y + interior.height - 0.35">
        {{ cell.heightCells }}<tspan v-if="cell.ceiling === 'dropped'" class="plenum">·</tspan>
      </text>

      <text v-if="shaft" class="shaft" :x="centre.x" :y="centre.y">
        {{ shaft === 'both' ? '⇅' : shaft === 'up' ? '▲' : '▼' }}
      </text>
    </template>

    <rect v-if="hasError" class="error-overlay" v-bind="shell" />
    <rect v-if="selected" class="selection-overlay" v-bind="interior" />
    <rect class="focus-overlay" v-bind="interior" />
  </g>
</template>

<style scoped>
.shell {
  fill: var(--wall);
}

.interior {
  stroke: none;
}

.opening {
  stroke: none;
}

/* An arch is a partial-height opening; the plan can only hint at it. */
.socket-arch {
  opacity: 0.55;
}

.height,
.shaft {
  fill: var(--text);
  opacity: 0.65;
  pointer-events: none;
  font-family: var(--mono);
}

.height {
  font-size: 1.6px;
}

.plenum {
  fill: var(--accent);
  font-weight: 700;
}

.shaft {
  font-size: 2.4px;
  text-anchor: middle;
  dominant-baseline: central;
}

/* §10 — errors are a dashed border, never a fill change. */
.error-overlay {
  fill: none;
  stroke: var(--danger);
  stroke-width: 0.45;
  stroke-dasharray: 1 0.75;
  pointer-events: none;
}

.selection-overlay {
  fill: none;
  stroke: var(--accent);
  stroke-width: 2px;
  vector-effect: non-scaling-stroke;
  pointer-events: none;
}

.focus-overlay {
  fill: none;
  stroke: var(--accent);
  stroke-width: 2px;
  stroke-dasharray: 4 3;
  vector-effect: non-scaling-stroke;
  opacity: 0;
  pointer-events: none;
}

.cell:focus {
  outline: none;
}

.cell:focus-visible .focus-overlay {
  opacity: 1;
}

.cell[data-pointer-focus='true'] .focus-overlay {
  opacity: 0;
}

.cell:focus-visible .selection-overlay {
  opacity: 0;
}

.cell:hover .interior {
  filter: brightness(1.12);
}
</style>
