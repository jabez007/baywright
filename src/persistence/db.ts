/**
 * PRD §12 — IndexedDB persistence via `idb`.
 *
 * Documents are keyed by project id with a separate `lastOpenedId` pointer,
 * rather than a single fixed record. v0 only ever has one project, but the
 * pointer costs a few lines now and saves a schema migration when the project
 * picker lands.
 *
 * Everything read back out goes through `validateProject`: a document written
 * by an older build is exactly as untrusted as a file off disk.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb'

import { validateProject } from '../export/json.js'
import type { Project } from '../domain/types.js'

export const DB_NAME = 'baywright'
export const DB_VERSION = 1

const PROJECTS = 'projects'
const META = 'meta'
const LAST_OPENED = 'lastOpenedId'

/** The stored envelope. `name` and `updatedAt` are denormalised for the list. */
export interface ProjectRecord {
  id: string
  name: string
  updatedAt: number
  document: Project
}

/** What the (future) project picker needs, without deserialising every document. */
export interface ProjectSummary {
  id: string
  name: string
  updatedAt: number
}

interface BaywrightSchema extends DBSchema {
  [PROJECTS]: {
    key: string
    value: ProjectRecord
    indexes: { 'by-updated': number }
  }
  [META]: {
    key: string
    value: string
  }
}

export type BaywrightDB = IDBPDatabase<BaywrightSchema>

let connection: Promise<BaywrightDB> | undefined

/**
 * Opens (and memoises) the connection. Safe to call on every operation.
 *
 * A failure drops the memo before rethrowing: keeping the rejected promise
 * would turn one transient error — an upgrade blocked by another tab, a storage
 * failure — into permanent, unrecoverable data loss for the rest of the page
 * load, with every later save failing against the same dead promise.
 */
export function openDatabase(): Promise<BaywrightDB> {
  connection ??= openDB<BaywrightSchema>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(PROJECTS)) {
        const store = db.createObjectStore(PROJECTS, { keyPath: 'id' })
        store.createIndex('by-updated', 'updatedAt')
      }
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META)
    },
  }).catch((cause: unknown) => {
    connection = undefined
    throw cause
  })
  return connection
}

/** Drops the memoised connection. Tests use this between cases. */
export async function closeDatabase(): Promise<void> {
  const db = await connection
  db?.close()
  connection = undefined
}

/**
 * Upsert a project and mark it as last opened.
 *
 * Pass a detached document — `useProjectStore().toJSON()`, not the reactive
 * `project` ref. IndexedDB cannot structured-clone a Vue proxy.
 */
export async function saveProject(project: Project, now: number = Date.now()): Promise<ProjectRecord> {
  const record: ProjectRecord = {
    id: project.id,
    name: project.name,
    updatedAt: now,
    document: project,
  }
  const db = await openDatabase()
  const tx = db.transaction([PROJECTS, META], 'readwrite')
  await Promise.all([
    tx.objectStore(PROJECTS).put(record),
    tx.objectStore(META).put(project.id, LAST_OPENED),
    tx.done,
  ])
  return record
}

/** Read one project back, or undefined if it is not stored. */
export async function loadProject(id: string): Promise<Project | undefined> {
  const db = await openDatabase()
  const record = await db.get(PROJECTS, id)
  return record && validateProject(record.document)
}

/**
 * The project to open on boot: the `lastOpenedId` pointer, falling back to the
 * most recently saved document if the pointer is missing or dangling.
 */
export async function loadLastOpenedProject(): Promise<Project | undefined> {
  const db = await openDatabase()
  const id = await db.get(META, LAST_OPENED)
  if (id !== undefined) {
    const record = await db.get(PROJECTS, id)
    if (record) {
      try {
        return validateProject(record.document)
      } catch {
        // Fall through: one bad record must not prevent recovery of another.
      }
    }
  }
  const records = await db.getAllFromIndex(PROJECTS, 'by-updated')
  for (const record of records.reverse()) {
    try {
      const document = validateProject(record.document)
      try {
        await db.put(META, record.id, LAST_OPENED)
      } catch {
        // The valid document is still usable if pointer repair cannot be saved.
      }
      return document
    } catch {
      // Keep walking toward older records until one validates.
    }
  }
  return undefined
}

/** Summaries, newest first. */
export async function listProjects(): Promise<ProjectSummary[]> {
  const db = await openDatabase()
  const records = await db.getAllFromIndex(PROJECTS, 'by-updated')
  return records.reverse().map(({ id, name, updatedAt }) => ({ id, name, updatedAt }))
}

/** Remove a project, clearing the pointer if it referenced this one. */
export async function deleteProject(id: string): Promise<void> {
  const db = await openDatabase()
  const tx = db.transaction([PROJECTS, META], 'readwrite')
  const meta = tx.objectStore(META)
  const pointer = await meta.get(LAST_OPENED)
  await Promise.all([
    tx.objectStore(PROJECTS).delete(id),
    pointer === id ? meta.delete(LAST_OPENED) : undefined,
    tx.done,
  ])
}

/** Point the boot path at a project without rewriting its document. */
export async function setLastOpened(id: string): Promise<void> {
  const db = await openDatabase()
  await db.put(META, id, LAST_OPENED)
}
