<script setup lang="ts">
import type { Issue } from '../domain/validate.js'
import { useProjectStore } from '../stores/project.js'

const store = useProjectStore()

/**
 * Where clicking the row would take you, if anywhere. A project-wide issue
 * names no level and no cells, so its row is a message rather than a control.
 */
function targetLevel(issue: Issue): string | undefined {
  return issue.levelId ?? issue.refs[0]?.levelId
}

function showIssue(issue: Issue): void {
  const targetLevelId = targetLevel(issue)
  if (!targetLevelId) return

  store.setCurrentLevel(targetLevelId)
  const visibleRefs = issue.refs.filter((ref) => ref.levelId === targetLevelId)
  if (visibleRefs.length > 0) {
    const firstBay = visibleRefs[0]!.bayKey
    store.selectCells(visibleRefs.filter((ref) => ref.bayKey === firstBay))
  }
  else store.select({ kind: 'level', levelId: targetLevelId })
}
</script>

<template>
  <section class="issues" aria-labelledby="issues-title">
    <header class="panel-heading">
      <div>
        <p class="eyebrow">Validation</p>
        <h2 id="issues-title">Issues</h2>
      </div>
      <span class="issue-count mono">{{ store.issues.length }}</span>
    </header>

    <div v-if="store.issues.length === 0" class="empty-state">
      <strong>No plan issues</strong>
      <span class="muted">The current stack passes all seven checks.</span>
    </div>

    <ol v-else class="issue-list">
      <li v-for="(issue, index) in store.issues" :key="`${issue.id}-${index}-${issue.message}`">
        <button
          type="button"
          class="issue"
          :class="issue.severity"
          :disabled="!targetLevel(issue)"
          @click="showIssue(issue)"
        >
          <span class="severity">{{ issue.severity }}</span>
          <strong class="issue-id mono">{{ issue.id }}</strong>
          <span class="message">{{ issue.message }}</span>
        </button>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.issues {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
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

.issue-count {
  min-width: 24px;
  padding: 3px 7px;
  border-radius: 999px;
  background: var(--panel-2);
  text-align: center;
}

.issue-list {
  min-height: 0;
  overflow: auto;
  list-style: none;
  margin: 0;
  padding: 8px;
}

.issue {
  width: 100%;
  display: grid;
  grid-template-columns: 58px 28px minmax(0, 1fr);
  align-items: start;
  gap: 8px;
  margin-bottom: 5px;
  padding: 7px 9px;
  background: transparent;
  text-align: left;
}

.issue.error {
  border-left: 3px solid var(--danger);
}

.issue.warning {
  border-left: 3px solid var(--accent);
}

/* Not actionable, but not degraded either: it still reads as a live warning. */
.issue:disabled {
  cursor: default;
  opacity: 1;
}

.severity {
  color: var(--muted);
  font-size: 11px;
  text-transform: uppercase;
}

.message {
  line-height: 1.35;
  overflow-wrap: anywhere;
}

.empty-state {
  flex: 1;
  min-height: 110px;
  display: grid;
  place-content: center;
  gap: 4px;
  padding: 18px;
  text-align: center;
}

@media (max-width: 560px) {
  .issue {
    grid-template-columns: 52px 26px minmax(0, 1fr);
    gap: 6px;
  }
}
</style>
