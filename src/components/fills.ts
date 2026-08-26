/**
 * PRD §10 — colour encodes module category, not module identity.
 *
 * `empty` is the one exception. It is categorised as a room in the domain
 * (§5.5), but a field of unpainted cells rendered in the room colour is
 * unreadable: you cannot tell what you have painted from what you have not.
 * So it draws as void, and every *painted* cell carries its category colour.
 */
import { DEFAULT_MODULE_ID, categoryOf } from '../domain/modules.js'

export function moduleFill(moduleId: string): string {
  return moduleId === DEFAULT_MODULE_ID ? 'var(--void)' : `var(--cat-${categoryOf(moduleId)})`
}
