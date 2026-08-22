<script setup lang="ts">
/** PRD §10: project commands above, contextual canvas controls below. */
import { computed } from 'vue'

import { MODULE_LIST, categoryOf } from '../domain/modules.js'
import type { Grain } from '../domain/types.js'
import { useProjectStore } from '../stores/project.js'
import type { SaveStatus } from '../persistence/autosave.js'

const props = defineProps<{
  view: 'bay' | 'cell'
  tool: 'select' | 'paint' | 'empty' | 'footprint'
  moduleId: string
  grain: Grain
  saveStatus: SaveStatus
  saveError?: Error | undefined
  pngBusy: boolean
}>()

const emit = defineEmits<{
  'set-view': [value: 'bay' | 'cell']
  'set-tool': [value: 'select' | 'paint' | 'empty' | 'footprint']
  'set-module': [value: string]
  'set-grain': [value: Grain]
  export: []
  png: []
  import: []
  reset: []
  resize: []
  'apply-footprint': []
}>()

const store = useProjectStore()

/** One level is its own footprint already, so there is nothing to stamp onto. */
const canApplyFootprint = computed(() => store.project.levels.length > 1)

const GRAINS: readonly Grain[] = ['fine', 'coarse', 'merged']

const VIEWS = [
  { id: 'bay', label: 'Bays' },
  { id: 'cell', label: 'Cells' },
] as const

const TOOLS = [
  { id: 'select', label: 'Select', title: 'Inspect the plan without changing it' },
  { id: 'paint', label: 'Paint', title: 'Apply the chosen module' },
  { id: 'empty', label: 'Empty', title: 'Clear modules without changing bay detail' },
  { id: 'footprint', label: 'Footprint', title: 'Add and remove bays' },
] as const

const MODULE_GROUPS = [
  { id: 'circulation', label: 'Circulation' },
  { id: 'room', label: 'Rooms' },
  { id: 'service', label: 'Service' },
  { id: 'storage', label: 'Storage' },
].map((category) => ({
  ...category,
  modules: MODULE_LIST.filter((module) => module.id !== 'empty' && module.category === category.id),
}))

const STATUS_TEXT: Record<SaveStatus, string> = {
  idle: 'Not saved yet',
  pending: 'Editing…',
  saving: 'Saving…',
  saved: 'Saved',
  error: 'Save failed',
}

function chooseGrain(grain: Grain): void {
  emit('set-grain', grain)
}

function statusTitle(): string {
  return props.saveError ? props.saveError.message : STATUS_TEXT[props.saveStatus]
}

/**
 * What the live region announces. It has to live in the region's content:
 * screen readers announce a live region from the text that changed, and an
 * `aria-label` swap is not reliably treated as such a change.
 */
function statusAnnouncement(): string {
  return props.saveStatus === 'error'
    ? `Autosave failed: ${props.saveError?.message ?? 'The project could not be saved.'}`
    : `Autosave status: ${STATUS_TEXT[props.saveStatus]}`
}

function chooseModule(event: Event): void {
  emit('set-module', (event.target as HTMLSelectElement).value)
}
</script>

<template>
  <header class="toolbar">
    <div class="app-bar">
      <div class="identity">
        <strong class="brand">Baywright</strong>
        <span class="project-name">{{ store.project.name }}</span>
      </div>

      <div class="app-actions">
        <span
          class="status"
          :class="{ failed: saveStatus === 'error' }"
          :title="statusTitle()"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <span aria-hidden="true">{{ STATUS_TEXT[saveStatus] }}</span>
          <span class="visually-hidden">{{ statusAnnouncement() }}</span>
        </span>
        <button type="button" :disabled="pngBusy || !store.canUndo" title="Undo (Ctrl/Cmd+Z)" @click="store.undo()">Undo</button>
        <button type="button" :disabled="pngBusy || !store.canRedo" title="Redo (Ctrl/Cmd+Shift+Z)" @click="store.redo()">Redo</button>
        <details class="project-menu">
          <summary>Project</summary>
          <div class="menu-panel">
            <button type="button" @click="emit('export')">Export JSON</button>
            <button type="button" :disabled="pngBusy" @click="emit('png')">{{ pngBusy ? 'Rendering plans…' : 'Export PNG plans' }}</button>
            <button type="button" :disabled="pngBusy" @click="emit('import')">Import project</button>
            <button type="button" :disabled="pngBusy" @click="emit('resize')">Resize field</button>
            <button type="button" class="danger" :disabled="pngBusy" @click="emit('reset')">New project</button>
          </div>
        </details>
      </div>
    </div>

    <div class="canvas-bar">
      <div v-if="tool !== 'footprint'" class="labelled-group">
        <span class="group-label">View</span>
        <div class="group" role="group" aria-label="View">
          <button
            v-for="option in VIEWS"
            :key="option.id"
            type="button"
            :aria-pressed="view === option.id"
            :disabled="pngBusy"
            @click="emit('set-view', option.id)"
          >
            {{ option.label }}
          </button>
        </div>
      </div>

      <div class="labelled-group">
        <span class="group-label">Tool</span>
        <div class="group" role="group" aria-label="Tool">
          <button
            v-for="option in TOOLS"
            :key="option.id"
            type="button"
            :aria-pressed="tool === option.id"
            :title="option.title"
            :disabled="pngBusy"
            @click="emit('set-tool', option.id)"
          >
            {{ option.label }}
          </button>
        </div>
      </div>

      <label v-if="tool === 'paint'" class="module-picker">
        <span class="group-label">Module</span>
        <span class="module-control">
          <span class="swatch" :style="{ background: `var(--cat-${categoryOf(moduleId)})` }" />
          <select aria-label="Module" :value="moduleId" :disabled="pngBusy" @change="chooseModule">
            <optgroup v-for="category in MODULE_GROUPS" :key="category.id" :label="category.label">
              <option v-for="module in category.modules" :key="module.id" :value="module.id">{{ module.name }}</option>
            </optgroup>
          </select>
        </span>
      </label>

      <div v-if="tool === 'footprint' || (tool === 'paint' && view === 'bay')" class="labelled-group">
        <span class="group-label">Bay detail</span>
        <div class="group" role="group" aria-label="Bay detail">
          <button v-for="option in GRAINS" :key="option" type="button" :aria-pressed="grain === option" :disabled="pngBusy" @click="chooseGrain(option)">
            {{ option }}
          </button>
        </div>
      </div>

      <button
        v-if="tool === 'footprint'"
        type="button"
        :disabled="pngBusy || !canApplyFootprint"
        :title="canApplyFootprint ? 'Give every other level the same footprint as this one' : 'There is only one level'"
        @click="emit('apply-footprint')"
      >
        Apply to all levels
      </button>

      <details class="controls-help">
        <summary aria-label="Show canvas controls">Controls</summary>
        <div class="help-panel">
          <strong>Canvas controls</strong>
          <span>Drag to select or paint several targets.</span>
          <span>Double-click a bay to open its cells.</span>
          <span>Use Empty to clear cells or bays. Clearing a bay keeps its bay detail.</span>
          <span>Shift-drag while painting to merge cells.</span>
          <span>Alt-click a cell edge to change its socket.</span>
          <span>Use arrow keys inside the plan. Enter or Space applies the active tool.</span>
        </div>
      </details>
    </div>

  </header>
</template>

<style scoped>
.toolbar {
  background: var(--panel);
  border-bottom: 1px solid var(--border);
  position: relative;
  z-index: 20;
}

.app-bar,
.canvas-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
}

.app-bar {
  min-height: 48px;
  justify-content: space-between;
  border-bottom: 1px solid var(--border);
}

.canvas-bar {
  min-height: 54px;
  flex-wrap: wrap;
  background: var(--bg);
}

.identity,
.app-actions,
.group,
.module-control {
  display: flex;
  align-items: center;
}

.identity {
  min-width: 0;
  gap: 9px;
}

.app-actions {
  gap: 6px;
}

.group {
  gap: 3px;
}

.labelled-group,
.module-picker {
  display: grid;
  gap: 3px;
}

.brand {
  letter-spacing: 0.02em;
}

.project-name {
  min-width: 0;
  overflow: hidden;
  color: var(--muted);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.group-label {
  color: var(--muted);
  font: 10px/1 var(--mono);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.canvas-bar button,
.app-actions button,
.project-menu summary,
.controls-help summary {
  min-height: 34px;
}

.module-control {
  position: relative;
}

.module-control select {
  width: 210px;
  padding-left: 27px;
}

.swatch {
  position: absolute;
  left: 9px;
  z-index: 1;
  width: 9px;
  height: 9px;
  border-radius: 2px;
  border: 1px solid rgb(0 0 0 / 0.25);
}

.status {
  font-variant-numeric: tabular-nums;
  color: var(--muted);
}

.status.failed {
  color: var(--danger);
}

.project-menu,
.controls-help {
  position: relative;
}

.project-menu summary,
.controls-help summary {
  display: flex;
  align-items: center;
  padding: 4px 10px;
  list-style: none;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  cursor: pointer;
}

.project-menu summary::-webkit-details-marker,
.controls-help summary::-webkit-details-marker {
  display: none;
}

.menu-panel,
.help-panel {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 30;
  display: grid;
  gap: 5px;
  padding: 8px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.16);
}

.menu-panel {
  width: 190px;
}

.menu-panel button {
  width: 100%;
  text-align: left;
}

.menu-panel .danger {
  color: var(--danger);
}

.controls-help {
  margin-left: auto;
}

.help-panel {
  width: min(340px, calc(100vw - 24px));
  color: var(--muted);
  font-size: 12px;
  line-height: 1.4;
}

.help-panel strong {
  color: var(--text);
}

@media (max-width: 900px) {
  .toolbar {
    position: sticky;
    top: 0;
  }

  .app-bar,
  .canvas-bar {
    padding-inline: 8px;
  }

  .canvas-bar button,
  .app-actions button,
  .project-menu summary,
  .controls-help summary,
  .module-control select {
    min-height: 40px;
  }
}

@media (max-width: 560px) {
  .app-bar {
    min-height: 52px;
  }

  .brand {
    font-size: 13px;
  }

  .project-name,
  .status {
    font-size: 11px;
  }

  .app-actions {
    gap: 4px;
  }

  .app-actions button {
    padding-inline: 8px;
  }

  .canvas-bar {
    align-items: end;
    gap: 7px;
  }

  .module-picker {
    flex: 1 1 150px;
  }

  .module-control select {
    width: 100%;
  }

  .controls-help summary {
    width: 40px;
    justify-content: center;
    overflow: hidden;
    color: transparent;
    font-size: 0;
  }

  .controls-help summary::after {
    content: '?';
    color: var(--text);
    font-size: 16px;
    font-weight: 700;
  }
}
</style>
