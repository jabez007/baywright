<script setup lang="ts">
/**
 * PRD §10 — "paint, do not configure".
 *
 * Everything needed to lay down geometry is one click away: pick a module, pick
 * a grain, drag on the canvas. Nothing here opens a modal.
 */
import { computed } from 'vue'

import { MODULE_LIST, categoryOf } from '../domain/modules.js'
import type { Grain } from '../domain/types.js'
import { useProjectStore } from '../stores/project.js'
import type { SaveStatus } from '../persistence/autosave.js'

const props = defineProps<{
  mode: 'bay' | 'cell' | 'footprint'
  moduleId: string
  grain: Grain
  saveStatus: SaveStatus
  saveError?: Error | undefined
  pngBusy: boolean
}>()

const emit = defineEmits<{
  'set-mode': [value: 'bay' | 'cell' | 'footprint']
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

/**
 * Bay and cell are zoom levels; footprint is a third thing — it edits which
 * bays exist rather than what is painted in them. They share a group because
 * they are mutually exclusive about what a click on the plan means.
 */
const MODES = [
  { id: 'bay', label: 'Bay', title: 'Paint a whole bay at a time' },
  { id: 'cell', label: 'Cell', title: 'Paint individual cells' },
  { id: 'footprint', label: 'Footprint', title: 'Add and remove bays to shape the base' },
] as const

const STATUS_TEXT: Record<SaveStatus, string> = {
  idle: 'Not saved yet',
  pending: 'Editing…',
  saving: 'Saving…',
  saved: 'Saved',
  error: 'Save failed',
}

/**
 * Grain is a tool setting, but a bay already under the cursor is almost always
 * what the user means — so selecting a grain also re-cuts the selected bay.
 */
function chooseGrain(grain: Grain): void {
  emit('set-grain', grain)
  const selection = store.selection
  if (selection.kind === 'bay') store.setBayGrain(selection.levelId, selection.bayKey, grain)
}

function statusTitle(): string {
  return props.saveError ? props.saveError.message : STATUS_TEXT[props.saveStatus]
}
</script>

<template>
  <header class="toolbar">
    <div class="group">
      <strong class="brand">Baywright</strong>
      <span class="muted mono">{{ store.project.name }}</span>
    </div>

    <div class="group" role="group" aria-label="Mode">
      <button
        v-for="option in MODES"
        :key="option.id"
        type="button"
        :aria-pressed="mode === option.id"
        :title="option.title"
        @click="emit('set-mode', option.id)"
      >
        {{ option.label }}
      </button>
    </div>

    <div v-if="mode === 'footprint'" class="group" role="group" aria-label="Footprint">
      <button
        type="button"
        :disabled="!canApplyFootprint"
        :title="
          canApplyFootprint
            ? 'Give every other level the same footprint as this one'
            : 'There is only one level'
        "
        @click="emit('apply-footprint')"
      >
        Apply to all levels
      </button>
    </div>

    <div class="group" role="group" aria-label="Grain">
      <button
        v-for="option in GRAINS"
        :key="option"
        type="button"
        :aria-pressed="grain === option"
        :title="`Paint bays at ${option} grain`"
        @click="chooseGrain(option)"
      >
        {{ option }}
      </button>
    </div>

    <div class="group modules" role="group" aria-label="Module">
      <button
        v-for="module in MODULE_LIST"
        :key="module.id"
        type="button"
        class="module"
        :aria-pressed="moduleId === module.id"
        :title="module.description"
        @click="emit('set-module', module.id)"
      >
        <span class="swatch" :style="{ background: `var(--cat-${categoryOf(module.id)})` }" />
        {{ module.name }}
      </button>
    </div>

    <div class="group push" role="group" aria-label="History">
      <button type="button" :disabled="!store.canUndo" title="Undo (Ctrl/Cmd+Z)" @click="store.undo()">Undo</button>
      <button type="button" :disabled="!store.canRedo" title="Redo (Ctrl/Cmd+Shift+Z)" @click="store.redo()">Redo</button>
    </div>

    <div class="group" role="group" aria-label="Project">
      <button type="button" title="Download the project as JSON" @click="emit('export')">JSON</button>
      <button type="button" :disabled="pngBusy" title="Download one PNG plan per level" @click="emit('png')">
        {{ pngBusy ? 'Rendering…' : 'PNG' }}
      </button>
      <button type="button" title="Load a project from a JSON file" @click="emit('import')">Import</button>
      <button type="button" title="Change how many bays the field is" @click="emit('resize')">Resize</button>
      <button type="button" title="Discard this project and start over" @click="emit('reset')">New</button>
    </div>

    <span
      class="status"
      :class="{ failed: saveStatus === 'error' }"
      :title="statusTitle()"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      :aria-label="saveStatus === 'error' ? `Autosave error: ${saveError?.message ?? 'Save failed'}` : `Autosave status: ${STATUS_TEXT[saveStatus]}`"
    >
      {{ STATUS_TEXT[saveStatus] }}
    </span>
    <span v-if="saveStatus === 'error'" class="visually-hidden" role="alert">
      Autosave failed: {{ saveError?.message ?? 'The project could not be saved.' }}
    </span>
  </header>
</template>

<style scoped>
.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 16px;
  padding: 8px 12px;
  background: var(--panel);
  border-bottom: 1px solid var(--border);
}

.group {
  display: flex;
  align-items: center;
  gap: 4px;
}

.group.push {
  margin-left: auto;
}

.brand {
  letter-spacing: 0.02em;
}

.modules {
  flex-wrap: wrap;
  min-width: 0;
}

.module {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 8px;
}

.swatch {
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

@media (max-width: 600px) {
  .toolbar {
    gap: 7px 10px;
    padding: 7px 8px;
  }

  .group {
    min-width: 0;
    flex-wrap: wrap;
  }

  .modules {
    width: 100%;
  }

  .group.push {
    margin-left: 0;
  }
}
</style>
