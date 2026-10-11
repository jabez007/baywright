# Project direction from Minecraft structure grammar

Baywright borrows the assembly rules behind Minecraft structures. It does not copy a Woodland Mansion, Stronghold, Trial Chamber, or Mineshaft. Rooms, passages, levels, and empty positions remain ordinary project data that the editor can validate and export.

This document records which ideas from the original design discussion belong in Baywright and which ideas remain future candidates.

## Adopted ideas

The current editor includes the useful foundations from the discussion:

- The 13×13 structural bay, 7×7 functional room, and 5×5 utility unit share one 12-block pitch.
- Centred 3-block and 5-block openings let adjacent pieces connect without custom geometry.
- Bay patterns cover passages, junctions, feature rooms, infrastructure runs, and exploration pieces such as dead ends, concealed rooms, and compact stairs. **Auto fit** rotates a pattern to match adjacent openings.
- Multi-bay layouts stamp Stronghold loops, grand chambers, library wings, and workshop wings as one undoable edit.
- Multi-level layouts stamp a stair stack, a compact stair, a library with a gallery, an atrium with balconies, and a machinery hall over its service level. They add any level they need.
- Named negative space distinguishes a courtyard, garden, cave, stair shaft, or reserved expansion from an unfinished plan.
- The layered starter project assigns Mansion, Stronghold, Trial Chamber, and Mineshaft roles to separate levels and palettes.
- Merged Arena cells export an exact 7×7 purpose core, a two-block circulation ring, and corner pillars.
- Library cells export wall shelves, a lectern, and a rail around a gallery well.
- Rail Line and Ice Highway cells export a continuous track. Rail lines get support frames, and ice lanes get edge barriers.
- Nether Portal rooms export an unlit obsidian frame, and Super Smelters export a hopper-fed furnace row. The inspector shows where each portal's Nether side goes, and V10 warns when two portal rooms would link to each other's.
- Trading Halls export stall dividers along both side walls around a clear aisle.
- Item Trunks export a hopper chain that runs toward the nearest spine.
- Every room that would have a floor dark enough for mobs to spawn gets its palette light, lowered on a chain in tall rooms, and V9 reports any floor still dark.
- An optional ground surface y lets the materials list count the blocks to dig and what they give back, without modelling terrain.
- The materials list splits by level, and the 3D view shows every placed block with a layer slider that serves as a build guide for players without Litematica.
- **Assemble a base** grows a seeded plan inside a footprint from the same pieces, previews it with the validators' result, and applies it as one undo step.
- Infrastructure modules describe rail lines, ice highways, item trunks, mine access, Nether portals, super smelters, auto crafters, and trading halls.

The architectural influences have distinct jobs:

| Influence | Baywright use |
| --- | --- |
| Woodland Mansion | Purpose-built rooms, wings, and the living-level organization |
| Stronghold | Loops, junctions, stairs, and circulation that does not expose the whole plan at once |
| Trial Chamber | Modular feature rooms, taller spaces, balconies, and machinery volumes |
| Mineshaft | Rail routes, service access, exposed infrastructure, and expansion into caves |

## Keep aesthetics separate from the model

Some ideas are building guidance rather than editor features. Increasing refinement on higher levels, leaving asymmetrical gaps, using exposed rock below finished masonry, and reserving scale breaks for important rooms all improve a Minecraft base. They do not need new project fields.

Add a model feature only when it does at least one of these jobs:

- catches a construction error before the player builds it;
- turns repeated planning work into reusable project intent; or
- improves a derived output such as the plan, block map, material list, or future structure export.

Keep palette recipes, room-dressing advice, and style examples in documentation or catalog data unless the exporter can place them predictably.

## Recommended roadmap

The remaining ideas have value, but they depend on one another. Implement them in this order.

### 1. Multi-level layout patterns

Implemented. A layout placement can sit a multiple of 4 blocks above the anchor level, and the stamp reuses or adds the level at that height.

The first catalog has:

- a two-level library with an open gallery;
- a tall atrium with surrounding balcony access;
- a matched stair stack with valid `up` and `down` shafts; and
- a machinery hall with its service level below it.

Resolve every target level, bay, and cell before changing the project. Reject an out-of-bounds or vertically colliding layout as one atomic edit. A successful stamp must remain one undo step and expand into ordinary schema data.

### 2. Exact detail kits for selected modules

Decoration hints record builder intent. The Arena, Library, Rail Line, Ice Highway, Nether Portal, Super Smelter, Trading Hall, and Item Trunk kits produce exact blocks. Every kit on the list above is in place.

Add exact detail kits where the result has one dependable interpretation:

- Library shelves, lecterns, and gallery rails;
- Rail Line track and supports;
- Ice Highway track and edge protection;
- Item Trunk transport channels;
- Nether Portal frame and clearance;
- Super Smelter furnace rows and feed clearance; and
- Trading Hall stalls and circulation clearance.

Each kit must derive coordinates from `cellInterior` and use the selected palette when a material role applies. Functional Minecraft blocks may use fixed block IDs. Do not turn every decoration hint into geometry merely because the hint exists.

### 3. Expand the bay-pattern catalog

Implemented. Procedural assembly needs more pieces than the original catalog provided. The catalog now has pieces for the exploration qualities described in the original discussion:

- overlooks and balcony landings;
- short dead ends and side chambers;
- concealed-room entrances;
- service junctions;
- cave and mine transitions; and
- compact staircase variants.

Each pattern must rotate through all four orientations and pass the existing opening-compatibility analysis.

### 4. Add route roles only when they support a check

The current module type distinguishes circulation and service rooms. A future route role could distinguish a primary corridor, secondary passage, rail route, item trunk, or maintenance route.

Do not add this field only to color the plan. Add it when Baywright can use it to check route continuity, calculate travel distance, or show a useful route overlay. Route data must not duplicate connections that sockets and modules already describe.

### 5. Add optional procedural assembly

Implemented. **Assemble a base** in the Project menu takes a footprint, a level count, the rooms to place, and a seed. It grows a seeded tree of passages on each level, closes a few loops, and joins the levels with the compact stair layout. It names the bays it skips as negative space and previews the proposal with the ordinary validators' result before anything changes. A requested atrium takes three bays in a row and puts a balcony over each hall on the level above.

Procedural assembly is the last step. The generator should combine the same bay and layout catalogs that manual tools use.

A useful generator would:

- accept a footprint, level range, required rooms, and seed;
- place compatible sockets and route loops;
- preserve or create deliberate negative space;
- use multi-level patterns for stairs and atriums;
- return the same result for the same inputs; and
- preview a complete proposal before it changes the project.

Run the ordinary validators against each proposal. Do not create a second geometry or connection system for generated projects.

## Keep these concerns outside Baywright

The original discussion does not change the established non-goals. Baywright does not need:

- redstone-state or throughput simulation;
- villager, minecart, or mob behavior simulation;
- automatic adaptation to terrain or an existing world save;
- freehand voxel editing; or
- exact replicas of vanilla structures.

Those concerns would turn a modular planning tool into a world editor or game simulator. Baywright should stay focused on spatial intent, validation, reusable structure pieces, and build outputs.
