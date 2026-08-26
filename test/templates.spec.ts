import { describe, expect, it } from 'vitest'

import { projectFromTemplate, PROJECT_TEMPLATE_LIST } from '../src/domain/templates.js'
import { validate } from '../src/domain/validate.js'

function ids(): () => string {
  let next = 0
  return () => `id-${next++}`
}

describe('project templates', () => {
  it('builds the sparse four-level 5×5 example as ordinary schema-v1 data', () => {
    const project = projectFromTemplate('layered-base', ids())

    expect(project).toMatchObject({
      schemaVersion: 1,
      id: 'id-0',
      name: 'Layered base example',
      bayCols: 5,
      bayRows: 5,
    })
    expect(project.levels.map((level) => [level.name, level.y, level.paletteId])).toEqual([
      ['Mineshaft infrastructure', -4, 'mineshaft-oak'],
      ['Trial machinery', 0, 'tuff-copper'],
      ['Stronghold core', 12, 'stone-brick'],
      ['Mansion living', 20, 'dark-oak'],
    ])
    expect(project.levels.map((level) => Object.keys(level.bays).length)).toEqual([7, 5, 9, 9])
    expect(new Set([project.id, ...project.levels.map((level) => level.id)]).size).toBe(5)
  })

  it('uses rotated patterns and leaves deliberate negative space', () => {
    const project = projectFromTemplate('layered-base', ids())
    const core = project.levels[2]!

    expect(core.bays['C1']!.cells[0]!.sockets.s).toBe('arch')
    expect(core.bays['C1']!.cells[0]!.sockets.w).toBe('solid')
    expect(core.bays['B2']).toBeUndefined()
  })

  it('uses rail modules on the mineshaft infrastructure line', () => {
    const project = projectFromTemplate('layered-base', ids())
    const infrastructure = project.levels[0]!

    expect(infrastructure.bays['A5']!.cells[4]!.module).toBe('rail-line')
    expect(infrastructure.bays['E5']!.cells[4]!.module).toBe('rail-line')
  })

  it('does not introduce vertical collisions', () => {
    const project = projectFromTemplate('layered-base', ids())
    expect(validate(project).filter((issue) => issue.id === 'V1')).toEqual([])
  })

  it('lists the template offered by the new-project dialog', () => {
    expect(PROJECT_TEMPLATE_LIST.map((template) => template.id)).toEqual(['layered-base'])
  })
})
