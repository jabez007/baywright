# Baywright

Baywright is a browser-based floor-plan editor for modular Minecraft bases. Its shared-wall grid combines 13×13 structural bays, 7×7 rooms, and 5×5 utility units. The current code includes the v1 multi-level editor and eight domain validators. See [the product requirements](.docs/PRD-bay-blueprint-editor.md) for the geometry and validation rules. See [the project direction](.docs/PROJECT-DIRECTION.md) for the adopted structure grammar and the ordered roadmap.

## Requirements

- Node.js 22.12 or later in the Node 22 release line
- npm

## Install and run

```sh
npm install
npm run dev
```

Open the URL that Vite prints. The development server uses a self-signed HTTPS certificate, so the browser may ask you to accept it on the first visit.

`npm run dev` listens on loopback only. To open a project from a phone or another machine on the network, run `npm run dev:lan` instead, which binds every interface. That makes the server, and any project it is serving, reachable by anyone who can route to the host, so prefer it on trusted networks and stop it when you are done.

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
- vertical collisions, grain seams, room connectivity, stair continuity, plenum reachability, level alignment, merge-group validation, and overworld build limits;
- block deduplication, material totals, raw-input rollups, and smelting estimates; and
- the shipped module presets and palettes.

The v1 editor provides:

- multi-level plans with level gaps, custom footprints, named negative space, and fields up to 8 by 8 bays;
- bay and cell views, plus Footprint and Space tools on an SVG plan;
- module painting, connection-aware bay stamps, rotatable multi-bay layouts, grain changes, merge groups, cell heights, ceilings, sockets, centred opening widths, notes, and palette overrides;
- a sparse four-level starter project with mansion, stronghold, trial, and mineshaft palettes;
- a level rail, selection inspector, issue list, and bill-of-materials panel;
- a 50-entry undo and redo history; and
- layouts for desktop and narrow viewports.

## The 13 / 7 / 5 building system

Baywright measures outer footprints inclusively because adjacent spaces share their wall plane. The three bay details map the building system onto one 12-block pitch:

| Bay detail | Subdivision | Outer footprint | Interior |
| ---------- | ----------- | --------------- | -------- |
| Fine       | 3×3 units   | 5×5 each        | 3×3 each |
| Coarse     | 2×2 rooms   | 7×7 each        | 5×5 each |
| Merged     | One bay     | 13×13            | 11×11    |

A one-cell height occupies five blocks and has a three-block interior. Taller cells share floor and ceiling planes, so two height cells occupy nine blocks and three occupy thirteen.

Merged Arena cells apply the system inside the bay: a trim outline marks the centred 7×7 purpose core, leaving a two-block circulation ring in the 11×11 interior. Four palette-resolved pillars and a central ceiling light are included in exported blocks and material totals.

Infrastructure planning uses ordinary modules rather than a separate simulator. Rail lines, ice highways, item trunks, mine access, Nether portals, super smelters, auto crafters, and trading halls carry useful height, socket, palette, and detailing intent. Transport and item-trunk bay patterns make the straight runs reusable; the layered example now uses rail-line bays on its lowest level. Throughput, redstone state, and entity behavior remain outside Baywright's scope.

The app has two routes: `/` and `/project/:id/level/:levelId`. The root route restores the last valid local project and then changes to its project and level URL. These URLs identify local IndexedDB records. They are not share links.

JSON export writes the complete project document. JSON import checks the schema, field bounds, cells, sockets, opening widths, ceilings, negative-space annotations, and palette references, then saves the import as a new local project. Projects without opening widths retain full-width passages. Legacy schema-v1 height-3 plenums retain their original geometry; height-1 dropped flags normalize to `flat` because they never affected blocks. PNG export downloads one rendered plan for each level.

## Local persistence

Baywright stores projects only in the current browser profile through IndexedDB. It has no account, server, cloud sync, or cross-device recovery.

Autosave waits one second after an edit and serializes writes so an older save cannot finish last. Startup skips invalid records and tries the newest valid saved project. Imports also enforce the 8 by 8 field limit and the other structural checks.

When the page becomes hidden or starts to unload, Baywright starts any pending write without waiting for the debounce. A browser can still close the page before IndexedDB commits that write. Use JSON export for backups that must survive browser data loss or a missed final save.

## Controls

- Select is the default tool. Click a bay or cell to inspect it without changing the plan. Drag across cells to select a range.
- Double-click a bay to open its cells. Use the **Bays** and **Cells** controls to change views directly.
- Choose **Paint** and a module to paint bays or cells. Drag with a mouse, touch, or pen to paint several targets.
- Choose **Stamp** and a bay pattern to replace whole bays with reusable layouts. **Auto fit** rotates each stamp to match openings in adjacent bays; fixed rotations remain available when the plan calls for a specific orientation.
- Choose **Layout** to stamp a Stronghold loop, grand chamber, library wing, or workshop wing from a north-west anchor. Layouts may fill absent footprint slots, and the whole placement is one undo step.
- Choose **Empty** to clear bays or cells. Clearing a bay preserves its grain.
- Choose **Footprint** to add or remove bays. Drag to change several bays.
- Choose **Space** to name absent bays as courtyards, gardens, caves, stair shafts, or reserved expansion. Building a bay in that slot clears the name.
- Choose **New project** from the **Project** menu to start blank or load the layered base example.
- Use the **Skip to plan** link or press `Tab` to enter the plan. Use the arrow keys to move between targets. Press `Enter` or `Space` to apply the active tool.
- Shift-drag cells to make a rectangular merge group.
- Alt-click a cell edge to cycle its horizontal socket.
- Press `[` or `]` to change the selected cells' height.
- Press Ctrl/Cmd+Z to undo and Ctrl/Cmd+Shift+Z to redo.
- Press `Escape` to clear the selection.

The inspector also exposes module, merge, height, ceiling, socket, and opening-width controls without modifier keys. On narrow screens, it opens as a sheet over the bottom of the plan.

## Tests and CI

Vitest covers geometry, every validator, the BOM and recipes, modules, the project store, JSON and PNG exports, IndexedDB recovery, and autosave behavior. Playwright checks editing and reload, one-bay issue navigation, roving SVG focus, PNG state restoration, project Back/Forward routes, and narrow or short viewports.

GitHub Actions runs on pushes and pull requests. It installs with `npm ci`, runs ESLint, the unit tests, and the production build, audits production dependencies, installs Chromium, and runs the Playwright suite.

## Not implemented

The [project direction](.docs/PROJECT-DIRECTION.md) explains which design candidates come next and why.

- Litematica export
- vanilla structure NBT export
- 3D preview
- palette editing
- additional style-specific module and palette content
- project sharing or cloud sync
