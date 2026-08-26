import { describe, expect, it } from 'vitest'

import { pngFilename } from '../src/export/png.js'

describe('PNG filenames', () => {
  it('names a level export from the project, level, and floor y', () => {
    expect(pngFilename('North Hall', 'Upper Works', 12)).toBe('north-hall-upper-works-y12.png')
  })

  it('uses readable fallbacks for punctuation-only names', () => {
    expect(pngFilename('***', '???')).toBe('baywright-project-level.png')
  })
})
