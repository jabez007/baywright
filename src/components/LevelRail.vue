<script setup lang="ts">
import { computed } from 'vue'

import { nextLevelY, useProjectStore } from '../stores/project.js'

const emit = defineEmits<{ error: [message: string] }>()
const store = useProjectStore()

const suggestedY = computed(() => nextLevelY(store.project))
const canRemove = computed(() => store.project.levels.length > 1)

function gapBelow(levelId: string) {
  return store.levelGaps.find((gap) => gap.aboveId === levelId)
}

function hasErrors(levelId: string): boolean {
  return store.issuesByLevel[levelId]?.some((issue) => issue.severity === 'error') ?? false
}

function chooseLevel(levelId: string): void {
  store.setCurrentLevel(levelId)
  store.select({ kind: 'level', levelId })
}

function addLevel(): void {
  try {
    const levelId = store.addLevel(suggestedY.value)
    store.setCurrentLevel(levelId)
    store.select({ kind: 'level', levelId })
  } catch (cause) {
    emit('error', (cause as Error).message)
  }
}

function removeCurrentLevel(): void {
  const level = store.currentLevel
  if (!level || !canRemove.value) return
  if (!window.confirm(`Remove level "${level.name}" at y ${level.y}?`)) return
  try {
    store.removeLevel(level.id)
    if (store.currentLevel) store.select({ kind: 'level', levelId: store.currentLevel.id })
  } catch (cause) {
    emit('error', (cause as Error).message)
  }
}
</script>

<template>
  <aside class="level-rail" aria-labelledby="levels-title">
    <header class="panel-heading">
      <div>
        <p class="eyebrow">Stack</p>
        <h2 id="levels-title">Levels</h2>
      </div>
      <button type="button" class="add" :title="`Add a level at y ${suggestedY}`" @click="addLevel">
        + <span class="visually-hidden">Add level</span>
      </button>
    </header>

    <ol class="level-list">
      <li v-for="level in store.levelsDescending" :key="level.id" class="level-entry">
        <button
          type="button"
          class="level-button"
          :class="{ current: store.currentLevelId === level.id }"
          :aria-current="store.currentLevelId === level.id ? 'true' : undefined"
          @click="chooseLevel(level.id)"
        >
          <span
            class="level-marker"
            :class="{ 'danger-marker': hasErrors(level.id) }"
            :title="hasErrors(level.id) ? 'This level has errors' : undefined"
            :aria-label="hasErrors(level.id) ? 'Error' : undefined"
          >{{ hasErrors(level.id) ? '!' : '' }}</span>
          <span class="level-name">{{ level.name }}</span>
          <span class="level-y mono">y {{ level.y }}</span>
        </button>

        <div v-if="gapBelow(level.id)" class="level-gap" :class="{ collision: gapBelow(level.id)!.headroom < 0 }">
          <span>{{ gapBelow(level.id)!.delta }} block gap</span>
          <span v-if="gapBelow(level.id)!.headroom < 0">{{ Math.abs(gapBelow(level.id)!.headroom) }} block overlap</span>
        </div>
      </li>
    </ol>

    <footer class="rail-actions">
      <button
        type="button"
        class="remove"
        :disabled="!canRemove"
        :title="canRemove ? 'Remove the current level' : 'A project must keep one level'"
        @click="removeCurrentLevel"
      >
        Remove current
      </button>
      <span class="muted mono">next y {{ suggestedY }}</span>
    </footer>
  </aside>
</template>

<style scoped>
.level-rail {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--panel);
  border-right: 1px solid var(--border);
  overflow: hidden;
}

.panel-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 14px 10px;
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

.add {
  width: 30px;
  height: 30px;
  padding: 0;
  font-size: 18px;
}

.level-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  list-style: none;
  margin: 0;
  padding: 10px;
}

.level-button {
  width: 100%;
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) auto;
  align-items: center;
  gap: 6px;
  padding: 9px 10px;
  text-align: left;
  background: transparent;
}

.level-button.current {
  background: var(--panel-2);
  border-color: var(--accent);
  box-shadow: inset 3px 0 0 var(--accent);
}

.level-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}

.level-y {
  color: var(--muted);
  font-size: 11px;
}

.level-marker {
  width: 16px;
  height: 16px;
}

.level-marker.danger-marker {
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--danger);
  color: white;
  font-size: 11px;
  font-weight: 800;
}

.level-gap {
  min-height: 34px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding-left: 34px;
  color: var(--muted);
  font: 10px/1.5 var(--mono);
}

.level-gap.collision {
  color: var(--danger);
}

.rail-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px;
  border-top: 1px solid var(--border);
}

.remove {
  color: var(--danger);
}

@media (max-width: 900px) {
  .level-rail {
    border-right: 0;
    border-bottom: 1px solid var(--border);
  }

  .level-list {
    display: flex;
    gap: 8px;
    overflow-x: auto;
  }

  .level-entry {
    display: flex;
    align-items: center;
  }

  .level-button {
    width: 180px;
  }

  .level-gap {
    min-width: 90px;
    min-height: auto;
    padding: 0 6px;
  }
}
</style>
