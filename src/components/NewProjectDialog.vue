<script setup lang="ts">
/**
 * The one modal in the app. §10 keeps modals out of the paint tools, and this
 * is not one: the footprint is chosen once, before there is anything to paint.
 *
 * Editing the footprint of a project that already exists is the canvas's job,
 * not this dialog's.
 */
import { nextTick, ref, watch } from 'vue'

import { MAX_BAY_FIELD } from '../domain/types.js'

const props = defineProps<{
  open: boolean
  bayCols: number
  bayRows: number
}>()

const emit = defineEmits<{
  create: [value: { bayCols: number; bayRows: number }]
  cancel: []
}>()

const dialog = ref<HTMLDialogElement | null>(null)
const colsInput = ref<HTMLInputElement | null>(null)

const cols = ref(props.bayCols)
const rows = ref(props.bayRows)

watch(
  () => props.open,
  async (open) => {
    if (!open) {
      dialog.value?.close()
      return
    }
    // Seeded from the current project: replacing a 6x2 almost always means
    // wanting another 6x2.
    cols.value = props.bayCols
    rows.value = props.bayRows
    dialog.value?.showModal()
    await nextTick()
    colsInput.value?.select()
  },
)

/** §15 open question 2 caps the field, so the dialog cannot offer more. */
function clamp(value: number): number {
  if (!Number.isFinite(value)) return 1
  return Math.min(MAX_BAY_FIELD, Math.max(1, Math.round(value)))
}

/**
 * Corrects the field itself on commit rather than leaving `max` to reject the
 * submit: an out-of-range number otherwise sits there contradicting the summary
 * line below it, and the only feedback is a tooltip on a button that did nothing.
 */
function commit(field: 'cols' | 'rows'): void {
  if (field === 'cols') cols.value = clamp(cols.value)
  else rows.value = clamp(rows.value)
}

function onSubmit(): void {
  emit('create', { bayCols: clamp(cols.value), bayRows: clamp(rows.value) })
}

/**
 * Fires for Escape and for our own `close()`. The parent owns `open`, so an
 * already-closed dialog has nothing left to cancel.
 */
function onClose(): void {
  if (props.open) emit('cancel')
}
</script>

<template>
  <dialog ref="dialog" class="sheet" aria-labelledby="new-project-title" @close="onClose">
    <form @submit.prevent="onSubmit">
      <h2 id="new-project-title">New project</h2>
      <p class="muted">This discards the current project. Export first if you want to keep it.</p>

      <div class="fields">
        <label>
          Bays across
          <input
            ref="colsInput"
            v-model.number="cols"
            type="number"
            min="1"
            :max="MAX_BAY_FIELD"
            required
            @change="commit('cols')"
          />
        </label>
        <span class="times" aria-hidden="true">×</span>
        <label>
          Bays deep
          <input
            v-model.number="rows"
            type="number"
            min="1"
            :max="MAX_BAY_FIELD"
            required
            @change="commit('rows')"
          />
        </label>
      </div>

      <p class="muted note">
        {{ clamp(cols) }}×{{ clamp(rows) }} — {{ clamp(cols) * clamp(rows) }} bays. Up to
        {{ MAX_BAY_FIELD }} per side.
      </p>

      <div class="actions">
        <button type="button" @click="emit('cancel')">Cancel</button>
        <button type="submit" class="primary">Create</button>
      </div>
    </form>
  </dialog>
</template>

<style scoped>
.sheet {
  min-width: 320px;
  padding: 16px;
  color: var(--text);
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}

.sheet::backdrop {
  background: rgb(0 0 0 / 0.4);
}

h2 {
  margin: 0 0 4px;
  font-size: 15px;
}

p {
  margin: 0 0 12px;
}

.fields {
  display: flex;
  align-items: flex-end;
  gap: 8px;
}

label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  color: var(--muted);
}

input {
  width: 72px;
  padding: 4px 6px;
  font: inherit;
  color: var(--text);
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}

input:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -1px;
}

.times {
  padding-bottom: 6px;
  color: var(--muted);
}

.note {
  margin: 10px 0 0;
  font-variant-numeric: tabular-nums;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}

.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}
</style>
