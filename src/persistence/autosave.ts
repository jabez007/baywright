/**
 * PRD §12 — autosave, debounced at 1s.
 *
 * Watches the document deeply and writes it to IndexedDB once the edits stop.
 * Deliberately not part of the store: the store owns the document and its undo
 * history, and stays free of I/O so it remains synchronously testable.
 */
import { onScopeDispose, ref, watch, type Ref } from 'vue'

import { saveProject } from './db.js'
import type { useProjectStore } from '../stores/project.js'

export const AUTOSAVE_DELAY_MS = 1000

export type SaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error'

export interface Autosave {
  status: Ref<SaveStatus>
  /** Populated when `status` is `error`, so the UI can say what went wrong. */
  error: Ref<Error | undefined>
  savedAt: Ref<number | undefined>
  /** Write immediately, cancelling any pending debounce. */
  flush: () => Promise<void>
  stop: () => void
}

export function useAutosave(
  store: ReturnType<typeof useProjectStore>,
  delayMs: number = AUTOSAVE_DELAY_MS,
): Autosave {
  const status = ref<SaveStatus>('idle')
  const error = ref<Error | undefined>()
  const savedAt = ref<number | undefined>()

  let timer: ReturnType<typeof setTimeout> | undefined
  let revision = 0
  // Serialises writes: a save that starts while another is in flight would
  // otherwise race, and the older document could land last.
  let inFlight: Promise<void> = Promise.resolve()

  function write(document: ReturnType<typeof store.toJSON>, writeRevision: number): Promise<void> {
    const queued = inFlight.then(async () => {
      if (writeRevision === revision) status.value = 'saving'
      try {
        const record = await saveProject(document)
        if (writeRevision === revision) {
          savedAt.value = record.updatedAt
          error.value = undefined
          status.value = 'saved'
        }
      } catch (cause) {
        const failure = cause instanceof Error ? cause : new Error(String(cause))
        if (writeRevision === revision) {
          error.value = failure
          status.value = 'error'
        }
        throw failure
      }
    })
    // Keep the serial queue usable after failure. Callers still receive the
    // rejecting promise for this particular write.
    inFlight = queued.catch(() => undefined)
    return queued
  }

  function schedule(): void {
    if (timer !== undefined) clearTimeout(timer)
    revision++
    status.value = 'pending'
    timer = setTimeout(() => {
      timer = undefined
      void write(store.toJSON(), revision).catch(() => undefined)
    }, delayMs)
  }

  async function flush(): Promise<void> {
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
    // Capture before entering the queue so later edits cannot change this write.
    await write(store.toJSON(), revision)
  }

  // Not `immediate`: loading a project should not rewrite what was just read.
  const unwatch = watch(() => store.project, schedule, { deep: true, flush: 'sync' })

  /**
   * Lifecycle signals start a pending write without waiting for the debounce.
   * Browsers may still terminate the page before IndexedDB commits it, so these
   * handlers reduce the loss window rather than guarantee final-write durability.
   */
  const flushPending = (): void => {
    if (timer !== undefined) void flush().catch(() => undefined)
  }
  const onVisibilityChange = (): void => {
    if (document.visibilityState === 'hidden') flushPending()
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', flushPending)
    window.addEventListener('pagehide', flushPending)
    document.addEventListener('visibilitychange', onVisibilityChange)
  }

  function stop(): void {
    unwatch()
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    if (typeof window !== 'undefined') {
      window.removeEventListener('beforeunload', flushPending)
      window.removeEventListener('pagehide', flushPending)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }

  onScopeDispose(stop, true)

  return { status, error, savedAt, flush, stop }
}
