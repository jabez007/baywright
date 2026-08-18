<script setup lang="ts">
/**
 * PRD §10 — "paint, do not configure".
 *
 * Everything needed to lay down geometry is one click away: pick a module, pick
 * a grain, drag on the canvas. Nothing here opens a modal.
 */
import { MODULE_LIST, categoryOf } from '../domain/modules.js'
import type { Grain } from '../domain/types.js'
import { useProjectStore } from '../stores/project.js'
import type { SaveStatus } from '../persistence/autosave.js'

const props = defineProps<{
  mode: 'bay' | 'cell'
  moduleId: string
  grain: Grain
  saveStatus: SaveStatus
  saveError?: Error | undefined
}>()

const emit = defineEmits<{
  'set-mode': [value: 'bay' | 'cell']
  'set-module': [value: string]
  'set-grain': [value: Grain]
  export: []
  import: []
  reset: []
}>()

const store = useProjectStore()

const GRAINS: readonly Grain[] = ['fine', 'coarse', 'merged']

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

    <div class="group" role="group" aria-label="Zoom mode">
      <button
        v-for="option in (['bay', 'cell'] as const)"
        :key="option"
        type="button"
        :aria-pressed="mode === option"
        @click="emit('set-mode', option)"
      >
        {{ option === 'bay' ? 'Bay' : 'Cell' }}
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
      <button type="button" title="Download the project as JSON" @click="emit('export')">Export</button>
      <button type="button" title="Load a project from a JSON file" @click="emit('import')">Import</button>
      <button type="button" title="Discard this project and start over" @click="emit('reset')">New</button>
    </div>

    <span class="status" :class="{ failed: saveStatus === 'error' }" :title="statusTitle()">
      {{ STATUS_TEXT[saveStatus] }}
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
</style>
