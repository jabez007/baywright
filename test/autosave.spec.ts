/**
 * PRD §12 — the autosave debounce.
 *
 * Runs in the node environment like the rest of the suite, so `window` and
 * `document` are stubbed rather than provided by a DOM library: the point is
 * which listeners get attached and what they do, not how a real browser fires
 * them. The debounce itself uses a short real delay, because faking timers
 * around fake-indexeddb's own async machinery is more fragile than waiting.
 */
import 'fake-indexeddb/auto'

import { IDBFactory } from 'fake-indexeddb'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import { useAutosave } from '../src/persistence/autosave.js'
import { useProjectStore } from '../src/stores/project.js'

type Db = typeof import('../src/persistence/db.js')

/**
 * The unmocked module. A plain `import * as db` would resolve to the mock
 * below, so a spy wrapping `db.saveProject` would call itself forever.
 */
const realDb: Db = await vi.importActual<Db>('../src/persistence/db.js')

/** Lets one test make the write fail without disturbing the others. */
let saveImpl: Db['saveProject']

vi.mock('../src/persistence/db.js', async (importOriginal) => {
  const actual = await importOriginal<Db>()
  return { ...actual, saveProject: (...args: Parameters<Db['saveProject']>) => saveImpl(...args) }
})

const DELAY = 20
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** Long enough for the debounce to fire and the write behind it to settle. */
const settle = (): Promise<void> => wait(DELAY * 3)

interface Stub {
  fire: (target: 'window' | 'document', type: string) => void
  attached: (target: 'window' | 'document', type: string) => boolean
}

function stubBrowser(): Stub {
  const handlers = { window: new Map<string, EventListener>(), document: new Map<string, EventListener>() }
  const make = (which: 'window' | 'document') => ({
    addEventListener: (type: string, handler: EventListener) => handlers[which].set(type, handler),
    removeEventListener: (type: string) => handlers[which].delete(type),
  })
  Object.assign(globalThis, {
    window: make('window'),
    document: { ...make('document'), visibilityState: 'visible' },
  })
  return {
    fire: (target, type) => handlers[target].get(type)?.(new Event(type)),
    attached: (target, type) => handlers[target].has(type),
  }
}

let browser: Stub

beforeEach(async () => {
  await realDb.closeDatabase()
  globalThis.indexedDB = new IDBFactory()
  setActivePinia(createPinia())
  saveImpl = realDb.saveProject
  browser = stubBrowser()
})

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'window')
  Reflect.deleteProperty(globalThis, 'document')
})

describe('the autosave debounce', () => {
  it('holds the write until the edits stop', async () => {
    const store = useProjectStore()
    const autosave = useAutosave(store, DELAY)

    store.renameProject('Edited')
    await nextTick()
    expect(autosave.status.value).toBe('pending')
    expect(await realDb.loadProject(store.project.id)).toBeUndefined()

    await settle()
    expect(autosave.status.value).toBe('saved')
    expect((await realDb.loadProject(store.project.id))?.name).toBe('Edited')
    autosave.stop()
  })

  it('restarts the wait on every edit rather than writing mid-stroke', async () => {
    const store = useProjectStore()
    const autosave = useAutosave(store, DELAY)

    for (let i = 0; i < 4; i++) {
      store.renameProject(`Edit ${i}`)
      await nextTick()
      await wait(DELAY / 2)
    }
    expect(autosave.status.value).toBe('pending')

    await settle()
    expect((await realDb.loadProject(store.project.id))?.name).toBe('Edit 3')
    autosave.stop()
  })

  it('writes once for a burst of edits', async () => {
    const store = useProjectStore()
    const spy = vi.fn(realDb.saveProject)
    saveImpl = spy
    const autosave = useAutosave(store, DELAY)

    for (let i = 0; i < 5; i++) {
      store.renameProject(`Edit ${i}`)
      await nextTick()
    }
    await settle()
    expect(spy).toHaveBeenCalledTimes(1)
    autosave.stop()
  })

  it('flushes immediately and cancels the pending timer', async () => {
    const store = useProjectStore()
    const spy = vi.fn(realDb.saveProject)
    saveImpl = spy
    const autosave = useAutosave(store, DELAY)

    store.renameProject('Now')
    await nextTick()
    await autosave.flush()
    expect(autosave.status.value).toBe('saved')
    expect((await realDb.loadProject(store.project.id))?.name).toBe('Now')

    // The cancelled timer must not fire a second write behind the flush.
    await settle()
    expect(spy).toHaveBeenCalledTimes(1)
    autosave.stop()
  })

  it('surfaces a failed write and recovers on the next one', async () => {
    const store = useProjectStore()
    const autosave = useAutosave(store, DELAY)

    saveImpl = () => Promise.reject(new Error('quota exceeded'))
    store.renameProject('Doomed')
    await nextTick()
    await settle()
    expect(autosave.status.value).toBe('error')
    expect(autosave.error.value?.message).toBe('quota exceeded')

    saveImpl = realDb.saveProject
    store.renameProject('Fine')
    await nextTick()
    await settle()
    expect(autosave.status.value).toBe('saved')
    expect(autosave.error.value).toBeUndefined()
    autosave.stop()
  })

  it('rejects an explicit flush after surfacing the save error', async () => {
    const store = useProjectStore()
    const autosave = useAutosave(store, DELAY)
    saveImpl = () => Promise.reject(new Error('disk unavailable'))

    store.renameProject('Unsaved')
    await nextTick()

    await expect(autosave.flush()).rejects.toThrow('disk unavailable')
    expect(autosave.status.value).toBe('error')
    expect(autosave.error.value?.message).toBe('disk unavailable')
    autosave.stop()
  })

  it('keeps pending status when an older write finishes', async () => {
    const store = useProjectStore()
    let release: (() => void) | undefined
    saveImpl = async (document, now) => {
      await new Promise<void>((resolve) => (release = resolve))
      return realDb.saveProject(document, now)
    }
    const autosave = useAutosave(store, DELAY * 10)

    store.renameProject('First')
    await nextTick()
    const first = autosave.flush()
    await wait(5)

    store.renameProject('Second')
    await nextTick()
    expect(autosave.status.value).toBe('pending')

    release?.()
    await first
    expect(autosave.status.value).toBe('pending')
    autosave.stop()
  })

  it('rejects an older failed write without replacing newer pending state', async () => {
    const store = useProjectStore()
    let rejectFirst: ((cause: Error) => void) | undefined
    saveImpl = () => new Promise((_, reject) => (rejectFirst = reject))
    const autosave = useAutosave(store, DELAY * 10)

    store.renameProject('First')
    await nextTick()
    const first = autosave.flush()
    await wait(5)

    store.renameProject('Second')
    await nextTick()
    expect(autosave.status.value).toBe('pending')
    expect(autosave.error.value).toBeUndefined()

    rejectFirst?.(new Error('stale failure'))
    await expect(first).rejects.toThrow('stale failure')
    expect(autosave.status.value).toBe('pending')
    expect(autosave.error.value).toBeUndefined()
    autosave.stop()
  })

  it('serialises overlapping writes so the newest document lands last', async () => {
    const store = useProjectStore()
    const order: string[] = []
    let release: (() => void) | undefined

    saveImpl = async (document, now) => {
      order.push(`start ${document.name}`)
      // Hold the first write open so the second has to queue behind it.
      if (!release) await new Promise<void>((resolve) => (release = resolve))
      order.push(`end ${document.name}`)
      return realDb.saveProject(document, now)
    }

    const autosave = useAutosave(store, DELAY)
    store.renameProject('First')
    await nextTick()
    const first = autosave.flush()
    await wait(5)

    store.renameProject('Second')
    await nextTick()
    const second = autosave.flush()
    await wait(5)

    // This later edit must not leak into the already queued second snapshot.
    store.renameProject('Third')
    await nextTick()
    autosave.stop()

    expect(order).toEqual(['start First'])
    release?.()
    await Promise.all([first, second])

    expect(order).toEqual(['start First', 'end First', 'start Second', 'end Second'])
    expect((await realDb.loadProject(store.project.id))?.name).toBe('Second')
    autosave.stop()
  })

  it('writes the pending edit when the page is hidden', async () => {
    const store = useProjectStore()
    const autosave = useAutosave(store, DELAY)
    expect(browser.attached('document', 'visibilitychange')).toBe(true)

    store.renameProject('Backgrounded')
    await nextTick()

    Object.assign(globalThis.document, { visibilityState: 'hidden' })
    browser.fire('document', 'visibilitychange')
    await settle()

    expect((await realDb.loadProject(store.project.id))?.name).toBe('Backgrounded')
    autosave.stop()
  })

  it('ignores a visibilitychange back to visible', async () => {
    const store = useProjectStore()
    const spy = vi.fn(realDb.saveProject)
    saveImpl = spy
    const autosave = useAutosave(store, DELAY)

    store.renameProject('Still editing')
    await nextTick()
    browser.fire('document', 'visibilitychange')
    expect(spy).not.toHaveBeenCalled()
    autosave.stop()
  })

  it('writes the pending edit on unload', async () => {
    const store = useProjectStore()
    const autosave = useAutosave(store, DELAY)
    expect(browser.attached('window', 'beforeunload')).toBe(true)

    store.renameProject('Closing')
    await nextTick()
    browser.fire('window', 'beforeunload')
    await settle()

    expect((await realDb.loadProject(store.project.id))?.name).toBe('Closing')
    autosave.stop()
  })

  it('writes the pending edit on pagehide', async () => {
    const store = useProjectStore()
    const autosave = useAutosave(store, DELAY)
    expect(browser.attached('window', 'pagehide')).toBe(true)

    store.renameProject('Page hidden')
    await nextTick()
    browser.fire('window', 'pagehide')
    await settle()

    expect((await realDb.loadProject(store.project.id))?.name).toBe('Page hidden')
    autosave.stop()
  })

  it('stops watching and detaches lifecycle listeners', async () => {
    const store = useProjectStore()
    const spy = vi.fn(realDb.saveProject)
    saveImpl = spy
    const autosave = useAutosave(store, DELAY)

    store.renameProject('Abandoned')
    await nextTick()
    autosave.stop()

    expect(browser.attached('window', 'beforeunload')).toBe(false)
    expect(browser.attached('window', 'pagehide')).toBe(false)
    expect(browser.attached('document', 'visibilitychange')).toBe(false)

    await settle()
    expect(spy).not.toHaveBeenCalled()

    store.renameProject('Also abandoned')
    await nextTick()
    await settle()
    expect(spy).not.toHaveBeenCalled()
  })
})
