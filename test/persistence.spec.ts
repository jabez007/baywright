/**
 * PRD §12 — IndexedDB persistence, and the §13 v0 acceptance criterion.
 *
 * `fake-indexeddb/auto` installs an in-memory IndexedDB onto globalThis, so the
 * "reload the page and see the same design" acceptance is a real test rather
 * than something a human has to check by hand.
 */
import 'fake-indexeddb/auto'

import { IDBFactory } from 'fake-indexeddb'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  closeDatabase,
  deleteProject,
  listProjects,
  loadLastOpenedProject,
  loadProject,
  saveProject,
  setLastOpened,
} from '../src/persistence/db.js'
import { createProject, useProjectStore } from '../src/stores/project.js'
import { bay, level, project } from './factory.js'

beforeEach(async () => {
  await closeDatabase()
  // A fresh factory is the cleanest reset: no stores, no version history.
  globalThis.indexedDB = new IDBFactory()
  setActivePinia(createPinia())
})

describe('saving and loading', () => {
  it('reads back exactly what was written', async () => {
    const document = project([level('ground', 0, { A1: bay('fine'), B1: bay('coarse') })])
    await saveProject(document)
    expect(await loadProject(document.id)).toEqual(document)
  })

  it('returns undefined for an unknown id', async () => {
    expect(await loadProject('nope')).toBeUndefined()
  })

  it('upserts rather than duplicating', async () => {
    const document = createProject({ name: 'First' })
    await saveProject(document)
    await saveProject({ ...document, name: 'Second' })
    expect(await listProjects()).toEqual([expect.objectContaining({ id: document.id, name: 'Second' })])
  })

  it('rejects a stored document that no longer validates', async () => {
    const document = project([level('ground', 0, { A1: bay('fine') })])
    await saveProject(document)
    // Simulate a document written by a build with a different schema.
    const broken = structuredClone(document) as unknown as { schemaVersion: number }
    broken.schemaVersion = 99
    await saveProject(broken as never)
    await expect(loadProject(document.id)).rejects.toThrow(/schemaVersion/)
  })
})

describe('the last-opened pointer', () => {
  it('reopens the most recently saved project', async () => {
    const first = createProject({ name: 'First' })
    const second = createProject({ name: 'Second' })
    await saveProject(first, 1000)
    await saveProject(second, 2000)
    expect((await loadLastOpenedProject())?.name).toBe('Second')
  })

  it('follows the pointer rather than the clock', async () => {
    const first = createProject({ name: 'First' })
    const second = createProject({ name: 'Second' })
    await saveProject(first, 1000)
    await saveProject(second, 2000)
    await setLastOpened(first.id)
    expect((await loadLastOpenedProject())?.name).toBe('First')
  })

  it('falls back to the newest document when the pointer dangles', async () => {
    const first = createProject({ name: 'First' })
    const second = createProject({ name: 'Second' })
    await saveProject(first, 1000)
    await saveProject(second, 2000)
    await setLastOpened('deleted-project')
    expect((await loadLastOpenedProject())?.name).toBe('Second')
  })

  it('is undefined on a first run', async () => {
    expect(await loadLastOpenedProject()).toBeUndefined()
  })

  it('clears when the pointed-at project is deleted', async () => {
    const first = createProject({ name: 'First' })
    const second = createProject({ name: 'Second' })
    await saveProject(first, 1000)
    await saveProject(second, 2000)
    await deleteProject(second.id)
    expect((await loadLastOpenedProject())?.name).toBe('First')
  })
})

describe('listing', () => {
  it('returns summaries newest first', async () => {
    await saveProject(createProject({ name: 'Old' }), 1000)
    await saveProject(createProject({ name: 'New' }), 3000)
    await saveProject(createProject({ name: 'Middle' }), 2000)
    expect((await listProjects()).map((entry) => entry.name)).toEqual(['New', 'Middle', 'Old'])
  })
})

/**
 * §13 v0 — "create a 3x3 bay level, set B2 to coarse grain, paint a spine into
 * it, reload the page, and see the same design."
 */
describe('v0 acceptance', () => {
  it('survives a reload', async () => {
    const before = useProjectStore()
    const levelId = before.currentLevelId

    expect(before.project.bayCols).toBe(3)
    expect(before.project.bayRows).toBe(3)

    before.setBayGrain(levelId, 'B2', 'coarse')
    const refs = [0, 1, 2, 3].map((cellIndex) => ({ levelId, bayKey: 'B2', cellIndex }))
    before.paintCells(refs, 'spine')

    await saveProject(before.toJSON())

    // The reload: a brand new Pinia, a brand new store, nothing carried over.
    setActivePinia(createPinia())
    const after = useProjectStore()
    const stored = await loadLastOpenedProject()
    expect(stored).toBeDefined()
    after.loadProject(stored!)

    const bay22 = after.project.levels[0]?.bays['B2']
    expect(bay22?.grain).toBe('coarse')
    expect(bay22?.cells).toHaveLength(4)
    expect(bay22?.cells.map((cell) => cell.module)).toEqual(['spine', 'spine', 'spine', 'spine'])
    expect(after.toJSON()).toEqual(before.toJSON())
  })

  it('starts history clean after a reload, so undo cannot rewind past it', async () => {
    const before = useProjectStore()
    before.paintCell({ levelId: before.currentLevelId, bayKey: 'A1', cellIndex: 0 }, 'storage')
    await saveProject(before.toJSON())

    setActivePinia(createPinia())
    const after = useProjectStore()
    after.loadProject((await loadLastOpenedProject())!)
    expect(after.canUndo).toBe(false)
  })
})
