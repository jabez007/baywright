# Baywright

Baywright is a browser-based floor-plan editor for modular Minecraft bases. Its shared-wall grid combines 13×13 structural bays, 7×7 rooms, and 5×5 utility units. The current code includes the v1 multi-level editor and ten domain validators. See [the product requirements](.docs/PRD-bay-blueprint-editor.md) for the geometry and validation rules. See [the project direction](.docs/PROJECT-DIRECTION.md) for the adopted structure grammar and the ordered roadmap.

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
- vertical collisions, grain seams, room connectivity, stair continuity, plenum reachability, level alignment, merge-group validation, overworld build limits, dark floors where mobs can spawn, and Nether portal links;
- block deduplication, material totals, raw-input rollups, and smelting estimates; and
- the shipped module presets and palettes.

The v1 editor provides:

- multi-level plans with level gaps, custom footprints, named negative space, and fields up to 8 by 8 bays;
- bay and cell views, plus Footprint and Space tools on an SVG plan;
- a 3D view of every placed block, with a layer slider that works as a build guide;
- module painting, connection-aware bay stamps, rotatable multi-bay layouts, seeded base assembly with a preview, grain changes, merge groups, cell heights, ceilings, sockets, centred opening widths, notes, and palette overrides;
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

Merged Arena cells apply the system inside the bay: a trim outline marks the centred 7×7 purpose core, leaving a two-block circulation ring in the 11×11 interior. When the palette's trim is a stair, every trim stair faces the core, so its step rises along the core's edge, and the corners take the outer corner shape. Four palette-resolved pillars are included in exported blocks and material totals.

A coarse or merged Library lines its walls with bookshelves three high and stands a lectern in the middle, facing the first doorway. A library cell that is the well of a merged gallery gets a one-high rail around its rim in the palette's accent block. A Rail Line lays rails down its middle, and one support frame per cell stands halfway along: two accent posts and a beam in the floor block. An Ice Highway sets a blue ice lane into its floor between two one-high accent barriers. Both routes continue through every open seam, so neighbouring cells join into one track. A Nether Portal room at least five blocks wide and high gets a 5×5 obsidian frame without corners, standing across the room so you walk straight in from the entrance. Light it yourself. A Super Smelter at least four blocks high backs a row of furnaces onto the wall opposite its entrance. Each furnace has an input hopper above, an output hopper below, and a fuel hopper in front, with open space above the input hoppers for whatever feeds them. A Trading Hall at least five blocks wide gets one-wide stalls along both walls that run away from the entrance, separated by two-high accent dividers two blocks deep, with a clear aisle between. Each stall holds a villager at the back and its workstation in front, which you choose. An Item Trunk on an unbroken line of trunk cells to a spine gets a hopper chain on its plenum floor, pointing toward the spine and turning corners at cell centres. A trunk with no such line gets no hoppers, so join it to a spine first. A Workshop gets an enchanting table in the middle with the 15 bookshelves that level 30 enchantments need, two blocks out. The ring between them stays clear at both heights, which works under both the Java and Bedrock rules, and the shelf spot facing the door is the way in. In a 5-wide room the ring is the room's edge, so shelves that would block a doorway move up a layer at the back. A room whose doorways leave too few places for all 15 gets no table, which rules out the Workshop bay pattern's full-width doorways. A merged Workshop also gets a crafting table, smithing table, anvil, grindstone, and stonecutter along the back wall. Kits never place a block in front of a doorway, window, or bars.

A Stair room with a shaft up gets something to climb. A room at least 11 wide, or a 5-wide room with a solid floor, gets a spiral of the palette's trim stairs that winds clockwise around a 3×3 pillar, with 3 blocks of headroom over every step. Stairs stacked in one bay join into one spiral. A 3-wide room, or a 5-wide room whose floor is itself a shaft, gets a ladder on the wall facing its entrance instead. The landing above opens only the stairwell, and the rest of its floor keeps the landing level's palette. V4 reports a stairwell that comes up under a landing cell with no shaft down, where the climb would hit a solid floor.

Since 1.18, hostile mobs spawn on any floor with a block light of 0, so every room that would have such a floor gets its palette light hung under the ceiling, near the centre. A room two or more cells tall lowers the light on a chain to 3 blocks above the floor, which lights the corners of an 11×11 room. A room that is still dark gets more lights over its dark floor, up to four, and no light ever hangs over a stair or ladder. A shaft that opens a whole room has no ceiling, so its light hangs in the room above. One light often reaches the floors of the rooms next to it, and then they get none of their own. Plenums above dropped ceilings get lights too. The Tuff & Copper palette uses a waxed, lit copper bulb. A copper bulb you place by hand starts unlit, so give it one redstone pulse. V9 warns about any floor still dark, and names the palette light when it gives no light at all.

Select a Nether Portal room and the inspector shows two blocks: the bottom middle of its opening, and the same spot for its Nether side. The Nether side has the Overworld x and z divided by 8, and the same y, kept between y 33 and 119 so the frame clears the lava sea and the bedrock roof. Build the same frame there, facing the same way, and each portal leads to the other. V10 warns when two portal rooms would need overlapping Nether portals, or when stepping back through one could come out at another room. Bays three apart are safe on one level. Baywright can't see portals elsewhere in your world, so keep other portals well clear.

Choose **3D** in the View group to see every block the plan places, coloured roughly like its texture. Drag to turn the view, right-drag to pan, and scroll or pinch to zoom. Click a block to see its ID and world position. Move the **Layer** slider down to build one layer at a time. Layers above disappear, layers below fade, and the guide lists the chosen layer's blocks with the x and z it covers. **Top** looks straight down with north at the top, so the layer reads like a grid to copy block by block. This works on a phone next to the game, and it's how to follow a plan without Litematica.

The materials panel covers the whole base until you pick a level under **Materials for**. It then lists only that level's placed blocks, raw inputs, and furnace time, so you can gather for one level at a time. A floor that is also the roof of the level below counts with the lower level, since you build it to close that level in. Each level rounds its logs and slabs up on its own, so the levels' raw inputs can add up to a few more than the whole base's.

Set **Ground surface y** in the inspector's Project section to the y of the top ground block where you'll build, such as the grass. The materials panel then shows how many blocks you'll dig out, level by level, and marks each level as underground, partly underground, or above ground. It digs out every built cell whole, walls included, because the plan places its own walls. It also estimates what the digging gives back. The top 4 blocks count as dirt, the rest as cobblestone, and anything below y 0 as cobbled deepslate. Ores, caves, and water will change the real numbers. Leave the field blank when the whole base stands above ground.

Infrastructure planning uses ordinary modules rather than a separate simulator. Rail lines, ice highways, item trunks, mine access, Nether portals, super smelters, auto crafters, and trading halls carry useful height, socket, palette, and detailing intent. Transport and item-trunk bay patterns make the straight runs reusable; the layered example uses rail-line bays on its lowest level. Its stairs join all four levels to a spine, so it passes every check. Throughput, redstone state, and entity behavior remain outside Baywright's scope.

The app has two routes: `/` and `/project/:id/level/:levelId`. The root route restores the last valid local project and then changes to its project and level URL. These URLs identify local IndexedDB records. They are not share links.

JSON export writes the complete project document. JSON import checks the schema, field bounds, cells, sockets, opening widths, ceilings, negative-space annotations, and palette references, then saves the import as a new local project. Projects without opening widths retain full-width passages. Legacy schema-v1 height-3 plenums retain their original geometry; height-1 dropped flags normalize to `flat` because they never affected blocks. PNG export downloads one rendered plan for each level.

Litematica export writes the built blocks as one region in a `.litematic` schematic for Minecraft 1.21.1 and later, using schema version 6 and data version 3955. Set the world coordinates of bay A1 in the inspector before exporting. After the download, the app shows where to place the schematic origin in your world. Room interiors and unbuilt cells inside the region are stored as air, so the overlay flags any existing blocks there.

## Local persistence

Baywright stores projects only in the current browser profile through IndexedDB. It has no account, server, cloud sync, or cross-device recovery.

Autosave waits one second after an edit and serializes writes so an older save cannot finish last. Startup skips invalid records and tries the newest valid saved project. Imports also enforce the 8 by 8 field limit and the other structural checks.

When the page becomes hidden or starts to unload, Baywright starts any pending write without waiting for the debounce. A browser can still close the page before IndexedDB commits that write. Use JSON export for backups that must survive browser data loss or a missed final save.

## Controls

- Select is the default tool. Click a bay or cell to inspect it without changing the plan. Drag across cells to select a range.
- Double-click a bay to open its cells. Use the **Bays** and **Cells** controls to change views directly.
- Choose **Paint** and a module to paint bays or cells. Drag with a mouse, touch, or pen to paint several targets.
- Choose **Stamp** and a bay pattern to replace whole bays with reusable layouts. **Auto fit** rotates each stamp to match openings in adjacent bays; fixed rotations remain available when the plan calls for a specific orientation. Besides passages, junctions, and feature rooms, the catalog has exploration pieces: a balcony landing, a dead end, a side chamber, a concealed room behind an arch you hide in the build, a service junction for item trunks, a mine head, a cave mouth, and a compact stair with its matching landing. The Compact stair layout stamps the stair and its landing 8 blocks up in one step.
- Choose **Layout** to stamp a Stronghold loop, grand chamber, library wing, or workshop wing from a north-west anchor. Layouts may fill absent footprint slots, and the whole placement is one undo step.
- Some layouts build on more than one level, and the picker shows how many. A stair stack, compact stair, library gallery, atrium, or machinery hall uses a level that already sits at the right height, or adds one. If any part would hit a room on another level, nothing is stamped.
- Choose **Empty** to clear bays or cells. Clearing a bay preserves its grain. Empty cells are unbuilt: they place no blocks, cost nothing in the materials list, and take no part in the checks.
- Choose **Footprint** to add or remove bays. Drag to change several bays.
- Choose **Space** to name absent bays as courtyards, gardens, caves, stair shafts, or reserved expansion. Building a bay in that slot clears the name.
- Choose **Assemble a base** from the **Project** menu to generate a plan inside a footprint. Set the footprint, up to four levels, the rooms you want, and a seed. The dialog draws every level and reports what the validators find before anything changes. **Apply** writes that plan as one undo step, and the same seed on the same project always gives the same plan. Levels sit 8 blocks apart, joined by compact stairs. An atrium takes three bays in a row and the level above them, so it needs at least two levels. Upper levels build only over bays the level below builds. The bays the routes skip become named courtyards, or reserved expansion over a built bay, and any negative space you already named inside the footprint stays.
- Edit the level's palette in the inspector's **Palette blocks** fields. Edits apply everywhere that palette is used, so choose **Copy palette for this level** first to change only one level. Block IDs use `/setblock` syntax, such as `deepslate_bricks` or `minecraft:lantern[hanging=true]`.
- Edit the project name and the world x and z of bay A1 in the inspector's **Project** fields. Exports use these coordinates.
- Choose **Export Litematica** from the **Project** menu to download an in-game schematic.
- Choose **New project** from the **Project** menu to start blank or load the layered base example.
- Use the **Skip to plan** link or press `Tab` to enter the plan. Use the arrow keys to move between targets. Press `Enter` or `Space` to apply the active tool.
- Select one cell and choose **Add stair to the level above** to make a matched stair. The cell becomes as tall as the rise to the next level, which must be 4, 8, or 12 blocks, and that level gets a landing with a shaft down.
- Shift-drag cells to make a rectangular merge group.
- Alt-click a cell edge to cycle its horizontal socket.
- Press `[` or `]` to change the selected cells' height.
- Press Ctrl/Cmd+Z to undo and Ctrl/Cmd+Shift+Z to redo.
- Press `Escape` to clear the selection.

The inspector also exposes module, merge, height, ceiling, socket, and opening-width controls without modifier keys. On narrow screens, it opens as a sheet over the bottom of the plan.

## Tests and CI

Vitest covers geometry, every validator, the BOM and recipes, modules, the project store, JSON, PNG, and Litematica exports, IndexedDB recovery, and autosave behavior. Playwright checks editing and reload, one-bay issue navigation, roving SVG focus, PNG state restoration, Litematica download, project Back/Forward routes, and narrow or short viewports.

GitHub Actions runs on pushes and pull requests. It installs with `npm ci`, runs ESLint, the unit tests, and the production build, audits production dependencies, installs Chromium, and runs the Playwright suite.

## Not implemented

The [project direction](.docs/PROJECT-DIRECTION.md) explains which design candidates come next and why.

- vanilla structure NBT export
- 3D preview
- additional style-specific module and palette content
- project sharing or cloud sync
