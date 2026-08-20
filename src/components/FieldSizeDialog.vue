<script setup lang="ts">
/**
 * The one modal in the app, for the one thing that is not painting: how wide
 * and deep the bay field is. §10 keeps modals out of the paint tools, and the
 * field extent is not one — it is the bounding box the plan is drawn inside.
 *
 * Which bays inside that box actually exist is the canvas's job, in footprint
 * tool, not this dialog's.
 */
import { computed, nextTick, ref, watch } from 'vue'

import { parseBayKey } from '../domain/geometry.js'
import { MAX_BAY_FIELD } from '../domain/types.js'
import { useProjectStore } from '../stores/project.js'

const props = defineProps<{
  open: boolean
  intent: 'new' | 'resize'
  bayCols: number
  bayRows: number
}>()

const emit = defineEmits<{
  submit: [value: { bayCols: number; bayRows: number }]
  cancel: []
}>()

const store = useProjectStore()

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
    // Seeded from the current project: replacing or resizing a 6x2 both start
    // from 6x2.
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
  emit('submit', { bayCols: clamp(cols.value), bayRows: clamp(rows.value) })
}

/**
 * Resizing is destructive at the edges and nowhere else, so the warning counts
 * the bays that would actually go rather than saying the size "may lose work".
 */
const dropped = computed(() => {
  if (props.intent !== 'resize') return 0
  const width = clamp(cols.value)
  const depth = clamp(rows.value)
  let count = 0
  for (const level of store.project.levels) {
    for (const bayKey of Object.keys(level.bays)) {
      const { i, j } = parseBayKey(bayKey)
      if (i >= width || j >= depth) count++
    }
  }
  return count
})

const levelCount = computed(() => store.project.levels.length)

/**
 * Fires for Escape and for our own `close()`. The parent owns `open`, so an
 * already-closed dialog has nothing left to cancel.
 */
function onClose(): void {
  if (props.open) emit('cancel')
}
</script>

<template>
  <dialog ref="dialog" class="sheet" aria-labelledby="field-size-title" @close="onClose">
    <form @submit.prevent="onSubmit">
      <h2 id="field-size-title">{{ intent === 'new' ? 'New project' : 'Resize the field' }}</h2>
      <p v-if="intent === 'new'" class="muted">
        This discards the current project. Export first if you want to keep it.
      </p>
      <p v-else class="muted">
        The field is the box the plan sits in. Use the Footprint tool to say which bays inside it exist.
      </p>

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
        <!-- A new project fills its field; an existing one may have bays carved out of it. -->
        {{ clamp(cols) }}×{{ clamp(rows) }} —
        {{ intent === 'new' ? '' : 'up to ' }}{{ clamp(cols) * clamp(rows) }} bays{{
          intent === 'resize' && levelCount > 1 ? ` per level, across ${levelCount} levels` : ''
        }}. Max {{ MAX_BAY_FIELD }} per side.
      </p>

      <p v-if="dropped > 0" class="warning note" role="status">
        Drops {{ dropped }} bay{{ dropped === 1 ? '' : 's' }} that would fall outside. Undo brings
        {{ dropped === 1 ? 'it' : 'them' }} back.
      </p>

      <div class="actions">
        <button type="button" @click="emit('cancel')">Cancel</button>
        <button type="submit" class="primary">{{ intent === 'new' ? 'Create' : 'Resize' }}</button>
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

.warning {
  color: var(--danger);
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
