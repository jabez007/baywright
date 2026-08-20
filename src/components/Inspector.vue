<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'

import { allCellRefs, resolveCell } from '../domain/geometry.js'
import { MODULE_LIST } from '../domain/modules.js'
import type { Ceiling, Face, Grain, Socket } from '../domain/types.js'
import { useProjectStore } from '../stores/project.js'

const emit = defineEmits<{
  error: [message: string]
  close: []
}>()
const props = defineProps<{
  sheetMode: boolean
  sheetOpen: boolean
}>()
const store = useProjectStore()
const closeButton = ref<HTMLButtonElement | null>(null)

watch(
  () => props.sheetOpen,
  async (open) => {
    if (!open) return
    await nextTick()
    closeButton.value?.focus()
  },
)

const FACES: readonly { id: Face; label: string }[] = [
  { id: 'n', label: 'North' },
  { id: 'e', label: 'East' },
  { id: 's', label: 'South' },
  { id: 'w', label: 'West' },
  { id: 'up', label: 'Up' },
  { id: 'down', label: 'Down' },
]
const HORIZONTAL_SOCKETS: readonly Socket[] = ['solid', 'corridor', 'arch', 'window', 'bars']
const VERTICAL_SOCKETS: readonly Socket[] = ['solid', 'shaft']
const CEILINGS: readonly Ceiling[] = ['flat', 'dropped', 'vaulted']
const GRAINS: readonly Grain[] = ['fine', 'coarse', 'merged']

const level = computed(() => store.currentLevel)
const selectedBay = computed(() => {
  if (store.selection.kind !== 'bay') return undefined
  return level.value?.bays[store.selection.bayKey]
})
const refs = computed(() => store.selectedRefs)
const cells = computed(() => refs.value.map((ref) => resolveCell(store.project, ref).cell))
const inspectorKind = computed<'level' | 'bay' | 'cells'>(() => {
  if (store.selection.kind === 'bay') return 'bay'
  if (store.selection.kind === 'cells') return 'cells'
  return 'level'
})

const cellTitle = computed(() => {
  if (refs.value.length === 1) {
    const ref = refs.value[0]!
    return `${ref.bayKey}:${ref.cellIndex + 1}`
  }
  return `${refs.value.length} cells`
})
const moduleValue = computed(() => common(cells.value.map((cell) => cell.module)) ?? '')
const heightValue = computed(() => common(cells.value.map((cell) => cell.heightCells)) ?? 0)
const ceilingValue = computed(() => common(cells.value.map((cell) => cell.ceiling)) ?? '')
const paletteValue = computed(() => common(cells.value.map((cell) => cell.paletteOverride ?? '__inherit__')) ?? '__mixed__')
const canDropCeiling = computed(() => cells.value.every((cell) => cell.heightCells === 2))
const hasMergeGroup = computed(() => cells.value.some((cell) => cell.mergeGroup !== undefined))

function common<T>(values: readonly T[]): T | undefined {
  const first = values[0]
  return first !== undefined && values.every((value) => value === first) ? first : undefined
}

function valueOf(event: Event): string {
  return (event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).value
}

function run(change: () => void): void {
  try {
    change()
  } catch (cause) {
    emit('error', (cause as Error).message)
  }
}

function renameLevel(event: Event): void {
  const current = level.value
  if (current) run(() => store.renameLevel(current.id, valueOf(event).trim() || current.name))
}

function moveLevel(event: Event): void {
  const current = level.value
  if (current) run(() => store.setLevelY(current.id, Number(valueOf(event))))
}

function setLevelPalette(event: Event): void {
  const current = level.value
  if (current) run(() => store.setLevelPalette(current.id, valueOf(event)))
}

function setBayGrain(event: Event): void {
  const selection = store.selection
  if (selection.kind !== 'bay') return
  run(() => store.setBayGrain(selection.levelId, selection.bayKey, valueOf(event) as Grain))
}

function setModule(event: Event): void {
  const moduleId = valueOf(event)
  if (moduleId) run(() => store.paintCells(refs.value, moduleId))
}

function setHeight(event: Event): void {
  run(() => store.setCellHeight(refs.value, Number(valueOf(event)) as 1 | 2 | 3))
}

function setCeiling(event: Event): void {
  const ceiling = valueOf(event) as Ceiling
  if (ceiling === 'dropped' && !canDropCeiling.value) return
  run(() => store.setCeiling(refs.value, ceiling))
}

function setPaletteOverride(event: Event): void {
  const value = valueOf(event)
  if (value === '__mixed__') return
  run(() => store.batch(() => {
    for (const ref of refs.value) store.setPaletteOverride(ref, value === '__inherit__' ? null : value)
  }))
}

function socketValue(face: Face): string {
  return common(cells.value.map((cell) => cell.sockets[face])) ?? ''
}

function setSocket(face: Face, event: Event): void {
  const socket = valueOf(event) as Socket
  if (!socket) return
  run(() => store.batch(() => {
    for (const ref of refs.value) store.setSocket(ref, face, socket)
  }))
}

function setNote(event: Event): void {
  const ref = refs.value[0]
  if (ref) run(() => store.setNote(ref, valueOf(event).trim()))
}

function splitMergeGroups(): void {
  const groups = new Set(cells.value.map((cell) => cell.mergeGroup).filter((group): group is string => Boolean(group)))
  if (groups.size === 0) return
  const groupRefs = allCellRefs(store.project).filter((ref) => {
    const group = resolveCell(store.project, ref).cell.mergeGroup
    return group !== undefined && groups.has(group)
  })
  run(() => store.splitCells(groupRefs))
}

function mergeSelected(): void {
  if (refs.value.length < 2) return
  run(() => store.mergeCells(refs.value))
}
</script>

<template>
  <aside
    id="inspector-panel"
    class="inspector"
    aria-labelledby="inspector-title"
    :aria-hidden="sheetMode && !sheetOpen ? 'true' : undefined"
    :inert="sheetMode && !sheetOpen ? true : undefined"
  >
    <header class="panel-heading">
      <div>
        <p class="eyebrow">Selection</p>
        <h2 id="inspector-title">Inspector</h2>
      </div>
      <div class="heading-actions">
        <span class="selection-kind mono">{{ inspectorKind }}</span>
        <button ref="closeButton" type="button" class="mobile-close" aria-label="Close inspector" @click="emit('close')">Close</button>
      </div>
    </header>

    <div v-if="level" class="inspector-body">
      <form v-if="inspectorKind === 'level'" class="form" @submit.prevent>
        <div class="selection-title">
          <strong>{{ level.name }}</strong>
          <span class="muted mono">{{ Object.keys(level.bays).length }} bays</span>
        </div>

        <label>
          <span>Name</span>
          <input :value="level.name" type="text" @change="renameLevel" />
        </label>
        <label>
          <span>Floor y</span>
          <input :value="level.y" type="number" step="4" @change="moveLevel" />
        </label>
        <label>
          <span>Palette</span>
          <select :value="level.paletteId" @change="setLevelPalette">
            <option v-for="palette in store.project.palettes" :key="palette.id" :value="palette.id">
              {{ palette.name }}
            </option>
          </select>
        </label>
      </form>

      <form v-else-if="inspectorKind === 'bay' && store.selection.kind === 'bay' && selectedBay" class="form" @submit.prevent>
        <div class="selection-title">
          <strong>Bay {{ store.selection.bayKey }}</strong>
          <span class="muted mono">{{ selectedBay.cells.length }} cells</span>
        </div>

        <label>
          <span>Key</span>
          <input :value="store.selection.bayKey" readonly />
        </label>
        <label>
          <span>Grain</span>
          <select :value="selectedBay.grain" @change="setBayGrain">
            <option v-for="option in GRAINS" :key="option" :value="option">{{ option }}</option>
          </select>
        </label>
        <p class="field-help">Changing grain re-cuts this bay and may replace mixed cell modules.</p>
      </form>

      <form v-else-if="inspectorKind === 'cells' && cells.length > 0" class="form" @submit.prevent>
        <div class="selection-title">
          <strong>{{ cellTitle }}</strong>
          <span class="muted mono">{{ level.name }}</span>
        </div>

        <label>
          <span>Module</span>
          <select :value="moduleValue" @change="setModule">
            <option v-if="!moduleValue" value="" disabled>Mixed modules</option>
            <option v-for="module in MODULE_LIST" :key="module.id" :value="module.id">{{ module.name }}</option>
          </select>
        </label>

        <div class="field-row">
          <label>
            <span>Height</span>
            <select :value="heightValue" @change="setHeight">
              <option v-if="heightValue === 0" :value="0" disabled>Mixed</option>
              <option :value="1">1 cell · 4 blocks</option>
              <option :value="2">2 cells · 8 blocks</option>
              <option :value="3">3 cells · 12 blocks</option>
            </select>
          </label>
          <label>
            <span>Ceiling</span>
            <select :value="ceilingValue" @change="setCeiling">
              <option v-if="!ceilingValue" value="" disabled>Mixed</option>
              <option
                v-for="option in CEILINGS"
                :key="option"
                :value="option"
                :disabled="option === 'dropped' && !canDropCeiling"
              >
                {{ option }}
              </option>
            </select>
          </label>
        </div>
        <p v-if="!canDropCeiling" class="field-help">Dropped ceilings require every selected cell to be 2 cells high.</p>

        <label>
          <span>Palette override</span>
          <select :value="paletteValue" @change="setPaletteOverride">
            <option v-if="paletteValue === '__mixed__'" value="__mixed__" disabled>Mixed palettes</option>
            <option value="__inherit__">Inherit from level</option>
            <option v-for="palette in store.project.palettes" :key="palette.id" :value="palette.id">
              {{ palette.name }}
            </option>
          </select>
        </label>

        <fieldset>
          <legend>Sockets</legend>
          <div class="socket-grid">
            <label v-for="face in FACES" :key="face.id">
              <span>{{ face.label }}</span>
              <select :value="socketValue(face.id)" @change="setSocket(face.id, $event)">
                <option v-if="!socketValue(face.id)" value="" disabled>Mixed</option>
                <option
                  v-for="socket in face.id === 'up' || face.id === 'down' ? VERTICAL_SOCKETS : HORIZONTAL_SOCKETS"
                  :key="socket"
                  :value="socket"
                >
                  {{ socket }}
                </option>
              </select>
            </label>
          </div>
        </fieldset>

        <label v-if="refs.length === 1">
          <span>Note</span>
          <textarea :value="cells[0]?.note ?? ''" rows="3" placeholder="Construction note" @change="setNote" />
        </label>

        <div class="merge-actions">
          <button
            type="button"
            :disabled="refs.length < 2"
            :title="refs.length < 2 ? 'Select at least two cells by painting a drag' : 'Merge the selected cells'"
            @click="mergeSelected"
          >
            Merge selected
          </button>
          <button type="button" :disabled="!hasMergeGroup" @click="splitMergeGroups">Split merge group</button>
        </div>
      </form>
    </div>
  </aside>
</template>

<style scoped>
.inspector {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--panel);
  border-left: 1px solid var(--border);
  overflow: hidden;
}

.panel-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 14px 10px;
  border-bottom: 1px solid var(--border);
}

.panel-heading h2,
.eyebrow {
  margin: 0;
}

.panel-heading h2 {
  font-size: 15px;
}

.eyebrow {
  color: var(--muted);
  font: 10px/1.4 var(--mono);
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.selection-kind {
  color: var(--muted);
  font-size: 11px;
}

.heading-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.mobile-close {
  display: none;
}

.inspector-body {
  min-height: 0;
  overflow: auto;
}

.form {
  display: grid;
  gap: 13px;
  padding: 14px;
}

.selection-title {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  padding-bottom: 10px;
  border-bottom: 1px solid var(--border);
}

label {
  min-width: 0;
  display: grid;
  gap: 5px;
  color: var(--muted);
  font-size: 11px;
}

.field-row,
.socket-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 9px;
}

.merge-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

fieldset {
  min-width: 0;
  margin: 0;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
}

legend {
  padding: 0 5px;
  color: var(--muted);
  font-size: 11px;
}

.field-help {
  margin: -5px 0 0;
  color: var(--muted);
  font-size: 11px;
  line-height: 1.4;
}

@media (max-width: 900px) {
  .inspector {
    position: fixed;
    right: 8px;
    bottom: 8px;
    left: 8px;
    z-index: 60;
    max-height: min(72dvh, 620px);
    border: 1px solid var(--border);
    border-radius: 10px;
    box-shadow: 0 18px 48px rgb(0 0 0 / 0.28);
    opacity: 0;
    pointer-events: none;
    transform: translateY(calc(100% + 20px));
    transition: transform 160ms ease, opacity 160ms ease;
  }

  .inspector.mobile-open {
    opacity: 1;
    pointer-events: auto;
    transform: translateY(0);
  }

  .mobile-close {
    display: inline-flex;
  }
}

@media (prefers-reduced-motion: reduce) {
  .inspector {
    transition: none;
  }
}

@media (max-width: 560px) {
  .field-row,
  .socket-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
