# Baywright

A browser-based floor plan and blueprint tool for designing modular Minecraft
bases on a 12-block bay grid. The full specification lives in
[`.docs/PRD-bay-blueprint-editor.md`](.docs/PRD-bay-blueprint-editor.md); this
file only covers how to run what is built.

## Running

```sh
npm install
npm run dev        # Vite dev server
npm test           # Vitest — geometry, validators, BOM, store, persistence
npm run typecheck  # vue-tsc, strict
npm run build      # typecheck + production bundle into dist/
```

## What is built

**Domain layer (PRD §5–§9), complete and covered by the §14 fixtures F1–F10.**
`src/domain/` is pure — no Vue, no Pinia, no I/O:

| Module        | PRD | Notes                                                        |
| ------------- | --- | ------------------------------------------------------------ |
| `types.ts`    | §6  | The document model. No block coordinates are ever persisted. |
| `geometry.ts` | §7  | Every world coordinate derives here. `resolveBlocks` is memoised on a content hash. |
| `validate.ts` | §8  | All seven validators, V1–V7.                                 |
| `bom.ts`      | §9  | Stacks, raw-input rollup, furnace-time estimate.             |
| `modules.ts`  | §5.5 | The fourteen shipped presets.                               |
| `palettes.ts` | §5.5 | The four shipped palettes.                                   |

**v0 app (PRD §13).** One level on a bay field, painted and persisted:

- `src/stores/project.ts` — the one Pinia store, with the 50-deep undo ring.
- `src/components/` — the SVG plan canvas in bay and cell modes, and the paint
  toolbar. Fill encodes module category; validator errors are a dashed overlay.
- `src/export/json.ts` — project save/load, with a defensive import path.
- `src/persistence/` — IndexedDB via `idb`, autosaved 1s after edits stop.

Interaction (§10): drag to paint · shift-drag to merge · alt-click a cell edge
to cycle that face's socket · `[` / `]` to change height · Ctrl/Cmd+Z to undo ·
Escape to clear the selection.

## Not built yet

Level rail, inspector, issue list and BOM panel (v1 UI — the validators and BOM
they display are already done and tested); PNG, `.litematic` and `.nbt` exports;
the 3D preview. The app is single-level and single-project: `vue-router` is
deliberately deferred until there is something to navigate, and the bay field is
capped at 8x8 per §15 open question 2.
