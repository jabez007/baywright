<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import { computeBom, type Bom, type GroundPlacement, type Materials } from '../domain/bom.js'
import { useProjectStore } from '../stores/project.js'

const store = useProjectStore()
const furnaces = ref(1)
const bom = ref<Bom | null>(null)
const error = ref<string | null>(null)
const pending = ref(true)
/** The level the material lists cover, or '' for the whole base. */
const scope = ref('')
/** Count only what is left once some layers are ticked off as built. */
const leaveOutBuilt = ref(true)
const builtCount = computed(() => store.project.builtLayers?.length ?? 0)
let timer: ReturnType<typeof setTimeout> | undefined

/**
 * `v-model.number` writes on every keystroke and leaves what it cannot parse as
 * a string, so mid-edit values like '', '-' and '2e' reach here. `change` fires
 * too late to help. Clamp on the way in rather than trust the `min` attribute.
 */
function furnaceCount(): number {
  return Math.max(1, Math.floor(Number(furnaces.value) || 1))
}

function scheduleBom(): void {
  if (timer !== undefined) clearTimeout(timer)
  pending.value = true
  timer = setTimeout(() => {
    timer = undefined
    try {
      bom.value = computeBom(store.toJSON(), { furnaces: furnaceCount(), leaveOutBuilt: leaveOutBuilt.value })
      error.value = null
    } catch (cause) {
      error.value = (cause as Error).message
    } finally {
      pending.value = false
    }
  }, 200)
}

function normalizeFurnaces(): void {
  furnaces.value = furnaceCount()
}

const stopProjectWatch = watch(() => store.project, scheduleBom, { deep: true, immediate: true })
const stopFurnaceWatch = watch([furnaces, leaveOutBuilt], scheduleBom)

onBeforeUnmount(() => {
  if (timer !== undefined) clearTimeout(timer)
  stopProjectWatch()
  stopFurnaceWatch()
})

/** The whole base when the chosen level is gone or builds nothing. */
const shown = computed<Materials | null>(() => {
  if (!bom.value) return null
  return bom.value.levels.find((level) => level.levelId === scope.value) ?? bom.value
})

const GROUND_LABELS: Readonly<Record<GroundPlacement, string>> = {
  underground: 'underground',
  partly: 'partly underground',
  above: 'above ground',
}

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
      <div v-if="bom && shown" class="scope">
        <label>
          <span>Materials for</span>
          <select v-model="scope">
            <option value="">Whole base</option>
            <option v-for="level in bom.levels" :key="level.levelId" :value="level.levelId">{{ level.name }}</option>
          </select>
        </label>
        <label v-if="builtCount > 0" class="left">
          <input v-model="leaveOutBuilt" type="checkbox" />
          <span>Leave out the {{ builtCount }} built layer{{ builtCount === 1 ? '' : 's' }}</span>
        </label>
        <strong class="total mono">
          {{ shown.totalBlocks.toLocaleString() }} blocks{{ builtCount > 0 && leaveOutBuilt ? ' left' : '' }}
        </strong>
      </div>
    </header>

    <div v-if="error" class="bom-state error" role="alert">Could not compute materials: {{ error }}</div>
    <div v-else-if="!bom || !shown" class="bom-state muted">Calculating materials…</div>

    <div v-else class="bom-body">
      <div class="material-column">
        <h3>Placed materials</h3>
        <p v-if="shown.blocks.length === 0" class="muted">Paint a module to start a material list.</p>
        <ol v-else class="materials">
          <li v-for="entry in shown.blocks" :key="entry.blockId">
            <span :title="entry.blockId">{{ blockName(entry.blockId) }}</span>
            <strong class="mono">{{ entry.stacks.label }}</strong>
          </li>
        </ol>
      </div>

      <div class="material-column">
        <h3>Raw inputs</h3>
        <p v-if="shown.rawInputs.length === 0" class="muted">No blocks to gather yet.</p>
        <ol v-else class="materials raw-inputs">
          <li v-for="entry in shown.rawInputs" :key="entry.blockId">
            <span :title="entry.blockId">{{ blockName(entry.blockId) }}</span>
            <strong class="mono">{{ entry.stacks.label }}</strong>
          </li>
        </ol>
      </div>

      <div class="side">
        <div class="smelting">
          <label>
            <span>Furnaces</span>
            <input v-model.number="furnaces" type="number" min="1" step="1" @change="normalizeFurnaces" />
          </label>
          <div>
            <span class="muted">Smelting duration</span>
            <strong class="duration mono">{{ shown.smelting.label }}</strong>
            <small class="muted">{{ shown.smelting.items.toLocaleString() }} item{{ shown.smelting.items === 1 ? '' : 's' }}</small>
          </div>
        </div>

        <section v-if="bom.digging" class="digging" aria-labelledby="digging-title">
          <h3 id="digging-title">Digging</h3>
          <div>
            <strong class="mono">{{ bom.digging.blocks.toLocaleString() }} blocks</strong>
            <small class="muted">At or below the ground surface at y {{ bom.digging.surfaceY }}</small>
          </div>
          <ol class="materials">
            <li v-for="entry in bom.digging.levels" :key="entry.levelId">
              <span>{{ entry.name }} · {{ GROUND_LABELS[entry.ground] }}</span>
              <strong class="mono">{{ entry.blocks.toLocaleString() }}</strong>
            </li>
          </ol>
          <template v-if="bom.digging.yields.length > 0">
            <h3>Gives back, roughly</h3>
            <ol class="materials">
              <li v-for="entry in bom.digging.yields" :key="entry.blockId">
                <span :title="entry.blockId">{{ blockName(entry.blockId) }}</span>
                <strong class="mono">{{ entry.stacks.label }}</strong>
              </li>
            </ol>
          </template>
        </section>
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

.scope {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px 12px;
  min-width: 0;
}

.scope label {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-size: 11px;
}

.scope label span {
  color: var(--muted);
  white-space: nowrap;
}

.scope select {
  min-width: 0;
  max-width: 180px;
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

.side {
  min-width: 0;
  display: grid;
  align-content: start;
  gap: 12px;
}

.digging {
  display: grid;
  gap: 8px;
}

.digging h3 {
  margin: 0;
}

.digging div {
  display: grid;
  gap: 4px;
}

.digging small {
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

  .side {
    grid-column: 1 / -1;
  }
}

@media (max-width: 560px) {
  .panel-heading {
    flex-wrap: wrap;
  }

  .scope {
    flex-basis: 100%;
  }

  .scope label {
    flex: 1;
  }

  .scope select {
    flex: 1;
    max-width: none;
  }

  .bom-body {
    grid-template-columns: minmax(0, 1fr);
  }

  .side {
    grid-column: auto;
  }
}
</style>
