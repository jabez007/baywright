/**
 * PRD §12 — the one project store, and §10's undo ring buffer.
 *
 * Every document mutation goes through a named action, and every named action
 * goes through `mutate`. That is the single interception point the undo buffer
 * needs: snapshot the serialised project, run the change, keep 50 of them.
 * No command pattern — the document is a few KB and `structuredClone` is fast.
 *
 * Selection and the current level are UI state, not document state, so they
 * are deliberately outside the history.
 */
import { defineStore } from 'pinia'
import { computed, ref, toRaw } from 'vue'

import { bayKeyOf, resolveCell, sortedLevels } from '../domain/geometry.js'
import { DEFAULT_MODULE_ID, cellFromModule, getModule, type CellOverrides } from '../domain/modules.js'
import { PALETTES } from '../domain/palettes.js'
import { validate, type Issue } from '../domain/validate.js'
import {
  LEVEL_PITCH,
  MAX_BAY_FIELD,
  cellCount,
  type Bay,
  type Ceiling,
  type Cell,
  type CellRef,
  type Face,
  type Grain,
  type Level,
  type Project,
  type Socket,
} from '../domain/types.js'

/** §10 — snapshots kept in the ring buffer. */
export const HISTORY_LIMIT = 50

/** Alt-click cycles a face through these (§10). */
export const HORIZONTAL_SOCKET_CYCLE: readonly Socket[] = ['solid', 'corridor', 'arch', 'window', 'bars']

/** §5.4 — `shaft` is the only opening a floor or ceiling can carry. */
export const VERTICAL_SOCKET_CYCLE: readonly Socket[] = ['solid', 'shaft']

export const DEFAULT_PALETTE_ID = 'stone-brick'

// --------------------------------------------------------------------------
// Selection
// --------------------------------------------------------------------------

export type Selection =
  | { kind: 'none' }
  | { kind: 'level'; levelId: string }
  | { kind: 'bay'; levelId: string; bayKey: string }
  | { kind: 'cells'; refs: CellRef[] }

/** The gap between two rail entries — where collisions hide (§10). */
export interface LevelGap {
  aboveId: string
  belowId: string
  /** Blocks between the two floor planes. */
  delta: number
  /** What is left after the lower level's tallest cell. Negative means a collision. */
  headroom: number
}

// --------------------------------------------------------------------------
// Document construction
// --------------------------------------------------------------------------

export interface NewProjectOptions {
  name?: string
  bayCols?: number
  bayRows?: number
  origin?: { x: number; z: number }
  grain?: Grain
}

/**
 * `crypto.randomUUID` is secure-context only, so it is missing whenever the dev
 * host is reached over plain http on a LAN address. `getRandomValues` has no
 * such restriction, so fall back to hand-rolling the v4 layout.
 */
function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()

  const bytes = new Uint8Array(16)
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40 // version 4
  bytes[8] = (bytes[8]! & 0x3f) | 0x80 // variant 10

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'))
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`
}

export function createBay(grain: Grain, moduleId: string = DEFAULT_MODULE_ID): Bay {
  return { grain, cells: Array.from({ length: cellCount(grain) }, () => cellFromModule(moduleId)) }
}

export function createLevel(options: { y: number; name: string; bayCols: number; bayRows: number; grain?: Grain }): Level {
  const bays: Record<string, Bay> = {}
  for (let j = 0; j < options.bayRows; j++) {
    for (let i = 0; i < options.bayCols; i++) bays[bayKeyOf(i, j)] = createBay(options.grain ?? 'fine')
  }
  return { id: newId(), y: options.y, name: options.name, paletteId: DEFAULT_PALETTE_ID, bays }
}

/** §15 open question 2 — the bay field is capped until V1 stops being O(n²). */
function assertFieldExtent(extent: number, label: string): number {
  if (!Number.isInteger(extent) || extent < 1 || extent > MAX_BAY_FIELD) {
    throw new RangeError(`${label} must be an integer between 1 and ${MAX_BAY_FIELD}, got ${extent}`)
  }
  return extent
}

export function createProject(options: NewProjectOptions = {}): Project {
  const bayCols = assertFieldExtent(options.bayCols ?? 3, 'bayCols')
  const bayRows = assertFieldExtent(options.bayRows ?? 3, 'bayRows')
  return {
    schemaVersion: 1,
    id: newId(),
    name: options.name ?? 'Untitled base',
    origin: options.origin ?? { x: 0, z: 0 },
    bayCols,
    bayRows,
    levels: [createLevel({ y: 0, name: 'Ground', bayCols, bayRows, grain: options.grain })],
    palettes: { ...PALETTES },
  }
}

// --------------------------------------------------------------------------
// The store
// --------------------------------------------------------------------------

export const useProjectStore = defineStore('project', () => {
  const project = ref<Project>(createProject())
  const currentLevelId = ref<string>(project.value.levels[0]?.id ?? '')
  const selection = ref<Selection>({ kind: 'none' })

  // Plain arrays: 50 deep clones have no business being reactive. The depths
  // are mirrored into refs so `canUndo` / `canRedo` stay reactive.
  const undoStack: Project[] = []
  const redoStack: Project[] = []
  const undoDepth = ref(0)
  const redoDepth = ref(0)
  let depth = 0

  // -- history ------------------------------------------------------------

  /**
   * Vue's reactive setter unwraps the value it is handed, but not the elements
   * inside an array assigned wholesale — assign `levels.filter(...)` and the
   * raw tree ends up holding proxies, which `structuredClone` refuses. Actions
   * here mutate collections in place to avoid that, and the JSON fallback keeps
   * undo working rather than throwing if one ever slips through. The document
   * is plain JSON by design (§6), so the round-trip is lossless.
   */
  function snapshot(): Project {
    const raw = toRaw(project.value)
    try {
      return structuredClone(raw)
    } catch {
      return JSON.parse(JSON.stringify(raw)) as Project
    }
  }

  function syncDepths(): void {
    undoDepth.value = undoStack.length
    redoDepth.value = redoStack.length
  }

  function pushCapped(stack: Project[], entry: Project): void {
    stack.push(entry)
    if (stack.length > HISTORY_LIMIT) stack.shift()
  }

  /**
   * The single interception point. Nested calls do not snapshot again, so an
   * action built out of other actions — or a whole click-drag wrapped in
   * `batch` — costs exactly one undo step.
   *
   * A throwing action rolls the document back, so a rejected assert cannot
   * leave the project half-changed or push a useless history entry.
   */
  function mutate<T>(change: () => T): T {
    if (depth > 0) return change()
    const before = snapshot()
    depth++
    try {
      const result = change()
      pushCapped(undoStack, before)
      redoStack.length = 0
      return result
    } catch (error) {
      project.value = before
      throw error
    } finally {
      depth--
      syncDepths()
    }
  }

  /** Wrap a click-drag so the whole gesture is one undo step. */
  function batch<T>(change: () => T): T {
    return mutate(change)
  }

  function undo(): boolean {
    const previous = undoStack.pop()
    if (!previous) return false
    pushCapped(redoStack, snapshot())
    project.value = previous
    reconcile()
    syncDepths()
    return true
  }

  function redo(): boolean {
    const next = redoStack.pop()
    if (!next) return false
    pushCapped(undoStack, snapshot())
    project.value = next
    reconcile()
    syncDepths()
    return true
  }

  function clearHistory(): void {
    undoStack.length = 0
    redoStack.length = 0
    syncDepths()
  }

  /** After a history jump the current level or selection may no longer exist. */
  function reconcile(): void {
    if (!project.value.levels.some((level) => level.id === currentLevelId.value)) {
      currentLevelId.value = project.value.levels[0]?.id ?? ''
    }
    if (!selectionExists(selection.value)) selection.value = { kind: 'none' }
  }

  function selectionExists(current: Selection): boolean {
    switch (current.kind) {
      case 'none':
        return true
      case 'level':
        return project.value.levels.some((level) => level.id === current.levelId)
      case 'bay':
        return findLevel(current.levelId)?.bays[current.bayKey] !== undefined
      case 'cells':
        return current.refs.every((ref) => {
          try {
            resolveCell(project.value, ref)
            return true
          } catch {
            return false
          }
        })
    }
  }

  // -- lookups ------------------------------------------------------------

  function findLevel(levelId: string): Level | undefined {
    return project.value.levels.find((level) => level.id === levelId)
  }

  function requireLevel(levelId: string): Level {
    const level = findLevel(levelId)
    if (!level) throw new Error(`no level '${levelId}'`)
    return level
  }

  function requireBay(levelId: string, bayKey: string): Bay {
    const bay = requireLevel(levelId).bays[bayKey]
    if (!bay) throw new Error(`no bay '${bayKey}' on level '${levelId}'`)
    return bay
  }

  function requireCell(ref: CellRef): Cell {
    return resolveCell(project.value, ref).cell
  }

  // -- document invariants (§12) -----------------------------------------

  function assertY(y: number, ignoreLevelId?: string): void {
    if (!Number.isInteger(y) || y % LEVEL_PITCH !== 0) {
      throw new Error(`level y must be an integer multiple of ${LEVEL_PITCH}, got ${y}`)
    }
    const clash = project.value.levels.find((level) => level.y === y && level.id !== ignoreLevelId)
    if (clash) throw new Error(`level '${clash.name}' already sits at y ${y}`)
  }

  /** §6 — levels are kept sorted ascending by y. */
  function sortLevels(): void {
    project.value.levels.sort((left, right) => left.y - right.y)
  }

  // -- document actions ---------------------------------------------------

  function loadProject(document: Project): void {
    if (document.schemaVersion !== 1) {
      throw new Error(`unsupported schemaVersion ${document.schemaVersion}`)
    }
    project.value = structuredClone(toRaw(document))
    sortLevels()
    currentLevelId.value = project.value.levels[0]?.id ?? ''
    selection.value = { kind: 'none' }
    clearHistory()
  }

  function newProject(options: NewProjectOptions = {}): void {
    loadProject(createProject(options))
  }

  function renameProject(name: string): void {
    mutate(() => {
      project.value.name = name
    })
  }

  function addLevel(y: number, name?: string): string {
    return mutate(() => {
      assertY(y)
      const level = createLevel({
        y,
        name: name ?? `Level ${y}`,
        bayCols: project.value.bayCols,
        bayRows: project.value.bayRows,
      })
      project.value.levels.push(level)
      sortLevels()
      return level.id
    })
  }

  function removeLevel(levelId: string): void {
    mutate(() => {
      requireLevel(levelId)
      // Spliced in place: assigning a filtered copy would write proxies into
      // the raw document. See `snapshot`.
      project.value.levels.splice(
        project.value.levels.findIndex((level) => level.id === levelId),
        1,
      )
      reconcile()
    })
  }

  function setLevelY(levelId: string, y: number): void {
    mutate(() => {
      assertY(y, levelId)
      requireLevel(levelId).y = y
      sortLevels()
    })
  }

  function renameLevel(levelId: string, name: string): void {
    mutate(() => {
      requireLevel(levelId).name = name
    })
  }

  function setLevelPalette(levelId: string, paletteId: string): void {
    mutate(() => {
      if (!project.value.palettes[paletteId]) throw new Error(`no palette '${paletteId}'`)
      requireLevel(levelId).paletteId = paletteId
    })
  }

  // -- bays ---------------------------------------------------------------

  /**
   * Changing grain re-cuts the bay, so the old cells cannot survive: 9 cells do
   * not map onto 4. A bay painted uniformly keeps its module, which is the case
   * where the intent is obvious.
   */
  function setBayGrain(levelId: string, bayKey: string, grain: Grain): void {
    mutate(() => {
      const bay = requireBay(levelId, bayKey)
      if (bay.grain === grain) return
      const keep = uniformModule(bay) ?? DEFAULT_MODULE_ID
      bay.grain = grain
      bay.cells = Array.from({ length: cellCount(grain) }, () => cellFromModule(keep))
    })
  }

  /** §10 bay mode — painting sets grain and module for the whole bay. */
  function paintBay(levelId: string, bayKey: string, moduleId: string, grain?: Grain): void {
    mutate(() => {
      const bay = requireBay(levelId, bayKey)
      const target = grain ?? getModule(moduleId)?.suggestedGrain ?? bay.grain
      bay.grain = target
      bay.cells = Array.from({ length: cellCount(target) }, () => cellFromModule(moduleId))
    })
  }

  function uniformModule(bay: Bay): string | null {
    const first = bay.cells[0]?.module
    if (first === undefined) return null
    return bay.cells.every((cell) => cell.module === first) ? first : null
  }

  // -- cells --------------------------------------------------------------

  /**
   * A module defines what a cell is — height, ceiling, sockets. The note,
   * palette override and merge group are annotations about that cell rather
   * than part of the module, so painting carries them across.
   */
  function carryOver(cell: Cell): CellOverrides {
    const carry: CellOverrides = {}
    if (cell.mergeGroup !== undefined) carry.mergeGroup = cell.mergeGroup
    if (cell.paletteOverride !== undefined) carry.paletteOverride = cell.paletteOverride
    if (cell.note !== undefined) carry.note = cell.note
    return carry
  }

  function paintCells(refs: CellRef[], moduleId: string): void {
    mutate(() => {
      for (const ref of refs) {
        const { bay } = resolveCell(project.value, ref)
        const existing = bay.cells[ref.cellIndex]!
        bay.cells[ref.cellIndex] = cellFromModule(moduleId, carryOver(existing))
      }
    })
  }

  function paintCell(ref: CellRef, moduleId: string): void {
    paintCells([ref], moduleId)
  }

  function setCellHeight(refs: CellRef[], heightCells: 1 | 2 | 3): void {
    mutate(() => {
      for (const ref of refs) requireCell(ref).heightCells = heightCells
    })
  }

  /** `[` and `]` (§10). */
  function nudgeCellHeight(refs: CellRef[], delta: number): void {
    mutate(() => {
      for (const ref of refs) {
        const cell = requireCell(ref)
        cell.heightCells = Math.min(3, Math.max(1, cell.heightCells + delta)) as 1 | 2 | 3
      }
    })
  }

  function setCeiling(refs: CellRef[], ceiling: Ceiling): void {
    mutate(() => {
      for (const ref of refs) requireCell(ref).ceiling = ceiling
    })
  }

  function setSocket(ref: CellRef, face: Face, socket: Socket): void {
    mutate(() => {
      requireCell(ref).sockets[face] = socket
    })
  }

  /** Alt-click a cell edge (§10). Unknown sockets fall back to the start of the cycle. */
  function cycleSocket(ref: CellRef, face: Face): Socket {
    return mutate(() => {
      const cell = requireCell(ref)
      const cycle = face === 'up' || face === 'down' ? VERTICAL_SOCKET_CYCLE : HORIZONTAL_SOCKET_CYCLE
      const next = cycle[(cycle.indexOf(cell.sockets[face]) + 1) % cycle.length]!
      cell.sockets[face] = next
      return next
    })
  }

  function setNote(ref: CellRef, note: string): void {
    mutate(() => {
      const cell = requireCell(ref)
      if (note) cell.note = note
      else delete cell.note
    })
  }

  function setPaletteOverride(ref: CellRef, paletteId: string | null): void {
    mutate(() => {
      const cell = requireCell(ref)
      if (paletteId === null) {
        delete cell.paletteOverride
        return
      }
      if (!project.value.palettes[paletteId]) throw new Error(`no palette '${paletteId}'`)
      cell.paletteOverride = paletteId
    })
  }

  /** Shift-drag across a rectangle (§10). Returns the new group id. */
  function mergeCells(refs: CellRef[]): string {
    return mutate(() => {
      if (refs.length === 0) throw new Error('a merge group needs at least one cell')
      const groupId = newId()
      for (const ref of refs) requireCell(ref).mergeGroup = groupId
      return groupId
    })
  }

  function splitCells(refs: CellRef[]): void {
    mutate(() => {
      for (const ref of refs) delete requireCell(ref).mergeGroup
    })
  }

  // -- selection and navigation (not undoable) ----------------------------

  function setCurrentLevel(levelId: string): void {
    requireLevel(levelId)
    currentLevelId.value = levelId
  }

  function select(next: Selection): void {
    selection.value = next
  }

  function selectCells(refs: CellRef[]): void {
    selection.value = refs.length > 0 ? { kind: 'cells', refs } : { kind: 'none' }
  }

  /** Escape (§10). */
  function clearSelection(): void {
    selection.value = { kind: 'none' }
  }

  /** The cells an action like `[` or a paint should apply to. */
  const selectedRefs = computed<CellRef[]>(() => (selection.value.kind === 'cells' ? selection.value.refs : []))

  // -- derived ------------------------------------------------------------

  const currentLevel = computed<Level | undefined>(
    () => findLevel(currentLevelId.value) ?? project.value.levels[0],
  )

  /** §10 — the rail runs highest first. */
  const levelsDescending = computed<Level[]>(() => [...sortedLevels(project.value)].reverse())

  /** The muted gap between rail entries. */
  const levelGaps = computed<LevelGap[]>(() => {
    const ascending = sortedLevels(project.value)
    const gaps: LevelGap[] = []
    for (let index = 0; index < ascending.length - 1; index++) {
      const below = ascending[index]!
      const above = ascending[index + 1]!
      const delta = above.y - below.y
      gaps.push({ aboveId: above.id, belowId: below.id, delta, headroom: delta - LEVEL_PITCH * tallestCell(below) })
    }
    return gaps.reverse()
  })

  const issues = computed<Issue[]>(() => validate(project.value))

  /** For the rail's danger marker and the issue list's grouping. */
  const issuesByLevel = computed<Record<string, Issue[]>>(() => {
    const byLevel: Record<string, Issue[]> = {}
    for (const level of project.value.levels) byLevel[level.id] = []
    for (const issue of issues.value) {
      const levelIds = new Set(issue.refs.map((ref) => ref.levelId))
      if (issue.levelId) levelIds.add(issue.levelId)
      for (const levelId of levelIds) byLevel[levelId]?.push(issue)
    }
    return byLevel
  })

  const canUndo = computed(() => undoDepth.value > 0)
  const canRedo = computed(() => redoDepth.value > 0)

  /** A plain, detached copy — for autosave and the JSON exporter. */
  function toJSON(): Project {
    return snapshot()
  }

  return {
    // state
    project,
    currentLevelId,
    selection,
    // derived
    currentLevel,
    levelsDescending,
    levelGaps,
    issues,
    issuesByLevel,
    selectedRefs,
    canUndo,
    canRedo,
    undoDepth,
    redoDepth,
    // history
    batch,
    undo,
    redo,
    clearHistory,
    // document
    loadProject,
    newProject,
    renameProject,
    toJSON,
    addLevel,
    removeLevel,
    setLevelY,
    renameLevel,
    setLevelPalette,
    setBayGrain,
    paintBay,
    paintCell,
    paintCells,
    setCellHeight,
    nudgeCellHeight,
    setCeiling,
    setSocket,
    cycleSocket,
    setNote,
    setPaletteOverride,
    mergeCells,
    splitCells,
    // selection
    setCurrentLevel,
    select,
    selectCells,
    clearSelection,
  }
})

function tallestCell(level: Level): number {
  let tallest = 1
  for (const bay of Object.values(level.bays)) {
    for (const cell of bay.cells) tallest = Math.max(tallest, cell.heightCells)
  }
  return tallest
}
