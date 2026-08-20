# Baywright

Baywright is a browser-based floor-plan editor for modular Minecraft bases. It uses a 12-block bay grid with fine, coarse, and merged cells. The current code includes the v1 multi-level editor and all seven domain validators. See [the product requirements](.docs/PRD-bay-blueprint-editor.md) for the geometry and validation rules.

## Requirements

- Node.js 22.12 or later in the Node 22 release line
- npm

## Install and run

```sh
npm install
npm run dev
```

Open the URL that Vite prints. The development server uses a self-signed HTTPS certificate, so the browser may ask you to accept it on the first visit.

## Run the checks

Install Playwright's Chromium build once before the first end-to-end test run:

```sh
npx playwright install chromium
```

Run individual checks with these commands:

```sh
npm test             # Vitest unit and integration tests
npm run lint         # ESLint for Vue and TypeScript
npm run typecheck    # vue-tsc in strict mode
npm run build        # typecheck and create the production bundle in dist/
npm run test:e2e     # Playwright tests in Chromium
npm run verify       # tests, build, e2e, dependency audits, and git diff checks
```

## What is implemented

The domain layer in `src/domain/` has no Vue, Pinia, or browser dependencies. It provides:

- the project, level, bay, cell, palette, module, and socket model;
- coordinate and block geometry for fine, coarse, and merged bays;
- vertical collisions, grain seams, room connectivity, stair continuity, plenum reachability, level alignment, and merge-group validation;
- block deduplication, material totals, raw-input rollups, and smelting estimates; and
- the shipped module presets and palettes.

The v1 editor provides:

- multi-level plans with level gaps, custom footprints, and fields up to 8 by 8 bays;
- bay, cell, and footprint editing modes on an SVG plan;
- module painting, grain changes, merge groups, cell heights, ceilings, sockets, notes, and palette overrides;
- a level rail, selection inspector, issue list, and bill-of-materials panel;
- a 50-entry undo and redo history; and
- layouts for desktop and narrow viewports.

The app has two routes: `/` and `/project/:id/level/:levelId`. The root route restores the last valid local project and then changes to its project and level URL. These URLs identify local IndexedDB records. They are not share links.

JSON export writes the complete project document. JSON import checks the schema, field bounds, cells, sockets, ceilings, and palette references, then saves the import as a new local project. Legacy schema-v1 height-3 plenums retain their original geometry; height-1 dropped flags normalize to `flat` because they never affected blocks. PNG export downloads one rendered plan for each level.

## Local persistence

Baywright stores projects only in the current browser profile through IndexedDB. It has no account, server, cloud sync, or cross-device recovery.

Autosave waits one second after an edit and serializes writes so an older save cannot finish last. Startup skips invalid records and tries the newest valid saved project. Imports also enforce the 8 by 8 field limit and the other structural checks.

When the page becomes hidden or starts to unload, Baywright starts any pending write without waiting for the debounce. A browser can still close the page before IndexedDB commits that write. Use JSON export for backups that must survive browser data loss or a missed final save.

## Controls

- Drag with a mouse, touch, or pen to paint bays or cells. In footprint mode, dragging adds or removes bays.
- Press `Tab` to enter the plan, use the arrow keys to move between targets, and press `Enter` or `Space` to apply the active tool.
- Shift-drag cells to make a rectangular merge group.
- Alt-click a cell edge to cycle its horizontal socket.
- Press `[` or `]` to change the selected cells' height.
- Press Ctrl/Cmd+Z to undo and Ctrl/Cmd+Shift+Z to redo.
- Press `Escape` to clear the selection.

The inspector also exposes merge, height, ceiling, and socket controls without modifier keys.

## Tests and CI

Vitest covers geometry, every validator, the BOM and recipes, modules, the project store, JSON and PNG exports, IndexedDB recovery, and autosave behavior. Playwright checks editing and reload, one-bay issue navigation, roving SVG focus, PNG state restoration, project Back/Forward routes, and narrow or short viewports.

GitHub Actions runs on pushes and pull requests. It installs with `npm ci`, runs ESLint, the unit tests, and the production build, audits production dependencies, installs Chromium, and runs the Playwright suite.

## Not implemented

- Litematica export
- vanilla structure NBT export
- 3D preview
- palette editing
- additional style-specific module and palette content
- project sharing or cloud sync
