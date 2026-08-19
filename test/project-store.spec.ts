/**
 * PRD §12 — the project store, and §10's undo ring buffer.
 */
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { HISTORY_LIMIT, createProject, useProjectStore } from '../src/stores/project.js'
import { toRaw } from 'vue'
import type { CellRef } from '../src/domain/types.js'

function store() {
  return useProjectStore()
}

/** Cell 0 of bay A1 on the current level. */
function firstCell(): CellRef {
  const s = store()
  return { levelId: s.currentLevelId, bayKey: 'A1', cellIndex: 0 }
}

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('a new project', () => {
  it('starts as one ground level of empty fine bays', () => {
    const s = store()
    expect(s.project.schemaVersion).toBe(1)
    expect(s.project.levels).toHaveLength(1)
    expect(s.project.levels[0]!.y).toBe(0)
    expect(Object.keys(s.project.levels[0]!.bays).sort()).toEqual(['A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3'])
    expect(s.project.levels[0]!.bays['A1']!.cells).toHaveLength(9)
    expect(s.project.levels[0]!.bays['A1']!.cells[0]!.module).toBe('empty')
  })

  it('selects the ground level and nothing else', () => {
    const s = store()
    expect(s.currentLevelId).toBe(s.project.levels[0]!.id)
    expect(s.selection).toEqual({ kind: 'none' })
    expect(s.canUndo).toBe(false)
  })
})

describe('the undo ring buffer', () => {
  it('restores the document a mutation changed', () => {
    const s = store()
    s.paintCell(firstCell(), 'spine')
    expect(s.project.levels[0]!.bays['A1']!.cells[0]!.module).toBe('spine')
    expect(s.canUndo).toBe(true)

    expect(s.undo()).toBe(true)
    expect(s.project.levels[0]!.bays['A1']!.cells[0]!.module).toBe('empty')
    expect(s.canUndo).toBe(false)
    expect(s.canRedo).toBe(true)
  })

  it('reapplies on redo', () => {
    const s = store()
    s.paintCell(firstCell(), 'library')
    s.undo()
    expect(s.redo()).toBe(true)
    expect(s.project.levels[0]!.bays['A1']!.cells[0]!.module).toBe('library')
    expect(s.canRedo).toBe(false)
  })

  it('returns false with nothing to undo or redo', () => {
    const s = store()
    expect(s.undo()).toBe(false)
    expect(s.redo()).toBe(false)
  })

  it('drops the redo branch once a new mutation lands', () => {
    const s = store()
    s.paintCell(firstCell(), 'storage')
    s.undo()
    expect(s.canRedo).toBe(true)
    s.paintCell(firstCell(), 'workshop')
    expect(s.canRedo).toBe(false)
  })

  it('keeps 50 snapshots and no more', () => {
    const s = store()
    for (let i = 0; i < HISTORY_LIMIT + 10; i++) s.renameProject(`take ${i}`)
    expect(s.undoDepth).toBe(HISTORY_LIMIT)

    let undone = 0
    while (s.undo()) undone++
    expect(undone).toBe(HISTORY_LIMIT)
    // Snapshots hold the state *before* each mutation, so after 60 mutations
    // the oldest of the 50 kept is the state before mutation 10 — 'take 9'.
    // The ten before that aged out of the ring.
    expect(s.project.name).toBe('take 9')
  })

  it('snapshots deeply — later edits do not reach back into history', () => {
    const s = store()
    s.setCellHeight([firstCell()], 3)
    s.setCeiling([firstCell()], 'vaulted')
    s.undo()
    expect(s.project.levels[0]!.bays['A1']!.cells[0]!.ceiling).toBe('flat')
    expect(s.project.levels[0]!.bays['A1']!.cells[0]!.heightCells).toBe(3)
  })

  it('costs one step per multi-cell action, not one per cell', () => {
    const s = store()
    const refs = [0, 1, 2].map((cellIndex) => ({ ...firstCell(), cellIndex }))
    s.paintCells(refs, 'corridor')
    expect(s.undoDepth).toBe(1)

    s.undo()
    for (const ref of refs) {
      expect(s.project.levels[0]!.bays['A1']!.cells[ref.cellIndex]!.module).toBe('empty')
    }
  })

  it('costs one step for a whole batched gesture', () => {
    const s = store()
    s.batch(() => {
      s.paintCell(firstCell(), 'corridor')
      s.setCellHeight([firstCell()], 2)
      s.cycleSocket(firstCell(), 'e')
    })
    expect(s.undoDepth).toBe(1)
    s.undo()
    expect(s.project.levels[0]!.bays['A1']!.cells[0]!.module).toBe('empty')
    expect(s.project.levels[0]!.bays['A1']!.cells[0]!.heightCells).toBe(1)
  })

  it('leaves no trace when an action throws', () => {
    const s = store()
    const levelId = s.currentLevelId
    expect(() => s.setLevelY(levelId, 18)).toThrow(/multiple of 4/)
    expect(s.project.levels[0]!.y).toBe(0)
    expect(s.canUndo).toBe(false)
  })

  it('rolls back a partly applied action', () => {
    const s = store()
    const good = firstCell()
    const missing: CellRef = { ...good, cellIndex: 99 }
    expect(() => s.setCellHeight([good, missing], 3)).toThrow()
    expect(s.project.levels[0]!.bays['A1']!.cells[0]!.heightCells).toBe(1)
    expect(s.canUndo).toBe(false)
  })

  it('does not record selection or navigation', () => {
    const s = store()
    s.selectCells([firstCell()])
    s.setCurrentLevel(s.currentLevelId)
    expect(s.canUndo).toBe(false)
  })

  it('starts clean after loading a document', () => {
    const s = store()
    s.paintCell(firstCell(), 'spine')
    s.loadProject(createProject({ name: 'Fresh' }))
    expect(s.canUndo).toBe(false)
    expect(s.project.name).toBe('Fresh')
  })
})

describe('levels', () => {
  it('keeps levels sorted ascending by y', () => {
    const s = store()
    s.addLevel(16, 'Attic')
    s.addLevel(8, 'Upper')
    expect(s.project.levels.map((level) => level.y)).toEqual([0, 8, 16])
  })

  it('runs the rail highest first', () => {
    const s = store()
    s.addLevel(8, 'Upper')
    expect(s.levelsDescending.map((level) => level.y)).toEqual([8, 0])
  })

  it('reports the gap between rail entries and the headroom left in it', () => {
    const s = store()
    s.addLevel(8, 'Upper')
    s.setCellHeight([firstCell()], 3) // 12 blocks tall under an 8-block gap
    expect(s.levelGaps).toHaveLength(1)
    expect(s.levelGaps[0]!.delta).toBe(8)
    expect(s.levelGaps[0]!.headroom).toBe(-4)
  })

  it('stacks a new level on the footprint of the one below', () => {
    const s = store()
    const ground = s.currentLevelId
    s.batch(() => {
      s.removeBay(ground, 'B2')
      s.removeBay(ground, 'C2')
    })
    s.setBayGrain(ground, 'A1', 'coarse')

    const upper = s.addLevel(8, 'Upper')
    const level = s.project.levels.find((entry) => entry.id === upper)!
    expect(Object.keys(level.bays).sort()).toEqual(['A1', 'A2', 'A3', 'B1', 'B3', 'C1', 'C3'])
    expect(level.bays['A1']!.grain).toBe('coarse')
    expect(level.bays['A1']!.cells.every((cell) => cell.module === 'empty')).toBe(true)
  })

  it('refuses a y off the 4-block lattice', () => {
    const s = store()
    expect(() => s.addLevel(6)).toThrow(/multiple of 4/)
    expect(() => s.setLevelY(s.currentLevelId, 4.5)).toThrow(/multiple of 4/)
  })

  it('refuses to stack two levels on the same y', () => {
    const s = store()
    s.addLevel(8)
    expect(() => s.addLevel(8)).toThrow(/already sits at y 8/)
  })

  it('moves the current level when the one you were on is removed', () => {
    const s = store()
    const upper = s.addLevel(8)
    s.setCurrentLevel(upper)
    s.removeLevel(upper)
    expect(s.project.levels).toHaveLength(1)
    expect(s.currentLevelId).toBe(s.project.levels[0]!.id)
  })

  it('restores the current level and selection when undo brings a level back', () => {
    const s = store()
    const upper = s.addLevel(8)
    s.setCurrentLevel(upper)
    s.selectCells([{ levelId: upper, bayKey: 'A1', cellIndex: 0 }])
    s.removeLevel(upper)
    expect(s.selection).toEqual({ kind: 'none' })
    s.undo()
    expect(s.project.levels).toHaveLength(2)
  })

  it('keeps the raw document free of reactive proxies after a removal', () => {
    // Assigning a read-derived array back into state would leave proxies in the
    // raw tree and break structuredClone — the fast path in `snapshot`.
    const s = store()
    s.removeLevel(s.addLevel(8))
    expect(() => structuredClone(toRaw(s.project))).not.toThrow()
  })
})

describe('bays', () => {
  it('re-cuts the cells when the grain changes', () => {
    const s = store()
    s.setBayGrain(s.currentLevelId, 'B2', 'coarse')
    expect(s.project.levels[0]!.bays['B2']!.cells).toHaveLength(4)
    s.setBayGrain(s.currentLevelId, 'B2', 'merged')
    expect(s.project.levels[0]!.bays['B2']!.cells).toHaveLength(1)
  })

  it('keeps the module of a uniformly painted bay across a re-cut', () => {
    const s = store()
    const levelId = s.currentLevelId
    s.paintBay(levelId, 'B2', 'storage', 'fine')
    s.setBayGrain(levelId, 'B2', 'coarse')
    expect(s.project.levels[0]!.bays['B2']!.cells.map((cell) => cell.module)).toEqual([
      'storage',
      'storage',
      'storage',
      'storage',
    ])
  })

  it('falls back to empty when the bay was painted several ways', () => {
    const s = store()
    const levelId = s.currentLevelId
    s.paintCell({ levelId, bayKey: 'B2', cellIndex: 0 }, 'storage')
    s.setBayGrain(levelId, 'B2', 'coarse')
    expect(s.project.levels[0]!.bays['B2']!.cells[0]!.module).toBe('empty')
  })

  it('takes the grain a module suggests when bay-painting (§10)', () => {
    const s = store()
    s.paintBay(s.currentLevelId, 'B2', 'vestibule')
    expect(s.project.levels[0]!.bays['B2']!.grain).toBe('merged')
    expect(s.project.levels[0]!.bays['B2']!.cells).toHaveLength(1)
  })
})

describe('cells', () => {
  it('paints the module preset onto the cell', () => {
    const s = store()
    s.paintCell(firstCell(), 'spine')
    const cell = s.project.levels[0]!.bays['A1']!.cells[0]!
    expect(cell.heightCells).toBe(2)
    expect(cell.ceiling).toBe('dropped')
    expect(cell.sockets.n).toBe('corridor')
  })

  it('carries the note and merge group across a repaint', () => {
    const s = store()
    const ref = firstCell()
    s.setNote(ref, 'under the stair')
    const groupId = s.mergeCells([ref])
    s.paintCell(ref, 'library')
    const cell = s.project.levels[0]!.bays['A1']!.cells[0]!
    expect(cell.note).toBe('under the stair')
    expect(cell.mergeGroup).toBe(groupId)
  })

  it('gives each painted cell its own sockets', () => {
    const s = store()
    const refs = [0, 1].map((cellIndex) => ({ ...firstCell(), cellIndex }))
    s.paintCells(refs, 'corridor')
    s.setSocket(refs[0]!, 'e', 'arch')
    expect(s.project.levels[0]!.bays['A1']!.cells[1]!.sockets.e).toBe('solid')
  })

  it('clamps [ and ] to 1..3 cells', () => {
    const s = store()
    const ref = firstCell()
    s.nudgeCellHeight([ref], -1)
    expect(s.project.levels[0]!.bays['A1']!.cells[0]!.heightCells).toBe(1)
    for (let i = 0; i < 5; i++) s.nudgeCellHeight([ref], 1)
    expect(s.project.levels[0]!.bays['A1']!.cells[0]!.heightCells).toBe(3)
  })

  it('cycles a horizontal face through the openings', () => {
    const s = store()
    const ref = firstCell()
    expect(s.cycleSocket(ref, 'e')).toBe('corridor')
    expect(s.cycleSocket(ref, 'e')).toBe('arch')
    expect(s.cycleSocket(ref, 'e')).toBe('window')
    expect(s.cycleSocket(ref, 'e')).toBe('bars')
    expect(s.cycleSocket(ref, 'e')).toBe('solid')
  })

  it('cycles a vertical face between solid and shaft only (§5.4)', () => {
    const s = store()
    const ref = firstCell()
    expect(s.cycleSocket(ref, 'up')).toBe('shaft')
    expect(s.cycleSocket(ref, 'up')).toBe('solid')
  })

  it('gives one merge group to a whole rectangle, and takes it away again', () => {
    const s = store()
    const refs = [0, 1, 3, 4].map((cellIndex) => ({ ...firstCell(), cellIndex }))
    const groupId = s.mergeCells(refs)
    for (const ref of refs) {
      expect(s.project.levels[0]!.bays['A1']!.cells[ref.cellIndex]!.mergeGroup).toBe(groupId)
    }
    s.splitCells(refs)
    expect(s.project.levels[0]!.bays['A1']!.cells[0]!.mergeGroup).toBeUndefined()
  })

  it('drops an empty note rather than storing one', () => {
    const s = store()
    const ref = firstCell()
    s.setNote(ref, 'temp')
    s.setNote(ref, '')
    expect(s.project.levels[0]!.bays['A1']!.cells[0]!.note).toBeUndefined()
  })

  it('refuses a palette that is not in the project', () => {
    const s = store()
    expect(() => s.setPaletteOverride(firstCell(), 'obsidian-and-regret')).toThrow(/no palette/)
  })
})

describe('validation wiring', () => {
  it('surfaces issues from the live document', () => {
    const s = store()
    const ground = s.currentLevelId
    const upper = s.addLevel(8)
    s.setBayGrain(ground, 'A1', 'merged')
    s.setBayGrain(upper, 'A1', 'merged')
    s.setCellHeight([{ levelId: ground, bayKey: 'A1', cellIndex: 0 }], 3)

    const collisions = s.issues.filter((issue) => issue.id === 'V1')
    expect(collisions).toHaveLength(1)
    expect(s.issuesByLevel[ground]).toHaveLength(1)
    expect(s.issuesByLevel[upper]).toHaveLength(1)
  })

  it('clears the issue when the mistake is undone', () => {
    const s = store()
    const ground = s.currentLevelId
    s.addLevel(8)
    s.setCellHeight([{ levelId: ground, bayKey: 'A1', cellIndex: 0 }], 3)
    expect(s.issues.filter((issue) => issue.id === 'V1').length).toBeGreaterThan(0)
    s.undo()
    expect(s.issues.filter((issue) => issue.id === 'V1')).toHaveLength(0)
  })
})

describe('toJSON', () => {
  it('hands back a detached plain copy', () => {
    const s = store()
    const copy = s.toJSON()
    s.paintCell(firstCell(), 'spine')
    expect(copy.levels[0]!.bays['A1']!.cells[0]!.module).toBe('empty')
    expect(JSON.parse(JSON.stringify(copy)).schemaVersion).toBe(1)
  })
})

/**
 * §6 stores bays in a map, not a dense grid, so a level's footprint need not
 * fill its field: an I, H or C plan is a field with bays taken out of it.
 */
describe('the footprint', () => {
  it('removes a bay from the level', () => {
    const s = store()
    s.removeBay(s.currentLevelId, 'B2')
    expect(s.project.levels[0]!.bays['B2']).toBeUndefined()
    expect(Object.keys(s.project.levels[0]!.bays)).toHaveLength(8)
  })

  it('puts a bay back, empty and at the requested grain', () => {
    const s = store()
    const levelId = s.currentLevelId
    s.paintBay(levelId, 'B2', 'storage')
    s.removeBay(levelId, 'B2')
    s.addBay(levelId, 'B2', 'coarse')
    const bay = s.project.levels[0]!.bays['B2']!
    expect(bay.grain).toBe('coarse')
    expect(bay.cells).toHaveLength(4)
    expect(bay.cells.every((cell) => cell.module === 'empty')).toBe(true)
  })

  it('toggles a bay in and out', () => {
    const s = store()
    const levelId = s.currentLevelId
    expect(s.toggleBay(levelId, 'A1')).toBe(false)
    expect(s.project.levels[0]!.bays['A1']).toBeUndefined()
    expect(s.toggleBay(levelId, 'A1')).toBe(true)
    expect(s.project.levels[0]!.bays['A1']).toBeDefined()
  })

  it('carves a C without disturbing the rest of the level', () => {
    const s = store()
    const levelId = s.currentLevelId
    s.batch(() => {
      s.removeBay(levelId, 'B2')
      s.removeBay(levelId, 'C2')
    })
    expect(Object.keys(s.project.levels[0]!.bays).sort()).toEqual(['A1', 'A2', 'A3', 'B1', 'B3', 'C1', 'C3'])
    expect(s.canUndo).toBe(true)
    s.undo()
    expect(Object.keys(s.project.levels[0]!.bays)).toHaveLength(9)
  })

  it('refuses a bay outside the field', () => {
    const s = store()
    expect(() => s.addBay(s.currentLevelId, 'D1')).toThrow(/outside the 3×3 field/)
    expect(() => s.addBay(s.currentLevelId, 'A4')).toThrow(/outside the 3×3 field/)
  })

  it('refuses to empty a level', () => {
    const s = store()
    const levelId = s.currentLevelId
    s.batch(() => {
      for (const bayKey of Object.keys(s.project.levels[0]!.bays)) {
        if (bayKey !== 'A1') s.removeBay(levelId, bayKey)
      }
    })
    expect(() => s.removeBay(levelId, 'A1')).toThrow(/last bay/)
    expect(s.project.levels[0]!.bays['A1']).toBeDefined()
  })

  it('drops a selection that pointed into the removed bay', () => {
    const s = store()
    const levelId = s.currentLevelId
    s.select({ kind: 'bay', levelId, bayKey: 'B2' })
    s.removeBay(levelId, 'B2')
    expect(s.selection).toEqual({ kind: 'none' })
  })

  it('leaves an unrelated selection alone', () => {
    const s = store()
    const levelId = s.currentLevelId
    s.selectCells([{ levelId, bayKey: 'A1', cellIndex: 0 }])
    s.removeBay(levelId, 'B2')
    expect(s.selection.kind).toBe('cells')
  })

  it('adding a bay that is already there changes nothing', () => {
    const s = store()
    const levelId = s.currentLevelId
    s.paintBay(levelId, 'B2', 'storage')
    s.addBay(levelId, 'B2', 'merged')
    expect(s.project.levels[0]!.bays['B2']!.cells[0]!.module).toBe('storage')
  })
})

/** PRD §15 open question 2 — the field is capped while V1 is still O(n²). */
describe('the bay field cap', () => {
  it('accepts a field up to 8x8', () => {
    expect(Object.keys(createProject({ bayCols: 8, bayRows: 8 }).levels[0]!.bays)).toHaveLength(64)
  })

  it('rejects a field wider than the cap', () => {
    expect(() => createProject({ bayCols: 9 })).toThrow(/bayCols must be an integer between 1 and 8/)
  })

  it('rejects a field taller than the cap', () => {
    expect(() => createProject({ bayRows: 12 })).toThrow(/bayRows must be an integer between 1 and 8/)
  })

  it('rejects a non-integer or empty field', () => {
    expect(() => createProject({ bayCols: 2.5 })).toThrow(RangeError)
    expect(() => createProject({ bayRows: 0 })).toThrow(RangeError)
  })
})
