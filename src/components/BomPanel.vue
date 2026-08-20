<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'

import { computeBom, type Bom } from '../domain/bom.js'
import { useProjectStore } from '../stores/project.js'

const store = useProjectStore()
const furnaces = ref(1)
const bom = ref<Bom | null>(null)
const error = ref<string | null>(null)
const pending = ref(true)
let timer: ReturnType<typeof setTimeout> | undefined

function scheduleBom(): void {
  if (timer !== undefined) clearTimeout(timer)
  pending.value = true
  timer = setTimeout(() => {
    timer = undefined
    try {
      bom.value = computeBom(store.toJSON(), { furnaces: furnaces.value })
      error.value = null
    } catch (cause) {
      error.value = (cause as Error).message
    } finally {
      pending.value = false
    }
  }, 200)
}

function normalizeFurnaces(): void {
  furnaces.value = Math.max(1, Math.floor(Number(furnaces.value) || 1))
}

const stopProjectWatch = watch(() => store.project, scheduleBom, { deep: true, immediate: true })
const stopFurnaceWatch = watch(furnaces, scheduleBom)

onBeforeUnmount(() => {
  if (timer !== undefined) clearTimeout(timer)
  stopProjectWatch()
  stopFurnaceWatch()
})

function blockName(blockId: string): string {
  return blockId.replace(/^minecraft:/, '').replaceAll('_', ' ')
}
</script>

<template>
  <section class="bom" aria-labelledby="bom-title" :aria-busy="pending">
    <header class="panel-heading">
      <div>
        <p class="eyebrow">Build order</p>
        <h2 id="bom-title">Bill of materials</h2>
      </div>
      <strong v-if="bom" class="total mono">{{ bom.totalBlocks.toLocaleString() }} blocks</strong>
    </header>

    <div v-if="error" class="bom-state error" role="alert">Could not compute materials: {{ error }}</div>
    <div v-else-if="!bom" class="bom-state muted">Calculating materials…</div>

    <div v-else class="bom-body">
      <div class="material-column">
        <h3>Placed materials</h3>
        <p v-if="bom.blocks.length === 0" class="muted">Paint a module to start a material list.</p>
        <ol v-else class="materials">
          <li v-for="entry in bom.blocks.slice(0, 6)" :key="entry.blockId">
            <span :title="entry.blockId">{{ blockName(entry.blockId) }}</span>
            <strong class="mono">{{ entry.stacks.label }}</strong>
          </li>
        </ol>
      </div>

      <div class="material-column">
        <h3>Raw inputs</h3>
        <p v-if="bom.rawInputs.length === 0" class="muted">No blocks to gather yet.</p>
        <ol v-else class="materials raw-inputs">
          <li v-for="entry in bom.rawInputs" :key="entry.blockId">
            <span :title="entry.blockId">{{ blockName(entry.blockId) }}</span>
            <strong class="mono">{{ entry.stacks.label }}</strong>
          </li>
        </ol>
      </div>

      <div class="smelting">
        <label>
          <span>Furnaces</span>
          <input v-model.number="furnaces" type="number" min="1" step="1" @change="normalizeFurnaces" />
        </label>
        <div>
          <span class="muted">Smelting duration</span>
          <strong class="duration mono">{{ bom.smelting.label }}</strong>
          <small class="muted">{{ bom.smelting.items.toLocaleString() }} item{{ bom.smelting.items === 1 ? '' : 's' }}</small>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.bom {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-left: 1px solid var(--border);
}

.panel-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px 9px;
  border-bottom: 1px solid var(--border);
}

.panel-heading h2,
.eyebrow {
  margin: 0;
}

.panel-heading h2 {
  font-size: 15px;
}

.eyebrow {
  color: var(--muted);
  font: 10px/1.4 var(--mono);
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.total {
  font-size: 12px;
}

.bom-body {
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(130px, 0.55fr);
  gap: 16px;
  overflow: auto;
  padding: 11px 14px 14px;
}

.material-column {
  min-width: 0;
}

h3 {
  margin: 0 0 7px;
  color: var(--muted);
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
}

.materials {
  list-style: none;
  margin: 0;
  padding: 0;
}

.materials li {
  min-width: 0;
  display: flex;
  justify-content: space-between;
  gap: 10px;
  padding: 4px 0;
  border-bottom: 1px solid var(--border);
}

.materials li span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.materials strong {
  flex: none;
  font-size: 11px;
}

.smelting {
  display: grid;
  align-content: start;
  gap: 12px;
  padding: 10px;
  background: var(--panel-2);
  border-radius: var(--radius);
}

.smelting label,
.smelting div {
  display: grid;
  gap: 4px;
}

.smelting label span,
.smelting small,
.smelting div > span {
  font-size: 11px;
}

.duration {
  font-size: 16px;
}

.bom-state {
  flex: 1;
  display: grid;
  place-content: center;
  padding: 18px;
}

.bom-state.error {
  color: var(--danger);
}

@media (max-width: 900px) {
  .bom {
    border-top: 1px solid var(--border);
    border-left: 0;
  }

  .bom-body {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .smelting {
    grid-column: 1 / -1;
  }
}

@media (max-width: 560px) {
  .bom-body {
    grid-template-columns: minmax(0, 1fr);
  }

  .smelting {
    grid-column: auto;
  }
}
</style>
