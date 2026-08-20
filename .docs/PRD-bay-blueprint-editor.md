# PRD: Bay Blueprint Editor

A browser-based floor plan and blueprint tool for designing modular Minecraft bases on a 12-block bay grid, with mixed fine and coarse cells, service plenums, and multi-level vertical validation.

**Status:** v1 implemented. v2 is partial: validators V3 and V5 are implemented, while Litematica export and 3D remain planned. v3 remains planned.
**Stack:** Vue 3 + TypeScript + Vite

## 1. Problem

Modular Minecraft base design on a fixed lattice has two errors that are hard to track by hand:

1. **Vertical collision.** Rooms can be 1, 2, or 3 cells tall. Levels sit at arbitrary (multiple-of-4) y values. A 3-cell vaulted room on a lower level will silently punch through the floor of the level above, and the mistake is only discovered after hundreds of blocks are placed in survival.
2. **Grain seams.** Bays can be subdivided at two different pitches. Where a fine-grain bay meets a coarse-grain bay, most doorway positions do not line up, and there is no visual cue while drawing.

Drawing, palettes, and exports support the main job: finding these errors before construction starts.

## 2. Users

- Survival Minecraft players designing a large base before committing resources.
- Builders who want a repeatable module system rather than freehand building.
- Assume a single user on one machine. No accounts, no collaboration, no server in v1.

## 3. Goals

- Design multi-level bases on the bay grid with mixed granularity.
- Catch geometry errors automatically and explain them in plain language.
- Produce a bill of materials in stacks, so the player knows what to gather.
- Add Litematica export in v2 so the design can be used as an in-game ghost overlay.

## 4. Non-goals

- Not a world editor. The app never reads or writes save files.
- Not a general voxel editor. Everything snaps to the bay lattice; there is no freehand block placement.
- No redstone simulation, no lighting simulation, no mob spawn simulation.
- No terrain, no biomes, no existing-world context.
- No multiplayer, no cloud sync, no sharing in v1.

## 5. Domain model (normative)

Every coordinate in the app derives from the rules in this section.

### 5.1 Bay grid

- The world footprint is divided into **bays** on a **12-block pitch** in x and z.
- Bay `(i, j)` has its corner at world coordinate `(project.origin.x + 12 * i, project.origin.z + 12 * j)`.
- A bay occupies **local coordinates 0..12 inclusive** in x and z. This gives it a 13x13 outer footprint. Adjacent bays share the wall plane. Bay A's local 12 is bay B's local 0.
- Bays are addressed in the UI as a letter for i (A, B, C, ...) and a number for j (1, 2, 3, ...). Bay key format: `"A1"`, `"C3"`.

### 5.2 Grain

A bay has one of three grain values, which determines how it subdivides.

| Grain    | Cells   | Cell pitch | Cell local span | Interior span  | Interior size |
| -------- | ------- | ---------- | --------------- | -------------- | ------------- |
| `fine`   | 3x3 = 9 | 4          | `4a .. 4a+4`    | `4a+1 .. 4a+3` | 3x3           |
| `coarse` | 2x2 = 4 | 6          | `6a .. 6a+6`    | `6a+1 .. 6a+5` | 5x5           |
| `merged` | 1       | n/a        | `0 .. 12`       | `1 .. 11`      | 11x11         |

Concretely, along one axis of a bay:

- **fine** cell interiors sit at local offsets `1..3`, `5..7`, `9..11`
- **coarse** cell interiors sit at local offsets `1..5`, `7..11`
- **merged** interior sits at local offsets `1..11`

Cells within a bay are indexed row-major: `cells[b * n + a]` where `n` is 3 for fine, 2 for coarse, 1 for merged.

### 5.3 Vertical

- A `Level` has a `y` value which **must be a multiple of 4**. This is the y of the level's **floor plane**, a solid block layer.
- A cell with `heightCells = h` occupies `y .. y + 4h` inclusive. The ceiling plane is at `y + 4h`.
- Interior height is `4h - 1`: h=1 gives 3, h=2 gives 7, h=3 gives 11.
- Floor and ceiling planes are shared between vertically adjacent levels. Two levels touching at exactly one plane is legal and expected.

**Dropped ceilings (the plenum).** New edits allow `ceiling = 'dropped'` only when `heightCells === 2`. A dropped ceiling inserts an extra solid plane at `y + 4`. Early schema-v1 builds could persist height-3 dropped ceilings, whose seven-block plenums remain readable and exportable so existing designs do not lose geometry. A legacy height-1 dropped flag had no geometric effect and normalizes to `flat`.

- occupiable room: `y+1 .. y+3` (3 high)
- service plenum void: `y+5 .. y+7` (3 high)

The plenum is a first-class volume in the model. It is where hoppers, redstone, and item transport run.

`ceiling = 'flat'` means no dropped plane. The full `4h - 1` interior is one room.
`ceiling = 'vaulted'` is the same volume as `flat` but marks the cell for stair-block vault detailing in the exporter. It does not change the AABB.

### 5.4 Sockets

Each cell has six faces (`n`, `e`, `s`, `w`, `up`, `down`), each carrying a socket type:

| Socket     | Opening                                                      |
| ---------- | ------------------------------------------------------------ |
| `solid`    | none                                                         |
| `corridor` | full interior width, full interior height                    |
| `arch`     | full interior width, 2 blocks high                           |
| `window`   | 1 block wide, 1 block high, centred                          |
| `bars`     | full interior width, iron-bar blocks; visually open but not passable |
| `shaft`    | `up` and `down` only; full interior footprint opening        |

Room connectivity depends on direction. Across a horizontal shared face, the matching opposing faces must both use a room opening: `corridor` or `arch`. The two room-opening sockets may differ, so a corridor facing an arch is passable. Across a vertical shared face, the matching opposing faces must both use `shaft`. A `bars` socket places visually open blocks but does not create a passable room path. A `window` socket also does not create a room path.

### 5.5 Modules and palettes

A `Module` is a named preset that fills in default `heightCells`, `ceiling`, `sockets`, and decoration hints. Ship with these:

`corridor`, `junction`, `stair`, `spine`, `storage`, `library`, `arena`, `vault`, `prison-cell`, `workshop`, `farm`, `plenum-access`, `vestibule`, `empty`

A `Palette` maps abstract material roles (`floor`, `wall`, `ceiling`, `accent`, `trim`, `light`) to Minecraft block IDs. Ship with four: `stone-brick`, `dark-oak`, `mineshaft-oak`, `tuff-copper`.

Palette resolves per level, overridable per cell.

## 6. Data model

```ts
type Grain = 'fine' | 'coarse' | 'merged'
type Ceiling = 'dropped' | 'flat' | 'vaulted'
type Face = 'n' | 'e' | 's' | 'w' | 'up' | 'down'
type Socket = 'solid' | 'corridor' | 'arch' | 'window' | 'bars' | 'shaft'

interface Cell {
  module: string
  heightCells: 1 | 2 | 3
  ceiling: Ceiling
  sockets: Record<Face, Socket>
  mergeGroup?: string        // cells sharing this id render and export as one room
  paletteOverride?: string
  note?: string
}

interface Bay {
  grain: Grain
  cells: Cell[]               // 9 | 4 | 1, row-major
}

interface Level {
  id: string
  y: number                  // INVARIANT: y % 4 === 0
  name: string
  paletteId: string
  bays: Record<string, Bay>  // 'A1' -> Bay
}

interface Project {
  schemaVersion: 1
  id: string
  name: string
  origin: { x: number; z: number }
  bayCols: number            // how many letters
  bayRows: number            // how many numbers
  levels: Level[]             // sparse, kept sorted ascending by y
  palettes: Record<string, Palette>
}
```

The type permits all `Ceiling` values. Store actions allow new dropped ceilings only at `heightCells === 2`. Structural reads preserve the height-3 legacy exception described in §5.3.

**Store intent, derive geometry.** The persisted document contains no block coordinates. The geometry resolver computes every world coordinate on demand. The renderer, the BOM, and future block exporters use the same resolver.

## 7. Geometry resolver

This module is pure and has no Vue imports. The unit tests cover it directly.

```ts
interface CellRef { levelId: string; bayKey: string; cellIndex: number }

interface AABB { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number }

// Outer bounds of a cell, inclusive, in world coordinates
function cellAABB(project: Project, ref: CellRef): AABB

// Interior (air) bounds of a cell, excluding the dropped ceiling if present
function cellInterior(project: Project, ref: CellRef): AABB

// The plenum void above a dropped-ceiling cell, or null
function cellPlenum(project: Project, ref: CellRef): AABB | null

// Local interior span [lo, hi] along one axis for a given grain and cell index
function interiorSpan(grain: Grain, index: 0 | 1 | 2): [number, number]

// Every block position for a cell shell, keyed by material role.
// Positions MUST be deduplicated globally by coordinate because adjacent cells share
// wall planes, so naive summing overcounts.
function shellBlocks(project: Project, ref: CellRef): Map<string, Set<string>>

// Whole-project block map: "x,y,z" -> blockId. Used by exporters and the BOM.
function resolveBlocks(project: Project): Map<string, string>
```

Memoise `resolveBlocks` on the exact serialized project document. Recompute on mutation, and return a detached map so callers cannot modify the cached result.

## 8. Validation rules

The validator takes a `Project` and returns `Issue[]`. Each issue has an id, severity (`error` | `warning`), a human-readable message, and the `CellRef`s involved so the UI can highlight them.

### V1: vertical collision (error)

For every pair of cells on different levels whose x and z footprints overlap, test their y intervals. Cell AABB in y is `[level.y, level.y + 4 * heightCells]`.

Collision iff `aTop > bBottom && bTop > aBottom`. The comparison is strict because touching at one shared plane is legal.

Message format: `"{bayKey} vault at y {aBottom} reaches y {aTop} — collides with level '{name}' at y {bBottom}"`

Naive implementation is O(n²) across cells. That is acceptable up to a few thousand cells. If it becomes slow, bucket cells by bay key first, since only cells in overlapping bays can collide.

### V2: grain seam (error)

At a shared face between a `fine` bay and a `coarse` bay, the interior spans do not all align. Working the offsets:

| Fine cell | Fine span | Coarse partner   | Overlap        | Usable                |
| --------- | --------- | ---------------- | -------------- | --------------------- |
| 0         | 1..3      | coarse 0 (1..5)  | 1..3, width 3  | yes, full `corridor`  |
| 1         | 5..7      | coarse 0 (1..5)  | 5, width 1     | no                    |
| 1         | 5..7      | coarse 1 (7..11) | 7, width 1     | no                    |
| 2         | 9..11     | coarse 1 (7..11) | 9..11, width 3 | yes, full `corridor`  |

**Rule:** the two outer fine cells align with the two coarse cells and may carry any valid horizontal socket. The middle fine cell must remain `solid` on a fine/coarse seam. Its centre is local offset 6, which falls between the coarse interiors ending at 5 and starting at 7. A `window` on the middle fine cell is therefore an error too.

To clear the error without closing the face, change either bay to `merged` grain in the inspector. A merged interior spans `1..11`, so it contains every fine and coarse interior span.

Fine-to-fine and coarse-to-coarse seams always align. No check needed.

### V3: connectivity (warning)

Build an undirected graph over all cells using the room-connectivity rules from §5.4. Flood-fill from every cell whose module is `spine`. Report every cell that the fill does not reach. If the project has no spine, report every cell as unreachable.

Message: `"{bayKey} cell {n} has no path to a spine"`

Warning rather than error, because intentionally sealed secret rooms are a legitimate design.

### V4: stair continuity (error)

A cell with `sockets.up === 'shaft'` requires the cell directly above it (same bay key, overlapping footprint, next level up) to have `sockets.down === 'shaft'`. The y-delta between the two levels must equal `4 * heightCells` of the lower cell.

Message: `"Stair at {bayKey} rises {actual} but the level above is {expected} higher"`

### V5: plenum reachability (warning)

Collect all plenum AABBs on each level. Connect adjacent plenums only when the resolved shared wall has a physical opening at the plenum height. Both opposing sockets must permit that opening. `corridor`, `arch`, and `window` can connect matching plenums. The two sockets may differ because the resolved block opening decides connectivity. `bars` and `solid` cannot because they leave blocks in the shared wall.

Flood-fill from plenums in spine cells and plenums that connect to an adjacent spine through the same physical-opening test. Report each disconnected component as one plenum island. On a level with no spine, report every island.

### V6: level y alignment (error)

`level.y % 4 !== 0`. Should be prevented at the store level, but validate defensively on import.

### V7: merge group integrity (error)

All cells sharing a `mergeGroup` must have the same grain, the same `heightCells`, the same `ceiling`, and form a contiguous rectangle. Report otherwise.

## 9. Bill of materials

Computed from `resolveBlocks`. Output:

- Total blocks per Minecraft block ID.
- Stack breakdown with full stacks as `Math.floor(count / 64)`, loose remainder as `count % 64`, and occupied inventory slots as `Math.ceil(count / 64)`. For example, 2,636 blocks are 41 full stacks plus 12 loose blocks, occupy 42 slots, and display as `"41 stacks + 12"`.
- Raw-input rollup for craftable materials. Ship with these chains:
  - stone brick ← stone ← cobblestone (note furnace count: 1 cobble = 1 smelt)
  - deepslate tile ← polished deepslate ← cobbled deepslate
  - tuff brick ← polished tuff ← tuff (stonecutter, no smelting)
  - planks ← logs (4:1)

- A furnace-time estimate for the smelting chain, assuming 10 seconds per item per furnace, with a configurable furnace count.

The BOM panel recomputes 200ms after the latest document change.

## 10. UI requirements

### Layout

Four regions:

- **Left rail.** List levels by descending y, highest first. Each entry shows its y value and name. Show the vertical gap in blocks between entries because that gap exposes collisions. Mark levels that have errors. Users edit y in the inspector rather than dragging levels to reorder them.
- **Plan canvas.** Use SVG with three editing modes:
  - _Bay mode_: each bay is one tile. Painting sets grain and module for the whole bay.
  - _Cell mode_: one bay expanded, subdivided 3x3 or 2x2 by its grain. Painting sets individual cells.
  - _Footprint mode_: each field position is a target. Painting adds or removes bays from the current level.

- **Inspector.** Show properties for the selected level, bay, or cells. Controls include module, `heightCells`, ceiling, palette, sockets, merge groups, and a cell note.
- **Bottom bar.** Show the issue list and the BOM. Clicking an issue changes to its level and selects the referenced cells. The BOM shows placed blocks, raw inputs, and a smelting estimate.

### Interaction model

**Paint instead of opening a form for each cell.** Keep common placement actions on the toolbar and canvas. Use the inspector for exact properties.

- Select a module in the toolbar, then drag across cells with a mouse, touch, or pen to apply it.
- In footprint mode, drag to add or remove bays.
- Shift-drag with a mouse to create a merge group across a rectangle. The inspector provides the same merge action for a selected cell range.
- Alt-click a cell edge to cycle that face's socket.
- `[` and `]` decrease and increase `heightCells` on the selection.
- Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z for undo/redo.
- Escape clears selection.
- Tab moves focus into the plan. Arrow keys move between plan targets. Enter and Space apply the active tool to the focused target.

### Rendering

Use SVG rather than a canvas element. SVG supports Vue templates and per-target pointer and keyboard handlers without a separate canvas hit-test layer.

Colour encodes module category, not module identity. Circulation, room, service, and storage get four distinct fills. Error cells get a dashed danger border rather than a fill change, so the category remains visible.

### Undo

Snapshot the serialised project into a ring buffer of 50 on every mutation. Do not build a command pattern. Project documents contain intent rather than block maps, so cloning them is acceptable at the v1 field limit.

## 11. Exports

| Format            | Priority | Status and notes |
| ----------------- | -------- | ---------------- |
| `.json` project   | v0       | Implemented. Round-trip import and export include `schemaVersion`. |
| `.png` floor plan | v1       | Implemented. The exporter serialises the SVG and rasterises it through a canvas. It downloads one file per level. |
| `.litematic`      | v2       | Planned. Use `prismarine-nbt` for NBT and `pako` for gzip. Build the block palette from `resolveBlocks`, then write the Litematica region format. |
| `.nbt` structure  | v3       | Planned. The vanilla structure format has a 48x48x48 size limit, so larger plans require splitting. |

Prioritise Litematica export before the 3D preview because it makes the plan usable as an in-game build guide.

## 12. Tech stack and conventions

- **Vue 3**, `<script setup>`, TypeScript strict mode.
- **Vite** for build and dev server.
- **Pinia** for the project store. One store: `useProjectStore`. Mutations go through named actions so the undo ring buffer has a single interception point.
- **Vue Router** for `/project/:id/level/:levelId`.
- **`idb`** for IndexedDB persistence. Autosave debounced at 1s.
- **Vitest** for domain, store, export, and persistence tests.
- **Playwright** for browser-level workspace tests in Chromium.
- **ESLint** for Vue and TypeScript static analysis.
- **`@tresjs/core`** is planned for the 3D preview. It is not installed in v1.
- No CSS framework. Plain CSS with custom properties. Dark mode via `prefers-color-scheme`.

### Repo layout

```
src/
  domain/
    types.ts              # interfaces and field limits
    geometry.ts           # §7, pure, no Vue imports
    validate.ts           # V1 through V7
    bom.ts                # material and smelting calculations
    modules.ts            # module presets
    palettes.ts           # palette definitions
  stores/
    project.ts            # Pinia store and undo ring buffer
  persistence/
    autosave.ts           # debounced, serialized IndexedDB writes
    db.ts                 # project records and recovery
  components/
    BayTile.vue
    BomPanel.vue
    CellTile.vue
    FieldSizeDialog.vue
    Inspector.vue
    IssueList.vue
    LevelRail.vue
    PlanCanvas.vue
    Toolbar.vue
    fills.ts
  export/
    json.ts                # JSON import and export
    png.ts                 # SVG plan to PNG
  App.vue                  # router outlet
  ProjectView.vue          # v1 editor workspace
  router.ts                # root and project-level routes
  main.ts                  # Vue, Pinia, and router setup
e2e/
  workspace.spec.ts        # Playwright workspace flows
test/
  *.spec.ts                # domain, store, export, and persistence tests
.github/workflows/
  ci.yml                   # lint, unit, build, audit, and Playwright checks
playwright.config.ts
```

### Conventions

- `domain/` never imports from `vue`, `pinia`, or `components/`. Enforce by review.
- Bay keys are always uppercase letter + 1-indexed number.
- All y values are integers and multiples of 4. Assert on mutation.
- Never store block coordinates in the project document.

## 13. Milestones

### v0: single level, implemented

- Project store with one level, a 3x3 bay field.
- Grain toggle per bay.
- Paint modules onto cells in cell mode.
- SVG plan render.
- JSON save/load to IndexedDB.

The v0 acceptance flow is covered by the current app and persistence tests.

### v1: multi-level editor, implemented

- Multiple levels at arbitrary multiple-of-4 y values.
- Level rail with gap display.
- Level, bay, and cell editing in `ProjectView.vue`, with `LevelRail`, `Inspector`, `IssueList`, and `BomPanel` panels.
- Bay, cell, and footprint modes, including field resize and custom level footprints.
- Validators V1, V2, V4, V6, and V7. V3 and V5 were also completed ahead of the remaining v2 work.
- Click-to-select issues and a bill of materials with stack, raw-input, and smelting data.
- JSON import and export, plus one PNG plan per level.
- Vue Router routes for `/` and `/project/:id/level/:levelId`.
- Playwright end-to-end coverage for editing, persistence, routing, keyboard input, and a narrow viewport.
- GitHub Actions checks for unit tests, the production build, the production dependency audit, and Playwright.

The fixtures in §14 produce the expected geometry and validation results.

### v2: connectivity, Litematica, and 3D, partial

- Implemented: validators V3 and V5.
- Planned: `.litematic` export.
- Planned: TresJS 3D preview with instanced meshes.

### v3: content and sharing, planned

- Authored module presets matching stronghold, mineshaft, trial chamber, and mansion styles.
- Palette editor.
- Vanilla structure `.nbt` export with region splitting for the format limit.
- Shareable project links after choosing a backend. See §15.

## 14. Acceptance test fixtures

Write these as Vitest cases against the domain layer. Concrete numbers, so there is no ambiguity about whether the geometry is right.

**F1: Fine cell AABB.** Project origin `(0, 0)`. Bay `A1`, fine grain, cell index 4 (centre). Level y = 24, heightCells = 1.
Expect `cellAABB` = `{ x0: 4, y0: 24, z0: 4, x1: 8, y1: 28, z1: 8 }`.
Expect `cellInterior` = `{ x0: 5, y0: 25, z0: 5, x1: 7, y1: 27, z1: 7 }`.

**F2: Coarse cell AABB.** Bay `A1`, coarse grain, cell index 3 (far corner). Level y = 24, heightCells = 2.
Expect `cellAABB` = `{ x0: 6, y0: 24, z0: 6, x1: 12, y1: 32, z1: 12 }`.
Expect interior height = 7 (`y0: 25` to `y1: 31`).

**F3: Merged bay.** Bay `B2`, merged, level y = 0, heightCells = 3.
Expect interior x span 13..23 (bay B2 starts at world x = 12, local 1..11).
Expect interior height 11.

**F4: Plenum.** heightCells = 2, ceiling = `dropped`, level y = 24.
Expect `cellInterior` y span 25..27.
Expect `cellPlenum` y span 29..31.
Expect a solid ceiling plane at y = 28.

**F5: Collision detected.** Level A at y = 16 with a heightCells = 3 cell in bay A1. Level B at y = 24 with a heightCells = 1 cell in bay A1.
A's top = 16 + 12 = 28. B's bottom = 24. Expect one V1 error.

**F6: No false collision.** Level A at y = 16, heightCells = 2 (top = 24). Level B at y = 24, heightCells = 1.
They touch at exactly one plane. Expect zero V1 issues.

**F7: Grain seam, legal.** Bay A1 fine, bay B1 coarse. Fine cell index 2 (the east-edge outer cell) has `sockets.e = 'corridor'`.
Expect zero V2 issues.

**F8: Grain seam, illegal.** Same setup, but fine cell index 5 (the east-edge middle cell) has `sockets.e = 'corridor'`.
Expect one V2 error. Changing that socket to `window` still produces one V2 error because the fine cell's centre falls between the two coarse interiors. Changing the socket to `solid` clears the error. Converting bay B1 to `merged` also clears the error for either opening.

**F9: Shell dedup.** A single merged bay, heightCells = 2, all sockets solid. Outer volume 13 x 9 x 13 = 1521. Interior 11 x 7 x 11 = 847.
Expect `resolveBlocks` to return exactly 674 entries.

**F10: Stair continuity.** Level A at y = 24 with a heightCells = 2 cell, `sockets.up = 'shaft'`. Level B at y = 32 with matching `sockets.down = 'shaft'`.
Rise = 8 = 4 * 2. Expect zero V4 issues. Change level B to y = 36 and expect one V4 error.

## 15. Decisions and open questions

### Decisions

1. **v1 persistence is local-only.** Projects live in IndexedDB in one browser profile. There are no accounts, cloud sync, or shared URLs.
2. **v1 fields are capped at 8 by 8 bays.** Project creation and resize actions enforce `bayCols <= 8` and `bayRows <= 8`. JSON imports enforce the same limit, so an imported project cannot bypass the cap. Revisit the limit only with validator performance data.

### Open questions

1. **Sharing model.** Sharing requires decisions about authentication, backend storage, and moderation. It remains v3 work.
2. **Litematica version compatibility.** The `.litematic` format has changed across Litematica releases. Choose a schema version and show it in the export dialog.
3. **Palette scope.** Palettes currently resolve per level with an optional per-cell override. Decide whether the palette editor also needs per-bay overrides.
