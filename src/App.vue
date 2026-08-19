<script setup lang="ts">
/**
 * PRD §13 v0 — a single level on a bay field: paint it, and have it still be
 * there after a reload.
 *
 * The level rail, inspector, issue list and BOM panel are v1 and deliberately
 * absent; what is here is the plan canvas, the paint toolbar, and autosave.
 * The bottom bar shows issue counts only, so the validator's verdict is visible
 * even before the issue list exists to explain it.
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import { downloadProject, parseProject } from './export/json.js'
import { MODULE_LIST } from './domain/modules.js'
import type { Grain } from './domain/types.js'
import { loadLastOpenedProject } from './persistence/db.js'
import { useAutosave } from './persistence/autosave.js'
import { useProjectStore } from './stores/project.js'
import FieldSizeDialog from './components/FieldSizeDialog.vue'
import PlanCanvas from './components/PlanCanvas.vue'
import Toolbar from './components/Toolbar.vue'

const store = useProjectStore()
const autosave = useAutosave(store)

const mode = ref<'bay' | 'cell' | 'footprint'>('cell')
const moduleId = ref<string>(MODULE_LIST[0]?.id ?? 'empty')
const grain = ref<Grain>('fine')

const booted = ref(false)
const notice = ref<string | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
/** null when closed, otherwise which of the two things the dialog is doing. */
const sizing = ref<'new' | 'resize' | null>(null)

/** The gestures differ per mode, and a hint for tools you cannot reach is noise. */
const hint = computed(() =>
  mode.value === 'footprint'
    ? 'click a square to add or remove a bay · drag to do several · ⌘Z undo'
    : 'drag to paint · shift-drag to merge · alt-click an edge for sockets · [ ] height · ⌘Z undo',
)

const errorCount = computed(() => store.issues.filter((issue) => issue.severity === 'error').length)
const warningCount = computed(() => store.issues.filter((issue) => issue.severity === 'warning').length)

const CATEGORIES = [
  { id: 'circulation', label: 'Circulation' },
  { id: 'room', label: 'Room' },
  { id: 'service', label: 'Service' },
  { id: 'storage', label: 'Storage' },
] as const

onMounted(async () => {
  window.addEventListener('keydown', onKeyDown)
  try {
    const stored = await loadLastOpenedProject()
    if (stored) {
      store.loadProject(stored)
    } else {
      // Nothing stored yet: persist the starter document immediately, so the
      // very first reload restores rather than silently starting over.
      await autosave.flush()
    }
  } catch (cause) {
    notice.value = `Could not read saved projects: ${(cause as Error).message}`
  } finally {
    booted.value = true
  }
})

onBeforeUnmount(() => window.removeEventListener('keydown', onKeyDown))

/** §10 — the keyboard half of the interaction model. */
function onKeyDown(event: KeyboardEvent): void {
  const target = event.target as HTMLElement | null
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return

  const accel = event.ctrlKey || event.metaKey
  if (accel && event.key.toLowerCase() === 'z') {
    event.preventDefault()
    if (event.shiftKey) store.redo()
    else store.undo()
    return
  }
  if (event.key === 'Escape') {
    store.clearSelection()
    return
  }
  if (event.key === '[' || event.key === ']') {
    const refs = store.selectedRefs
    if (refs.length === 0) return
    event.preventDefault()
    store.batch(() => store.nudgeCellHeight(refs, event.key === ']' ? 1 : -1))
  }
}

function onExport(): void {
  downloadProject(store.toJSON())
}

function onImport(): void {
  fileInput.value?.click()
}

async function onFileChosen(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  try {
    store.loadProject(parseProject(await file.text()))
    notice.value = null
    await autosave.flush()
  } catch (cause) {
    notice.value = `Could not open ${file.name}: ${(cause as Error).message}`
  }
}

async function onSized(options: { bayCols: number; bayRows: number }): Promise<void> {
  const intent = sizing.value
  sizing.value = null
  try {
    if (intent === 'new') store.newProject(options)
    else store.setFieldExtent(options.bayCols, options.bayRows)
    notice.value = null
  } catch (cause) {
    // The only reachable failure is a shrink that would empty a level, which
    // the dialog cannot rule out for the user in advance.
    notice.value = (cause as Error).message
    return
  }
  await autosave.flush()
}
</script>

<template>
  <div class="app">
    <Toolbar
      :mode="mode"
      :module-id="moduleId"
      :grain="grain"
      :save-status="autosave.status.value"
      :save-error="autosave.error.value"
      @set-mode="mode = $event"
      @set-module="moduleId = $event"
      @set-grain="grain = $event"
      @export="onExport"
      @import="onImport"
      @reset="sizing = 'new'"
      @resize="sizing = 'resize'"
    />

    <p v-if="notice" class="notice" role="alert">{{ notice }}</p>

    <main class="canvas">
      <PlanCanvas v-if="booted" :mode="mode" :module-id="moduleId" :grain="grain" />
      <p v-else class="muted loading">Loading…</p>
    </main>

    <footer class="statusbar">
      <span v-if="store.currentLevel" class="mono">
        {{ store.currentLevel.name }} · y {{ store.currentLevel.y }} ·
        {{ store.project.bayCols }}×{{ store.project.bayRows }} bays
      </span>

      <span class="counts">
        <span :class="{ danger: errorCount > 0 }">{{ errorCount }} error{{ errorCount === 1 ? '' : 's' }}</span>
        <span class="muted">{{ warningCount }} warning{{ warningCount === 1 ? '' : 's' }}</span>
      </span>

      <span class="legend">
        <span v-for="category in CATEGORIES" :key="category.id" class="legend-item">
          <span class="swatch" :style="{ background: `var(--cat-${category.id})` }" />
          {{ category.label }}
        </span>
      </span>

      <span class="muted hint">{{ hint }}</span>
    </footer>

    <FieldSizeDialog
      :open="sizing !== null"
      :intent="sizing ?? 'new'"
      :bay-cols="store.project.bayCols"
      :bay-rows="store.project.bayRows"
      @submit="onSized"
      @cancel="sizing = null"
    />

    <input ref="fileInput" type="file" accept="application/json,.json" hidden @change="onFileChosen" />
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.canvas {
  flex: 1;
  min-height: 0;
  padding: 16px;
  display: grid;
  place-items: center;
}

.loading {
  margin: 0;
}

.notice {
  margin: 0;
  padding: 8px 12px;
  background: var(--panel-2);
  border-bottom: 1px solid var(--danger);
  color: var(--danger);
}

.statusbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 20px;
  padding: 7px 12px;
  background: var(--panel);
  border-top: 1px solid var(--border);
}

.counts {
  display: flex;
  gap: 10px;
}

.danger {
  color: var(--danger);
  font-weight: 600;
}

.legend {
  display: flex;
  gap: 12px;
}

.legend-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--muted);
}

.swatch {
  width: 9px;
  height: 9px;
  border-radius: 2px;
  border: 1px solid rgb(0 0 0 / 0.25);
}

.hint {
  margin-left: auto;
}
</style>
