<script setup lang="ts">
/**
 * Procedural assembly. The dialog previews a generated proposal for the
 * current inputs and writes nothing until Apply. The generator is
 * deterministic, so Apply writes the plan the preview shows.
 */
import { computed, ref, watch } from 'vue'

import {
  ASSEMBLY_ROOMS,
  MAX_ASSEMBLY_LEVELS,
  type AssemblyProposal,
  type AssemblyRequest,
  type AssemblyRole,
} from '../domain/assembly.js'
import { bayKeyOf, parseBayKey } from '../domain/geometry.js'
import { getBayPattern } from '../domain/patterns.js'
import { useProjectStore } from '../stores/project.js'

const props = defineProps<{ open: boolean }>()

const emit = defineEmits<{
  applied: [summary: Omit<AssemblyProposal, 'project'>]
  cancel: []
}>()

const store = useProjectStore()
const dialog = ref<HTMLDialogElement | null>(null)

const anchor = ref('A1')
const width = ref(1)
const depth = ref(1)
const levelCount = ref(2)
const seed = ref(1)
const roomCounts = ref<Record<string, number>>({})

const ROLE_LABELS: Readonly<Record<AssemblyRole, string>> = {
  spine: 'Spine',
  passage: 'Passage',
  room: 'Room',
  stair: 'Stair up',
  landing: 'Landing',
}

const ROLE_GLYPHS: Readonly<Record<AssemblyRole, string>> = {
  spine: 'S',
  passage: '',
  room: 'R',
  stair: '↑',
  landing: '↓',
}

watch(
  () => props.open,
  (open) => {
    if (!open) {
      dialog.value?.close()
      return
    }
    // Each opening starts from the whole field on the current level.
    anchor.value = 'A1'
    width.value = store.project.bayCols
    depth.value = store.project.bayRows
    seed.value = randomSeed()
    roomCounts.value = Object.fromEntries(ASSEMBLY_ROOMS.map((room) => [room.patternId, 0]))
    dialog.value?.showModal()
  },
)

const anchorOptions = computed(() => {
  const keys: string[] = []
  for (let j = 0; j < store.project.bayRows; j++) {
    for (let i = 0; i < store.project.bayCols; i++) keys.push(bayKeyOf(i, j))
  }
  return keys
})

const maxWidth = computed(() => store.project.bayCols - parseBayKey(anchor.value).i)
const maxDepth = computed(() => store.project.bayRows - parseBayKey(anchor.value).j)

function clamp(value: number, max: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.min(max, Math.max(1, Math.round(value)))
}

/** Rooms go in turn, one of each kind per round, so mixed requests spread out. */
function requestedRooms(): string[] {
  const rooms: string[] = []
  const most = Math.max(0, ...Object.values(roomCounts.value))
  for (let round = 0; round < most; round++) {
    for (const room of ASSEMBLY_ROOMS) {
      if ((roomCounts.value[room.patternId] ?? 0) > round) rooms.push(room.patternId)
    }
  }
  return rooms
}

const request = computed<AssemblyRequest>(() => ({
  levelId: store.currentLevelId,
  anchorBayKey: anchor.value,
  width: clamp(width.value, maxWidth.value),
  height: clamp(depth.value, maxDepth.value),
  levelCount: clamp(levelCount.value, MAX_ASSEMBLY_LEVELS),
  rooms: requestedRooms(),
  seed: Math.trunc(Number.isFinite(seed.value) ? seed.value : 0),
}))

const preview = computed((): { proposal: AssemblyProposal } | { error: string } | null => {
  if (!props.open) return null
  try {
    return { proposal: store.previewAssembly(request.value) }
  } catch (cause) {
    return { error: (cause as Error).message }
  }
})

const proposal = computed(() => (preview.value && 'proposal' in preview.value ? preview.value.proposal : null))

/** The proposal's levels from the base up, each as rows of footprint bays. */
const levelMaps = computed(() => {
  const result = proposal.value
  if (!result) return []
  const { i: i0, j: j0 } = parseBayKey(request.value.anchorBayKey)
  const base = result.project.levels.find((level) => level.id === request.value.levelId)!
  return result.project.levels
    .filter((level) => level.y >= base.y && result.bays.some((bay) => bay.levelId === level.id))
    .map((level) => ({
      id: level.id,
      label: `${level.name} · y ${level.y}`,
      rows: Array.from({ length: request.value.height }, (_, dj) =>
        Array.from({ length: request.value.width }, (_, di) => {
          const bayKey = bayKeyOf(i0 + di, j0 + dj)
          const placed = result.bays.find((bay) => bay.levelId === level.id && bay.bayKey === bayKey)
          if (placed) {
            const name = getBayPattern(placed.patternId)?.name ?? placed.patternId
            return { bayKey, role: placed.role as AssemblyRole | 'open', glyph: ROLE_GLYPHS[placed.role], title: `${bayKey}: ${name}` }
          }
          const space = level.negativeSpaces?.[bayKey]
          return { bayKey, role: 'open' as const, glyph: '', title: `${bayKey}: ${space ? `open ${space.kind}` : 'unchanged'}` }
        }),
      ),
    }))
})

const issueSummary = computed(() => {
  const issues = proposal.value?.issues ?? []
  const errors = issues.filter((issue) => issue.severity === 'error').length
  const warnings = issues.length - errors
  if (issues.length === 0) return 'The validators report no issues.'
  return `The validators report ${errors} error${errors === 1 ? '' : 's'} and ${warnings} warning${warnings === 1 ? '' : 's'}.`
})

const unplacedSummary = computed(() => {
  const unplaced = proposal.value?.unplacedRooms ?? []
  if (unplaced.length === 0) return ''
  const names = unplaced.map((id) => getBayPattern(id)?.name ?? id)
  return `No room for: ${names.join(', ')}. Widen the footprint or add a level.`
})

function randomSeed(): number {
  return Math.floor(Math.random() * 100_000)
}

function onApply(): void {
  emit('applied', store.assemble(request.value))
}

/** Escape and our own `close()` both land here. The parent owns `open`. */
function onClose(): void {
  if (props.open) emit('cancel')
}
</script>

<template>
  <dialog ref="dialog" class="sheet" aria-labelledby="assemble-title" @close="onClose">
    <form @submit.prevent="onApply">
      <h2 id="assemble-title">Assemble a base</h2>
      <p class="muted">
        Generates passages, rooms, and stairs inside a footprint, starting on {{ store.currentLevel?.name }}. Apply
        replaces everything inside the footprint on the levels shown below. Undo takes it back.
      </p>

      <div class="fields">
        <label>
          From bay
          <select v-model="anchor">
            <option v-for="key in anchorOptions" :key="key" :value="key">{{ key }}</option>
          </select>
        </label>
        <label>
          Footprint width
          <input v-model.number="width" type="number" min="1" :max="maxWidth" required />
        </label>
        <label>
          Footprint depth
          <input v-model.number="depth" type="number" min="1" :max="maxDepth" required />
        </label>
        <label>
          Levels
          <input v-model.number="levelCount" type="number" min="1" :max="MAX_ASSEMBLY_LEVELS" required />
        </label>
        <label>
          Seed
          <input v-model.number="seed" type="number" required />
        </label>
        <button type="button" class="reroll" @click="seed = randomSeed()">New seed</button>
      </div>

      <fieldset class="rooms">
        <legend>Rooms to place</legend>
        <label v-for="room in ASSEMBLY_ROOMS" :key="room.patternId" :title="getBayPattern(room.patternId)?.description">
          <input v-model.number="roomCounts[room.patternId]" type="number" min="0" max="8" />
          {{ getBayPattern(room.patternId)?.name }}
        </label>
      </fieldset>

      <section class="preview" aria-label="Proposal preview">
        <p v-if="preview && 'error' in preview" class="warning" role="alert">{{ preview.error }}</p>
        <template v-else>
          <div class="maps">
            <figure v-for="level in levelMaps" :key="level.id">
              <figcaption>{{ level.label }}</figcaption>
              <div class="map" :style="{ gridTemplateColumns: `repeat(${request.width}, 22px)` }">
                <template v-for="row in level.rows">
                  <span v-for="bay in row" :key="bay.bayKey" class="bay" :class="bay.role" :title="bay.title">{{ bay.glyph }}</span>
                </template>
              </div>
            </figure>
          </div>
          <p class="legend muted">
            <span v-for="(label, role) in ROLE_LABELS" :key="role"><span class="bay" :class="role">{{ ROLE_GLYPHS[role] }}</span>{{ label }}</span>
            <span><span class="bay open" />Open space</span>
          </p>
          <p role="status">{{ issueSummary }}</p>
          <p v-if="unplacedSummary" class="warning">{{ unplacedSummary }}</p>
        </template>
      </section>

      <div class="actions">
        <button type="button" @click="emit('cancel')">Cancel</button>
        <button type="submit" class="primary" :disabled="!proposal">Apply</button>
      </div>
    </form>
  </dialog>
</template>

<style scoped>
.sheet {
  width: min(640px, calc(100vw - 32px));
  padding: 16px;
  color: var(--text);
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}

.sheet::backdrop {
  background: rgb(0 0 0 / 0.4);
}

h2 {
  margin: 0 0 4px;
  font-size: 15px;
}

p {
  margin: 0 0 12px;
}

.fields {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 8px;
}

label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: var(--muted);
}

input,
select {
  width: 72px;
  padding: 4px 6px;
  font: inherit;
  color: var(--text);
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}

.rooms {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  margin: 12px 0;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
}

.rooms legend {
  color: var(--muted);
}

.rooms label {
  flex-direction: row;
  align-items: center;
  color: var(--text);
}

.rooms input {
  width: 48px;
}

.maps {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 8px;
}

figure {
  margin: 0;
}

figcaption {
  margin-bottom: 4px;
  color: var(--muted);
}

.map {
  display: grid;
  gap: 2px;
}

.bay {
  display: inline-grid;
  place-items: center;
  width: 22px;
  height: 22px;
  font-size: 12px;
  border-radius: 3px;
  background: var(--void);
  border: 1px solid var(--border);
}

.spine {
  background: var(--accent);
  color: var(--on-accent);
}

.passage {
  background: var(--cat-circulation);
}

.room {
  background: var(--cat-room);
}

.stair,
.landing {
  background: var(--cat-storage);
}

.legend {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
}

.legend > span {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.legend .bay {
  width: 16px;
  height: 16px;
  font-size: 10px;
}

.warning {
  color: var(--danger);
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}

.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}
</style>
