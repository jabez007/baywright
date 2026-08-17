# PRD — Bay Blueprint Editor

A browser-based floor plan and blueprint tool for designing modular Minecraft bases on a 12-block bay grid, with mixed fine/coarse cell granularity, service plenums, and multi-level vertical validation.

**Status:** draft for implementation
**Target implementer:** Claude Code
**Stack:** Vue 3 + TypeScript + Vite

\---

## 1\. Problem

Modular Minecraft base design on a fixed lattice is powerful but has two failure modes a human cannot reliably track by hand:

1. **Vertical collision.** Rooms can be 1, 2, or 3 cells tall. Levels sit at arbitrary (multiple-of-4) y values. A 3-cell vaulted room on a lower level will silently punch through the floor of the level above, and the mistake is only discovered after hundreds of blocks are placed in survival.
2. **Grain seams.** Bays can be subdivided at two different pitches. Where a fine-grain bay meets a coarse-grain bay, most doorway positions do not line up, and there is no visual cue while drawing.

Everything else the tool does — drawing, palettes, exports — is in service of catching those two classes of error before the player mines a single block.

## 2\. Users

- Survival Minecraft players designing a large base before committing resources.
- Builders who want a repeatable module system rather than freehand building.
- Assume a single user on one machine. No accounts, no collaboration, no server in v1.

## 3\. Goals

- Design multi-level bases on the bay grid with mixed granularity.
- Catch geometry errors automatically and explain them in plain language.
- Produce a bill of materials in stacks, so the player knows what to gather.
- Export to Litematica so the design can be built in-game against a ghost overlay.

## 4\. Non-goals

- Not a world editor. The app never reads or writes save files.
- Not a general voxel editor. Everything snaps to the bay lattice; there is no freehand block placement.
- No redstone simulation, no lighting simulation, no mob spawn simulation.
- No terrain, no biomes, no existing-world context.
- No multiplayer, no cloud sync, no sharing in v1.

\---

## 5\. Domain model (normative)

This section is the specification. Every coordinate in the app derives from these rules. Implement them exactly.

### 5.1 Bay grid

- The world footprint is divided into **bays** on a **12-block pitch** in x and z.
- Bay `(i, j)` has its corner at world coordinate `(project.origin.x + 12\*i, project.origin.z + 12\*j)`.
- A bay occupies **local coordinates 0..12 inclusive** in x and z — a 13x13 outer footprint. Adjacent bays share the wall plane (bay A's local 12 is bay B's local 0).
- Bays are addressed in the UI as a letter for i (A, B, C, ...) and a number for j (1, 2, 3, ...). Bay key format: `"A1"`, `"C3"`.

### 5.2 Grain

A bay has one of three grain values, which determines how it subdivides.

| Grain    | Cells   | Cell pitch | Cell local span | Interior span  | Interior size |
| -------- | ------- | ---------- | --------------- | -------------- | ------------- |
| `fine`   | 3x3 = 9 | 4          | `4a .. 4a+4`    | `4a+1 .. 4a+3` | 3x3           |
| `coarse` | 2x2 = 4 | 6          | `6a .. 6a+6`    | `6a+1 .. 6a+5` | 5x5           |
| `merged` | 1       | —          | `0 .. 12`       | `1 .. 11`      | 11x11         |

Concretely, along one axis of a bay:

- **fine** cell interiors sit at local offsets `1..3`, `5..7`, `9..11`
- **coarse** cell interiors sit at local offsets `1..5`, `7..11`
- **merged** interior sits at local offsets `1..11`

Cells within a bay are indexed row-major: `cells\[b \* n + a]` where `n` is 3 for fine, 2 for coarse, 1 for merged.

### 5.3 Vertical

- A `Level` has a `y` value which **must be a multiple of 4**. This is the y of the level's **floor plane** — a solid block layer.
- A cell with `heightCells = h` occupies `y .. y + 4h` inclusive. The ceiling plane is at `y + 4h`.
- Interior height is `4h - 1`: h=1 gives 3, h=2 gives 7, h=3 gives 11.
- Floor and ceiling planes are shared between vertically adjacent levels. Two levels touching at exactly one plane is legal and expected.

**Dropped ceilings (the plenum).** A cell with `heightCells = 2` and `ceiling = 'dropped'` gets an extra solid ceiling plane inserted at `y + 4`. The result is:

- occupiable room: `y+1 .. y+3` (3 high)
- service plenum void: `y+5 .. y+7` (3 high)

The plenum is a first-class volume in the model. It is where hoppers, redstone, and item transport run.

`ceiling = 'flat'` means no dropped plane — the full `4h - 1` interior is one room.
`ceiling = 'vaulted'` is the same volume as `flat` but marks the cell for stair-block vault detailing in the exporter. It does not change the AABB.

### 5.4 Sockets

Each cell has six faces (`n`, `e`, `s`, `w`, `up`, `down`), each carrying a socket type:

| Socket     | Opening                                                      |
| ---------- | ------------------------------------------------------------ |
| `solid`    | none                                                         |
| `corridor` | full interior width, full interior height                    |
| `arch`     | full interior width, 2 blocks high                           |
| `window`   | 1 block wide, 1 block high, centred                          |
| `bars`     | full interior width, iron bars (visually open, not passable) |
| `shaft`    | `up`/`down` only — full interior footprint opening           |

Two cells are **connected** if they are adjacent and both share a non-`solid`, non-`window` socket on the shared face.

### 5.5 Modules and palettes

A `Module` is a named preset that fills in default `heightCells`, `ceiling`, `sockets`, and decoration hints. Ship with these:

`corridor`, `junction`, `stair`, `spine`, `storage`, `library`, `arena`, `vault`, `prison-cell`, `workshop`, `farm`, `plenum-access`, `vestibule`, `empty`

A `Palette` maps abstract material roles (`floor`, `wall`, `ceiling`, `accent`, `trim`, `light`) to Minecraft block IDs. Ship with four: `stone-brick`, `dark-oak`, `mineshaft-oak`, `tuff-copper`.

Palette resolves per level, overridable per cell.

\---

## 6\. Data model

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
  cells: Cell\[]              // 9 | 4 | 1, row-major
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
  levels: Level\[]            // sparse, kept sorted ascending by y
  palettes: Record<string, Palette>
}
```

**Store intent, derive geometry.** The persisted document contains no block coordinates. Every world coordinate is computed on demand by the geometry resolver. This keeps project files small (single-digit KB) and makes the exporter a pure function of the same resolver the renderer uses.

\---

## 7\. Geometry resolver

A pure, side-effect-free module. No Vue imports. Fully unit-testable. This is the foundation — build and test it before any UI.

```ts
interface CellRef { levelId: string; bayKey: string; cellIndex: number }

interface AABB { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number }

// Outer bounds of a cell, inclusive, in world coordinates
function cellAABB(project: Project, ref: CellRef): AABB

// Interior (air) bounds of a cell, excluding the dropped ceiling if present
function cellInterior(project: Project, ref: CellRef): AABB

// The plenum void above a dropped-ceiling cell, or null
function cellPlenum(project: Project, ref: CellRef): AABB | null

// Local interior span \[lo, hi] along one axis for a given grain and cell index
function interiorSpan(grain: Grain, index: 0 | 1 | 2): \[number, number]

// Every block position for a cell shell, keyed by material role.
// Positions MUST be deduplicated globally by coordinate — adjacent cells share
// wall planes, so naive summing overcounts.
function shellBlocks(project: Project, ref: CellRef): Map<string, Set<string>>

// Whole-project block map: "x,y,z" -> blockId. Used by exporters and the BOM.
function resolveBlocks(project: Project): Map<string, string>
```

Memoise `resolveBlocks` on a hash of the project document. Recompute on mutation, not on every render.

\---

## 8\. Validation rules

The validator takes a `Project` and returns `Issue\[]`. Each issue has an id, severity (`error` | `warning`), a human-readable message, and the `CellRef`s involved so the UI can highlight them.

### V1 — Vertical collision (error)

For every pair of cells on different levels whose x/z footprints overlap, test their y intervals. Cell AABB in y is `\[level.y, level.y + 4 \* heightCells]`.

Collision iff `aTop > bBottom \&\& bTop > aBottom` (strict — touching at exactly one shared plane is legal).

Message format: `"{bayKey} vault at y {aBottom} reaches y {aTop} — collides with level '{name}' at y {bBottom}"`

Naive implementation is O(n²) across cells. That is acceptable up to a few thousand cells. If it becomes slow, bucket cells by bay key first, since only cells in overlapping bays can collide.

### V2 — Grain seam (error)

At a shared face between a `fine` bay and a `coarse` bay, the interior spans do not all align. Working the offsets:

| Fine cell | Fine span | Coarse partner   | Overlap        | Usable                |
| --------- | --------- | ---------------- | -------------- | --------------------- |
| 0         | 1..3      | coarse 0 (1..5)  | 1..3, width 3  | yes — full `corridor` |
| 1         | 5..7      | coarse 0 (1..5)  | width 1        | no                    |
| 1         | 5..7      | coarse 1 (7..11) | width 1        | no                    |
| 2         | 9..11     | coarse 1 (7..11) | 9..11, width 3 | yes — full `corridor` |

**Rule:** the two outer fine cells align with the two coarse cells and may carry any socket. The **middle fine cell** may carry at most a `window` on a fine/coarse seam. Any wider socket there is an error.

Quick fix offered by the UI: convert one of the two bays to `merged` grain. A merged bay's interior span is `1..11`, which contains every fine and coarse span, so a merged bay is a universal adapter at any seam. This is the vestibule pattern.

Fine-to-fine and coarse-to-coarse seams always align. No check needed.

### V3 — Connectivity (warning)

Build an undirected graph over all cells using the socket adjacency rule from §5.4. Flood-fill from every cell whose module is `spine`. Any cell not reached is reported.

Message: `"{bayKey} cell {n} has no path to a spine"`

Warning rather than error, because intentionally sealed secret rooms are a legitimate design.

### V4 — Stair continuity (error)

A cell with `sockets.up === 'shaft'` requires the cell directly above it (same bay key, overlapping footprint, next level up) to have `sockets.down === 'shaft'`. The y-delta between the two levels must equal `4 \* heightCells` of the lower cell.

Message: `"Stair at {bayKey} rises {actual} but the level above is {expected} higher"`

### V5 — Plenum reachability (warning)

Collect all plenum AABBs on a level. Two plenums are connected if their volumes are adjacent and the wall between them is not `solid` on the corresponding cell face. Flood-fill from any plenum adjacent to a `spine` cell. Report disconnected plenum islands, since a hopper trunk in an island has nowhere to terminate.

### V6 — Level y alignment (error)

`level.y % 4 !== 0`. Should be prevented at the store level, but validate defensively on import.

### V7 — Merge group integrity (error)

All cells sharing a `mergeGroup` must have the same grain, the same `heightCells`, the same `ceiling`, and form a contiguous rectangle. Report otherwise.

\---

## 9\. Bill of materials

Computed from `resolveBlocks`. Output:

- Total blocks per Minecraft block ID.
- Converted to stacks: `Math.ceil(count / 64)` plus remainder, displayed as `"41 stacks + 12"`.
- Raw-input rollup for craftable materials. Ship with these chains:
  - stone brick ← stone ← cobblestone (note furnace count: 1 cobble = 1 smelt)
  - deepslate tile ← polished deepslate ← cobbled deepslate
  - tuff brick ← polished tuff ← tuff (stonecutter, no smelting)
  - planks ← logs (4:1)

- A furnace-time estimate for the smelting chain, assuming 10 seconds per item per furnace, with a configurable furnace count.

The BOM panel must recompute reactively but debounced — 200ms is fine.

\---

## 10\. UI requirements

### Layout

Four regions:

- **Left rail — level list.** Vertically ordered by y descending (highest first). Each entry shows y and name. Between entries, show the **vertical gap in blocks** as muted text. This is deliberate: the gap is where collisions hide. Levels with errors get a danger-coloured marker. Drag to reorder is not required; editing y in the inspector is enough.
- **Centre — plan canvas.** SVG. Two zoom modes:
  - _Bay mode_: each bay is one tile. Painting sets grain and module for the whole bay.
  - _Cell mode_: one bay expanded, subdivided 3x3 or 2x2 by its grain. Painting sets individual cells.

- **Right — inspector.** Properties of the current selection (cell, bay, or level). Module, heightCells, ceiling, palette, six socket dropdowns, free-text note.
- **Bottom bar — issues and BOM.** Issue list is clickable; clicking selects and scrolls to the offending cell. BOM shows top materials in stacks.

### Interaction model

**Paint, do not configure.** This is the single most important UX requirement. A tool that requires opening a modal per cell will not get used.

- Select a module in the toolbar, then click-drag across cells to apply it.
- Shift-drag to create a merge group across a rectangle.
- Alt-click a cell edge to cycle that face's socket.
- `\[` and `]` decrease/increase `heightCells` on the selection.
- Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z for undo/redo.
- Escape clears selection.

### Rendering

Use **SVG, not canvas**. At 9 bays x 9 cells there are under 100 `<rect>` elements per level. SVG gives declarative Vue templating and free click handlers with no hit-testing code.

Colour encodes module category, not module identity. Circulation, room, service, and storage get four distinct fills. Error cells get a dashed danger border overlaid — never a fill change, so the underlying category stays readable.

### Undo

Snapshot the serialised project into a ring buffer of 50 on every mutation. Do not build a command pattern. The document is a few KB; `structuredClone` is fast enough and this takes an afternoon instead of a week.

\---

## 11\. Exports

| Format            | Priority | Notes                                                                                                                                                  |
| ----------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `.json` project   | v0       | Round-trip save/load. Include `schemaVersion`.                                                                                                         |
| `.png` floor plan | v1       | Serialise the SVG, rasterise via canvas. One file per level.                                                                                           |
| `.litematic`      | v2       | The flagship. Use `prismarine-nbt` for NBT and `pako` for gzip. Build the block palette from `resolveBlocks`, then write the Litematica region format. |
| `.nbt` structure  | v3       | Vanilla structure block format. Beware the 48x48x48 size limit — will require splitting.                                                               |

Litematica is the export that closes the loop: design in the browser, then build in-game against a ghost overlay. Prioritise it over 3D preview if time is tight.

\---

## 12\. Tech stack and conventions

- **Vue 3**, `<script setup>`, TypeScript strict mode.
- **Vite** for build and dev server.
- **Pinia** for the project store. One store: `useProjectStore`. Mutations go through named actions so the undo ring buffer has a single interception point.
- **Vue Router** for `/project/:id/level/:levelId`.
- **`idb`** for IndexedDB persistence. Autosave debounced at 1s.
- **Vitest** for unit tests. The geometry resolver and validator must have test coverage; the UI need not.
- **`@tresjs/core`** for the optional 3D preview (v2+). Use instanced meshes.
- No CSS framework. Plain CSS with custom properties. Dark mode via `prefers-color-scheme`.

### Repo layout

```
src/
  domain/
    types.ts           # the interfaces in §6
    geometry.ts        # §7, pure, no Vue imports
    validate.ts        # §8, pure
    bom.ts             # §9, pure
    modules.ts         # module presets
    palettes.ts        # palette definitions
  stores/
    project.ts         # Pinia store + undo ring buffer
  components/
    LevelRail.vue
    PlanCanvas.vue
    BayTile.vue
    CellTile.vue
    Inspector.vue
    IssueList.vue
    BomPanel.vue
  export/
    json.ts
    png.ts
    litematic.ts
  App.vue
  main.ts
test/
  geometry.spec.ts
  validate.spec.ts
```

### Conventions

- `domain/` never imports from `vue`, `pinia`, or `components/`. Enforce by review.
- Bay keys are always uppercase letter + 1-indexed number.
- All y values are integers and multiples of 4. Assert on mutation.
- Never store block coordinates in the project document.

\---

## 13\. Milestones

### v0 — Single level (target: one working session)

- Project store with one level, a 3x3 bay field.
- Grain toggle per bay.
- Paint modules onto cells in cell mode.
- SVG plan render.
- JSON save/load to IndexedDB.

**Acceptance:** create a 3x3 bay level, set B2 to coarse grain, paint a spine into it, reload the page, and see the same design.

### v1 — Multi-level and validation (the version that is actually useful)

- Multiple levels at arbitrary multiple-of-4 y values.
- Level rail with gap display.
- Validators V1, V2, V4, V6, V7.
- Issue list with click-to-select.
- Bill of materials in stacks.
- PNG export.

**Acceptance:** the fixtures in §14 all produce the expected issues.

### v2 — Litematica and 3D

- `.litematic` export.
- TresJS 3D preview with instanced meshes.
- Validators V3 and V5.

### v3 — Content and polish

- Authored module presets matching stronghold, mineshaft, trial chamber, and mansion styles.
- Palette editor.
- Shareable project links (requires deciding on a backend — see §15).

\---

## 14\. Acceptance test fixtures

Write these as Vitest cases against the domain layer. Concrete numbers, so there is no ambiguity about whether the geometry is right.

**F1 — Fine cell AABB.** Project origin `(0, 0)`. Bay `A1`, fine grain, cell index 4 (centre). Level y = 24, heightCells = 1.
Expect `cellAABB` = `{ x0: 4, y0: 24, z0: 4, x1: 8, y1: 28, z1: 8 }`.
Expect `cellInterior` = `{ x0: 5, y0: 25, z0: 5, x1: 7, y1: 27, z1: 7 }`.

**F2 — Coarse cell AABB.** Bay `A1`, coarse grain, cell index 3 (far corner). Level y = 24, heightCells = 2.
Expect `cellAABB` = `{ x0: 6, y0: 24, z0: 6, x1: 12, y1: 32, z1: 12 }`.
Expect interior height = 7 (`y0: 25` to `y1: 31`).

**F3 — Merged bay.** Bay `B2`, merged, level y = 0, heightCells = 3.
Expect interior x span 13..23 (bay B2 starts at world x = 12, local 1..11).
Expect interior height 11.

**F4 — Plenum.** heightCells = 2, ceiling = `dropped`, level y = 24.
Expect `cellInterior` y span 25..27.
Expect `cellPlenum` y span 29..31.
Expect a solid ceiling plane at y = 28.

**F5 — Collision detected.** Level A at y = 16 with a heightCells = 3 cell in bay A1. Level B at y = 24 with a heightCells = 1 cell in bay A1.
A's top = 16 + 12 = 28. B's bottom = 24. Expect one V1 error.

**F6 — No false collision.** Level A at y = 16, heightCells = 2 (top = 24). Level B at y = 24, heightCells = 1.
They touch at exactly one plane. Expect **zero** issues.

**F7 — Grain seam, legal.** Bay A1 fine, bay B1 coarse. Fine cell index 2 (the east-edge outer cell) has `sockets.e = 'corridor'`.
Expect zero V2 issues.

**F8 — Grain seam, illegal.** Same setup, but fine cell index 5 (the east-edge middle cell) has `sockets.e = 'corridor'`.
Expect one V2 error. Changing that socket to `window` clears it. Converting bay B1 to `merged` also clears it.

**F9 — Shell dedup.** A single merged bay, heightCells = 2, all sockets solid. Outer volume 13 x 9 x 13 = 1521. Interior 11 x 7 x 11 = 847.
Expect `resolveBlocks` to return exactly 674 entries.

**F10 — Stair continuity.** Level A at y = 24 with a heightCells = 2 cell, `sockets.up = 'shaft'`. Level B at y = 32 with matching `sockets.down = 'shaft'`.
Rise = 8 = 4 \* 2. Expect zero issues. Change level B to y = 36 and expect one V4 error.

\---

## 15\. Open questions

1. **Local-only or shared gallery?** v1 assumes local-only. A gallery pulls in auth, a backend, storage, and moderation. Recommendation: ship v1 local-only, add sharing only if asked for.
2. **Bay field size limits.** Is there a maximum? A 10x10 field at 3 levels is 900 bays, up to 8100 cells — the O(n²) collision check becomes noticeable. Decide whether to cap the field or optimise early. Recommendation: cap at 8x8 in v1 and revisit.
3. **Litematica version compatibility.** The `.litematic` format has changed across Litematica releases. Target the current schema version and state it in the export dialog.
4. **Palette per level vs per bay.** Currently per level with per-cell override. Per-bay override may be wanted for transition bays between styles. Defer until the palette editor lands in v3.
