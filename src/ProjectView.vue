<script setup lang="ts">
/** PRD §10 v1 workspace: stack, plan, inspector, issues, and materials. */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { downloadProject, parseProject } from './export/json.js'
import { exportSvgAsPng, pngFilename } from './export/png.js'
import { parseBayKey } from './domain/geometry.js'
import { MODULE_LIST } from './domain/modules.js'
import type { Grain, Project } from './domain/types.js'
import { loadLastOpenedProject, loadProject as loadStoredProject } from './persistence/db.js'
import { useAutosave } from './persistence/autosave.js'
import { type Selection, useProjectStore } from './stores/project.js'
import BomPanel from './components/BomPanel.vue'
import FieldSizeDialog from './components/FieldSizeDialog.vue'
import Inspector from './components/Inspector.vue'
import IssueList from './components/IssueList.vue'
import LevelRail from './components/LevelRail.vue'
import PlanCanvas from './components/PlanCanvas.vue'
import Toolbar from './components/Toolbar.vue'

const store = useProjectStore()
const autosave = useAutosave(store)
const route = useRoute()
const router = useRouter()

const view = ref<'bay' | 'cell'>('bay')
const tool = ref<'select' | 'paint' | 'empty' | 'footprint'>('select')
const mode = computed<'bay' | 'cell' | 'footprint'>(() => tool.value === 'footprint' ? 'footprint' : view.value)
const moduleId = ref<string>(MODULE_LIST[0]?.id ?? 'empty')
const grain = ref<Grain>('fine')

const booted = ref(false)
const notice = ref<string | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const planCanvas = ref<InstanceType<typeof PlanCanvas> | null>(null)
const pngBusy = ref(false)
const outputPanel = ref<'issues' | 'materials' | null>(null)
const inspectorOpen = ref(false)
const narrowViewport = ref(false)
/** null when closed, otherwise which of the two things the dialog is doing. */
const sizing = ref<'new' | 'resize' | null>(null)
let routeSyncSuspensions = 0
let routeRequest = 0
let narrowMedia: MediaQueryList | null = null
let inspectorReturnFocus: HTMLElement | SVGElement | null = null

function syncNarrowViewport(): void {
  narrowViewport.value = narrowMedia?.matches ?? false
}

function openInspector(): void {
  const active = document.activeElement
  inspectorReturnFocus = active instanceof HTMLElement || active instanceof SVGElement ? active : null
  inspectorOpen.value = true
}

async function closeInspector(): Promise<void> {
  inspectorOpen.value = false
  await nextTick()
  if (inspectorReturnFocus?.isConnected) inspectorReturnFocus.focus()
  inspectorReturnFocus = null
}

/** The gestures differ per mode, and a hint for tools you cannot reach is noise. */
const hint = computed(() =>
  mode.value === 'footprint'
    ? 'Click or drag to add and remove bays. Ctrl/Cmd+Z undoes the last change.'
    : tool.value === 'select'
      ? mode.value === 'bay'
        ? 'Click a bay to inspect it. Double-click to edit its cells.'
        : 'Click or drag across cells to select them without changing the plan.'
      : tool.value === 'empty'
        ? mode.value === 'bay'
          ? 'Click or drag to clear bays without changing their bay detail.'
          : 'Click or drag to clear cells.'
      : mode.value === 'bay'
        ? 'Click or drag to paint whole bays.'
        : 'Click or drag to paint cells. Exact properties remain available in the inspector.',
)

const bayOptions = computed(() => {
  const level = store.currentLevel
  if (!level) return []
  return Object.keys(level.bays).sort((left, right) => {
    const a = parseBayKey(left)
    const b = parseBayKey(right)
    return a.j - b.j || a.i - b.i
  })
})

const CATEGORIES = [
  { id: 'circulation', label: 'Circulation' },
  { id: 'room', label: 'Room' },
  { id: 'service', label: 'Service' },
  { id: 'storage', label: 'Storage' },
] as const

function routeParam(value: string | string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : value?.[0]
}

function canonicalRoute() {
  return {
    name: 'project-level' as const,
    params: { id: store.project.id, levelId: store.currentLevelId },
  }
}

function routeMatchesCurrent(): boolean {
  return route.name === 'project-level'
    && routeParam(route.params.id) === store.project.id
    && routeParam(route.params.levelId) === store.currentLevelId
}

async function replaceWithCanonicalRoute(): Promise<void> {
  if (!routeMatchesCurrent()) await router.replace(canonicalRoute())
}

async function withRouteSyncSuspended<T>(work: () => T | Promise<T>): Promise<T> {
  routeSyncSuspensions++
  try {
    return await work()
  } finally {
    try {
      // Let store watchers observe the final state while synchronization is still suspended.
      await nextTick()
    } finally {
      routeSyncSuspensions--
    }
  }
}

async function rejectRoute(request: number, message: string): Promise<void> {
  if (request !== routeRequest) return
  notice.value = message
  try {
    await withRouteSyncSuspended(replaceWithCanonicalRoute)
  } catch (cause) {
    notice.value = `Could not update the project URL: ${(cause as Error).message}`
  }
}

async function loadRouteAfterBoot(): Promise<void> {
  const request = ++routeRequest
  const projectId = route.name === 'project-level' ? routeParam(route.params.id) : undefined
  const levelId = route.name === 'project-level' ? routeParam(route.params.levelId) : undefined

  if (!projectId) {
    await rejectRoute(request, 'The requested project route is incomplete.')
    return
  }

  if (projectId === store.project.id) {
    if (levelId && store.project.levels.some((level) => level.id === levelId)) {
      if (levelId !== store.currentLevelId) {
        await withRouteSyncSuspended(() => store.setCurrentLevel(levelId))
      }
    } else {
      await rejectRoute(request, 'The requested level is not stored in this project.')
    }
    return
  }

  try {
    await autosave.flush()
  } catch (cause) {
    await rejectRoute(request, `Could not save the current project before opening another: ${(cause as Error).message}`)
    return
  }
  if (request !== routeRequest) return

  let stored: Project | undefined
  try {
    stored = await loadStoredProject(projectId)
  } catch (cause) {
    await rejectRoute(request, `Could not open the requested project: ${(cause as Error).message}`)
    return
  }
  if (request !== routeRequest) return
  if (!stored) {
    await rejectRoute(request, `No stored project has id '${projectId}'.`)
    return
  }

  await withRouteSyncSuspended(async () => {
    store.loadProject(stored)
    if (levelId && stored.levels.some((level) => level.id === levelId)) store.setCurrentLevel(levelId)
    await replaceWithCanonicalRoute()
  })
  if (request === routeRequest) notice.value = null
}

onMounted(async () => {
  window.addEventListener('keydown', onKeyDown)
  narrowMedia = window.matchMedia('(max-width: 900px)')
  syncNarrowViewport()
  narrowMedia.addEventListener('change', syncNarrowViewport)
  const initialPath = route.fullPath
  try {
    const requestedProjectId = route.name === 'project-level' ? routeParam(route.params.id) : undefined
    const requestedLevelId = route.name === 'project-level' ? routeParam(route.params.levelId) : undefined
    let stored: Project | undefined

    if (requestedProjectId) {
      try {
        stored = await loadStoredProject(requestedProjectId)
      } catch {
        // Recovery below skips an invalid requested record and finds the newest valid project.
      }
    }
    stored ??= await loadLastOpenedProject()

    if (stored) {
      store.loadProject(stored)
      if (
        stored.id === requestedProjectId
        && requestedLevelId
        && stored.levels.some((level) => level.id === requestedLevelId)
      ) {
        store.setCurrentLevel(requestedLevelId)
      }
    } else {
      // Nothing stored yet: persist the starter document immediately, so the
      // very first reload restores rather than silently starting over.
      await autosave.flush()
    }
  } catch (cause) {
    notice.value = `Could not read saved projects: ${(cause as Error).message}`
  } finally {
    if (route.fullPath === initialPath) {
      try {
        await replaceWithCanonicalRoute()
      } catch (cause) {
        notice.value = `Could not update the project URL: ${(cause as Error).message}`
      }
    }
    booted.value = true
    if (route.fullPath !== initialPath) void loadRouteAfterBoot()
  }
})

watch(
  () => [store.project.id, store.currentLevelId] as const,
  () => {
    if (!booted.value || routeSyncSuspensions > 0 || routeMatchesCurrent()) return
    void router.push(canonicalRoute()).catch((cause: unknown) => {
      notice.value = `Could not update the project URL: ${(cause as Error).message}`
    })
  },
)

watch(
  () => route.fullPath,
  () => {
    if (!booted.value) return
    void loadRouteAfterBoot()
  },
)

watch(
  () => store.selection,
  (selection) => {
    if (!pngBusy.value && (selection.kind === 'bay' || selection.kind === 'cells')) openInspector()
  },
  { deep: true },
)

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeyDown)
  narrowMedia?.removeEventListener('change', syncNarrowViewport)
})

/** §10 — the keyboard half of the interaction model. */
function onKeyDown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && narrowViewport.value && inspectorOpen.value) {
    event.preventDefault()
    void closeInspector()
    return
  }
  const target = event.target as HTMLElement | null
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return

  // A PNG run walks the level list across several ticks and restores the view
  // afterwards. An edit landing in that window belongs to a project the run has
  // already read, so the shortcuts that mutate one stay shut until it is done.
  // Escape still clears the selection, which the run does between levels anyway.
  if (pngBusy.value && event.key !== 'Escape') return

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

async function onExportPng(): Promise<void> {
  if (pngBusy.value) return
  pngBusy.value = true
  notice.value = null
  const previousLevelId = store.currentLevelId
  const previousSelection = JSON.parse(JSON.stringify(store.selection)) as Selection
  const previousView = view.value
  const previousTool = tool.value
  const levels = store.project.levels.map((level) => ({ id: level.id, name: level.name, y: level.y }))
  const failures: string[] = []

  routeSyncSuspensions++
  try {
    // Cell mode deliberately shows one expanded bay. PNG plans still need the
    // complete level, so render the full-field bay view only for the export.
    store.clearSelection()
    view.value = 'bay'
    tool.value = 'select'
    await nextTick()
    for (const level of levels) {
      try {
        store.setCurrentLevel(level.id)
        // Keep this immediately before the render tick so every cloned SVG is clean.
        store.clearSelection()
        await nextTick()
        const svg = planCanvas.value?.getSvgElement()
        if (!svg) throw new Error('The plan is not ready')
        await exportSvgAsPng(svg, {
          filename: pngFilename(store.project.name, level.name, level.y),
        })
      } catch (cause) {
        failures.push(`${level.name}: ${(cause as Error).message}`)
      }
    }
  } finally {
    try {
      view.value = previousView
      tool.value = previousTool
      if (store.project.levels.some((level) => level.id === previousLevelId)) {
        store.setCurrentLevel(previousLevelId)
        try {
          store.select(previousSelection)
        } catch {
          store.clearSelection()
        }
      }
      await nextTick()
    } finally {
      routeSyncSuspensions--
      pngBusy.value = false
    }
  }

  if (failures.length > 0) notice.value = `Could not export ${failures.length} plan${failures.length === 1 ? '' : 's'}: ${failures.join('; ')}`
}

function onImport(): void {
  fileInput.value?.click()
}

async function onFileChosen(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  let imported: Project
  try {
    imported = parseProject(await file.text())
  } catch (cause) {
    notice.value = `Could not open ${file.name}: ${(cause as Error).message}`
    return
  }

  const previous = store.toJSON()
  try {
    await autosave.flush()
  } catch (cause) {
    notice.value = `Could not save the current project before opening ${file.name}: ${(cause as Error).message}`
    return
  }

  store.loadImportedProjectAsCopy(imported)
  try {
    await autosave.flush()
    notice.value = null
  } catch (cause) {
    store.loadProject(previous)
    notice.value = `Could not save the imported copy of ${file.name}: ${(cause as Error).message}`
  }
}

function onApplyFootprint(): void {
  store.applyFootprintToAllLevels(store.currentLevelId)
}

function onChooseBay(event: Event): void {
  const bayKey = (event.target as HTMLSelectElement).value
  if (!bayKey || !store.currentLevel) return
  store.select({ kind: 'bay', levelId: store.currentLevel.id, bayKey })
}

async function onSized(options: { bayCols: number; bayRows: number }): Promise<void> {
  const intent = sizing.value
  sizing.value = null
  if (intent === 'new') {
    const previous = store.toJSON()
    try {
      await autosave.flush()
    } catch (cause) {
      notice.value = `Could not save the current project before creating a new one: ${(cause as Error).message}`
      return
    }

    store.newProject(options)
    try {
      await autosave.flush()
      notice.value = null
    } catch (cause) {
      store.loadProject(previous)
      notice.value = `Could not save the new project: ${(cause as Error).message}`
    }
    return
  }

  try {
    store.setFieldExtent(options.bayCols, options.bayRows)
  } catch (cause) {
    // The only reachable failure is a shrink that would empty a level, which
    // the dialog cannot rule out for the user in advance.
    notice.value = (cause as Error).message
    return
  }
  try {
    await autosave.flush()
    notice.value = null
  } catch (cause) {
    notice.value = `Could not save the resized project: ${(cause as Error).message}`
  }
}
</script>

<template>
  <div class="app">
    <a class="skip-link" href="#floor-plan-editor" @click.prevent="planCanvas?.focusActiveTarget()">Skip to plan</a>
    <Toolbar
      :view="view"
      :tool="tool"
      :module-id="moduleId"
      :grain="grain"
      :save-status="autosave.status.value"
      :save-error="autosave.error.value"
      :png-busy="pngBusy"
      @set-view="view = $event"
      @set-tool="tool = $event"
      @set-module="moduleId = $event"
      @set-grain="grain = $event"
      @export="onExport"
      @png="onExportPng"
      @import="onImport"
      @reset="sizing = 'new'"
      @resize="sizing = 'resize'"
      @apply-footprint="onApplyFootprint"
    />

    <p v-if="notice" class="notice" role="alert">{{ notice }}</p>

    <main class="workspace" :class="{ 'output-open': outputPanel !== null }">
      <LevelRail class="levels-region" @error="notice = $event" />

      <section id="plan-canvas" class="canvas-region" aria-label="Plan canvas" tabindex="-1">
        <header class="canvas-context">
          <span v-if="store.currentLevel" class="level-context">
            <strong>{{ store.currentLevel.name }}</strong>
            <span class="muted mono">y {{ store.currentLevel.y }} · {{ store.project.bayCols }}×{{ store.project.bayRows }} bays</span>
          </span>
          <span class="legend" aria-label="Module categories">
            <span v-for="category in CATEGORIES" :key="category.id" class="legend-item">
              <span class="swatch" :style="{ background: `var(--cat-${category.id})` }" />
              {{ category.label }}
            </span>
          </span>
          <label v-if="mode === 'cell'" class="bay-chooser">
            <span>Expanded bay</span>
            <select :value="store.focusedBayKey" @change="onChooseBay">
              <option v-for="bayKey in bayOptions" :key="bayKey" :value="bayKey">Bay {{ bayKey }}</option>
            </select>
          </label>
          <button
            type="button"
            class="mobile-inspector-trigger"
            aria-controls="inspector-panel"
            :aria-expanded="inspectorOpen"
            @click="openInspector"
          >
            Inspector
          </button>
        </header>
        <div class="canvas-stage">
          <PlanCanvas
            v-if="booted"
            ref="planCanvas"
            :mode="mode"
            :tool="tool === 'footprint' ? 'select' : tool"
            :module-id="moduleId"
            :grain="grain"
            :frozen="pngBusy"
            @open-bay="view = 'cell'"
            @error="notice = $event"
          />
          <p v-else class="muted loading">Loading…</p>
        </div>
        <p class="canvas-hint muted">{{ hint }}</p>
      </section>

      <Inspector
        class="inspector-region"
        :class="{ 'mobile-open': inspectorOpen }"
        :sheet-mode="narrowViewport"
        :sheet-open="narrowViewport && inspectorOpen"
        @error="notice = $event"
        @close="closeInspector"
      />

      <section class="bottom-region" aria-label="Project output">
        <header class="output-tabs">
          <button
            type="button"
            :aria-pressed="outputPanel === 'issues'"
            @click="outputPanel = outputPanel === 'issues' ? null : 'issues'"
          >
            Issues <span class="count mono">{{ store.issues.length }}</span>
          </button>
          <button
            type="button"
            :aria-pressed="outputPanel === 'materials'"
            @click="outputPanel = outputPanel === 'materials' ? null : 'materials'"
          >
            Materials
          </button>
          <span class="output-summary muted">{{ outputPanel ? 'Click the active tab to close' : 'Plan output' }}</span>
        </header>
        <div v-if="outputPanel" class="output-content">
          <IssueList v-if="outputPanel === 'issues'" />
          <BomPanel v-else />
        </div>
      </section>
    </main>

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
  min-width: 0;
}

.skip-link {
  position: fixed;
  top: 8px;
  left: 8px;
  z-index: 100;
  padding: 8px 12px;
  color: var(--on-accent);
  background: var(--accent);
  border-radius: var(--radius);
  transform: translateY(-150%);
}

.skip-link:focus {
  transform: translateY(0);
}

.mobile-inspector-trigger {
  display: none;
}

.workspace {
  flex: 1;
  min-height: 470px;
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(170px, 215px) minmax(320px, 1fr) minmax(250px, 300px);
  grid-template-rows: minmax(280px, 1fr) auto;
  grid-template-areas:
    "levels canvas inspector"
    "bottom bottom bottom";
  overflow: hidden;
}

.workspace.output-open {
  grid-template-rows: minmax(280px, 1fr) minmax(190px, 30vh);
}

.levels-region {
  grid-area: levels;
}

.canvas-region {
  grid-area: canvas;
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  background: var(--bg);
}

.inspector-region {
  grid-area: inspector;
}

.bottom-region {
  grid-area: bottom;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--panel);
  border-top: 1px solid var(--border);
  overflow: hidden;
}

.output-tabs {
  flex: none;
  min-height: 45px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
}

.output-tabs button {
  display: inline-flex;
  align-items: center;
  gap: 7px;
}

.output-tabs .count {
  min-width: 22px;
  padding: 2px 6px;
  border-radius: 999px;
  background: var(--panel);
  font-size: 11px;
  text-align: center;
}

.output-tabs button[aria-pressed='true'] .count {
  background: rgb(255 255 255 / 0.18);
}

.output-summary {
  margin-left: auto;
  font-size: 11px;
}

.output-content {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  border-top: 1px solid var(--border);
}

.output-content > * {
  height: 100%;
}

.canvas-context {
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 7px 14px;
  padding: 9px 12px;
  border-bottom: 1px solid var(--border);
}

.bay-chooser {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--muted);
  font-size: 11px;
}

.bay-chooser select {
  width: auto;
  min-width: 86px;
  padding-block: 4px;
}

.level-context {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.canvas-stage {
  min-width: 0;
  min-height: 0;
  display: grid;
  place-items: center;
  padding: 14px;
}

.canvas-hint {
  margin: 0;
  padding: 7px 12px;
  border-top: 1px solid var(--border);
  font-size: 11px;
  text-align: right;
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

.legend {
  display: flex;
  flex-wrap: wrap;
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

@media (max-width: 900px) {
  .app {
    height: auto;
    min-height: 100%;
  }

  .workspace {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto minmax(420px, 65vh) auto auto;
    grid-template-areas:
      "levels"
      "canvas"
      "inspector"
      "bottom";
    overflow: visible;
  }

  .workspace.output-open {
    grid-template-rows: auto minmax(420px, 65vh) auto auto;
  }

  .bottom-region {
    overflow: visible;
  }

  .output-content {
    max-height: 65vh;
    overflow: auto;
  }

  .inspector-region {
    grid-area: auto;
  }

  .mobile-inspector-trigger {
    display: inline-flex;
    min-height: 40px;
    margin-left: auto;
  }

}

@media (max-width: 560px) {
  .canvas-context {
    align-items: flex-start;
    padding: 8px;
  }

  .level-context,
  .legend {
    width: 100%;
  }

  .bay-chooser {
    width: 100%;
    justify-content: space-between;
  }

  .canvas-stage {
    padding: 8px;
  }

  .canvas-hint {
    text-align: left;
  }
}
</style>
