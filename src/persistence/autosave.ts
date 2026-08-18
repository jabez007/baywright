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
  // Serialises writes: a save that starts while another is in flight would
  // otherwise race, and the older document could land last.
  let inFlight: Promise<void> = Promise.resolve()

  function write(): Promise<void> {
    inFlight = inFlight.then(async () => {
      status.value = 'saving'
      try {
        // toJSON detaches from the Vue proxy — IndexedDB cannot clone one.
        const record = await saveProject(store.toJSON())
        savedAt.value = record.updatedAt
        error.value = undefined
        status.value = 'saved'
      } catch (cause) {
        error.value = cause instanceof Error ? cause : new Error(String(cause))
        status.value = 'error'
      }
    })
    return inFlight
  }

  function schedule(): void {
    if (timer !== undefined) clearTimeout(timer)
    status.value = 'pending'
    timer = setTimeout(() => {
      timer = undefined
      void write()
    }, delayMs)
  }

  async function flush(): Promise<void> {
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
    await write()
  }

  // Not `immediate`: loading a project should not rewrite what was just read.
  const unwatch = watch(() => store.project, schedule, { deep: true })

  const onUnload = (): void => {
    if (timer !== undefined) void flush()
  }
  if (typeof window !== 'undefined') window.addEventListener('beforeunload', onUnload)

  function stop(): void {
    unwatch()
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    if (typeof window !== 'undefined') window.removeEventListener('beforeunload', onUnload)
  }

  onScopeDispose(stop, true)

  return { status, error, savedAt, flush, stop }
}
