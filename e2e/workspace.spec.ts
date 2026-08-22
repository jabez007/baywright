import { expect, test, type Page } from '@playwright/test'

import type { Project } from '../src/domain/types.js'

interface StoredProjectRecord {
  id: string
  name: string
  updatedAt: number
  document: Project
}

async function useCellTool(page: Page, tool: 'Select' | 'Paint' = 'Select'): Promise<void> {
  await page.getByRole('button', { name: 'Cells', exact: true }).click()
  await page.getByRole('button', { name: tool, exact: true }).click()
}

async function paintSpineCells(page: Page): Promise<void> {
  await useCellTool(page, 'Paint')
  await page.getByLabel('Module', { exact: true }).selectOption('spine')
}

async function pushRoute(page: Page, path: string): Promise<void> {
  await page.evaluate((nextPath) => {
    const previous = history.state as { current?: string; position?: number } | null
    history.pushState(
      {
        back: previous?.current ?? location.pathname,
        current: nextPath,
        forward: null,
        replaced: false,
        position: (previous?.position ?? history.length - 1) + 1,
        scroll: null,
      },
      '',
      nextPath,
    )
    window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }))
  }, path)
}

test('paints and restores a Spine cell at the canonical route', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('complementary', { name: 'Levels' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Plan canvas' })).toBeVisible()
  await expect(page.getByRole('complementary', { name: 'Inspector' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Project output' })).toBeVisible()

  await paintSpineCells(page)
  await page.getByRole('button', { name: /^A1 cell 1 · Empty/ }).click()
  await expect(page.getByRole('button', { name: /^A1 cell 1 · Spine/ })).toBeVisible()
  await expect(page.getByRole('status')).toHaveAccessibleName('Autosave status: Saved')
  await expect(page).toHaveURL(/\/project\/[^/]+\/level\/[^/?#]+$/)

  const canonicalUrl = page.url()
  await page.reload()

  await expect(page).toHaveURL(canonicalUrl)
  await useCellTool(page)
  await expect(page.getByRole('button', { name: /^A1 cell 1 · Spine/ })).toBeVisible()
})

test('keeps the plan usable without document overflow at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')

  const plan = page.getByRole('group', { name: 'Floor plan editor' })
  await expect(plan).toBeVisible()
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

  const bounds = await plan.boundingBox()
  expect(bounds?.width).toBeGreaterThan(300)
  expect(bounds?.height).toBeGreaterThan(300)

  await paintSpineCells(page)
  await expect(page.locator('.inspector')).toHaveAttribute('inert', '')
  const firstCell = page.getByRole('button', { name: /^A1 cell 1 · Empty/ })
  await firstCell.focus()
  await page.keyboard.press('Enter')
  const paintedCell = page.getByRole('button', { name: /^A1 cell 1 · Spine/ })
  await expect(paintedCell).toBeVisible()
  await expect(page.locator('.inspector')).not.toHaveAttribute('inert', '')
  await expect(page.getByRole('button', { name: 'Close inspector' })).toBeFocused()

  await page.keyboard.press('Escape')
  await expect(page.locator('.inspector')).toHaveAttribute('inert', '')
  await expect(paintedCell).toBeFocused()

  await page.keyboard.press('Escape')
  await expect(page.locator('.selection-overlay')).toHaveCount(0)
  await expect(page.locator('.inspector')).toHaveAttribute('inert', '')
})

test('uses one roving tab stop for plan targets', async ({ page }) => {
  await page.goto('/')
  await useCellTool(page)

  const targets = page.locator('[data-plan-target]')
  await expect(targets).toHaveCount(9)
  await expect(page.locator('[data-plan-target][tabindex="0"]')).toHaveCount(1)
  await expect(page.locator('[data-plan-target][tabindex="-1"]')).toHaveCount(8)

  const first = page.getByRole('button', { name: /^A1 cell 1 · Empty/ })
  const second = page.getByRole('button', { name: /^A1 cell 2 · Empty/ })
  await page.getByRole('link', { name: 'Skip to plan' }).focus()
  await page.keyboard.press('Enter')
  await expect(first).toBeFocused()
  await first.focus()
  await page.keyboard.press('ArrowRight')
  await expect(second).toBeFocused()
  await expect(second).toHaveAttribute('tabindex', '0')
  await expect(first).toHaveAttribute('tabindex', '-1')

  const third = page.locator('[data-plan-target][data-bay="A1"][data-cell="2"]')
  await third.click()
  await expect(third).toHaveAccessibleName(/^A1 cell 3 · Empty/)
  await expect(third).toBeFocused()
  await expect(third.locator('.focus-overlay')).toHaveCSS('opacity', '0')
  await expect(third).toHaveAttribute('tabindex', '0')
  await expect(second).toHaveAttribute('tabindex', '-1')

  await page.keyboard.press('ArrowLeft')
  await expect(second).toBeFocused()
  await page.keyboard.press('Tab')
  await expect.poll(() => page.evaluate(() => document.activeElement?.closest('[data-plan-target]') === null)).toBe(true)
})

test('opens a bay in cell view without changing its contents', async ({ page }) => {
  await page.goto('/')

  const bay = page.locator('[data-plan-target="bay"][data-bay="A1"]')
  await bay.dblclick()

  await expect(page.getByRole('button', { name: 'Cells', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: /^A1 cell 1 · Empty/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()
})

test('clears a bay with Empty without changing its grain', async ({ page }) => {
  await page.goto('/')

  await page.getByRole('button', { name: 'Paint', exact: true }).click()
  await page.getByLabel('Module', { exact: true }).selectOption('spine')
  await expect(page.getByLabel('Module', { exact: true }).locator('option[value="empty"]')).toHaveCount(0)
  await page.getByRole('button', { name: 'coarse', exact: true }).click()

  const bay = page.locator('[data-plan-target="bay"][data-bay="A1"]')
  await bay.click()
  await expect(bay).toHaveAccessibleName(/A1.*coarse grain, Spine/)

  await page.getByRole('button', { name: 'Empty', exact: true }).click()
  await bay.click()
  await expect(bay).toHaveAccessibleName(/A1.*coarse grain, Empty/)
})

test('keeps pointer focus unobtrusive while editing the footprint', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Footprint', exact: true }).click()

  const slot = page.locator('[data-plan-target="footprint"][data-bay="A1"]')
  await slot.click()

  await expect(slot).toBeFocused()
  await expect(slot).toHaveAttribute('data-pointer-focus', 'true')
  const focusStyle = await slot.evaluate((element) => {
    const style = getComputedStyle(element)
    return { strokeWidth: Number.parseFloat(style.strokeWidth), vectorEffect: style.vectorEffect }
  })
  expect(focusStyle.vectorEffect).toBe('non-scaling-stroke')
  expect(focusStyle.strokeWidth).toBeLessThanOrEqual(2)
})

test('limits issue selection to one bay across mode changes', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/project\//)

  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('baywright', 1)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const transaction = database.transaction('projects', 'readwrite')
    const store = transaction.objectStore('projects')
    const id = location.pathname.split('/')[2]!
    const record = await new Promise<StoredProjectRecord>((resolve, reject) => {
      const request = store.get(id)
      request.onsuccess = () => resolve(request.result as StoredProjectRecord)
      request.onerror = () => reject(request.error)
    })
    const ground = record.document.levels[0]
    const firstCell = ground?.bays.A1?.cells[0]
    const lastCell = ground?.bays.B1?.cells[8]
    if (!firstCell || !lastCell) throw new Error('starter project does not contain the expected cells')
    firstCell.mergeGroup = 'split-room'
    lastCell.mergeGroup = 'split-room'
    record.updatedAt = Date.now()
    store.put(record)
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
    database.close()
  })
  await page.reload()

  await page.getByRole('button', { name: 'Issues' }).click()
  const issue = page.getByRole('button', { name: /V7.*not a contiguous rectangle/ })
  await expect(issue).toBeVisible()
  await issue.click()
  await page.getByRole('button', { name: 'Cells', exact: true }).click()
  await expect(page.getByLabel('Plan canvas').getByRole('combobox')).toHaveValue('A1')
  await expect(page.locator('.selection-overlay')).toHaveCount(1)
  await expect(page.locator('[data-plan-target][data-bay="B1"]')).toHaveCount(0)

  await page.getByRole('button', { name: 'Bays', exact: true }).click()
  await expect(page.locator('[data-bay="A1"] .error-overlay')).toBeVisible()
  await expect(page.locator('[data-bay="B1"] .error-overlay')).toBeVisible()
})

test('PNG export preserves selection and browser history without exporting its overlay', async ({ page }) => {
  await page.goto('/')
  await useCellTool(page)
  await page.getByRole('button', { name: /^A1 cell 1 · Empty/ }).click()
  await expect(page.locator('.selection-overlay')).toHaveCount(1)

  const before = await page.evaluate(() => ({ url: location.href, length: history.length }))
  await page.evaluate(() => {
    const captures: number[] = []
    const serialize = XMLSerializer.prototype.serializeToString
    ;(window as Window & { __pngSelectionCounts?: number[] }).__pngSelectionCounts = captures
    XMLSerializer.prototype.serializeToString = function (root: Node): string {
      captures.push(root instanceof Element ? root.querySelectorAll('.selection-overlay').length : -1)
      return serialize.call(this, root)
    }
  })

  await page.getByText('Project', { exact: true }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export PNG plans' }).click()
  await download
  await expect(page.getByRole('button', { name: 'Export PNG plans' })).toBeEnabled()

  expect(await page.evaluate(() => (window as Window & { __pngSelectionCounts?: number[] }).__pngSelectionCounts)).toEqual([0])
  expect(await page.evaluate(() => ({ url: location.href, length: history.length }))).toEqual(before)
  await expect(page.locator('.selection-overlay')).toHaveCount(1)
})

test('locks project edits while a PNG export is running', async ({ page }) => {
  await page.goto('/')
  await paintSpineCells(page)
  await page.getByRole('button', { name: /^A1 cell 1 · Empty/ }).click()
  await expect(page.getByRole('button', { name: /^A1 cell 1 · Spine/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled()

  // The run walks the level list across several ticks. Stall the encode so the
  // window it is vulnerable in stays open long enough to click into.
  await page.evaluate(() => {
    const encode = HTMLCanvasElement.prototype.toBlob
    HTMLCanvasElement.prototype.toBlob = function (
      this: HTMLCanvasElement,
      callback: BlobCallback,
      type?: string,
      quality?: number,
    ): void {
      window.setTimeout(() => encode.call(this, callback, type, quality), 1200)
    }
  })

  await page.getByText('Project', { exact: true }).click()
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export PNG plans' }).click()

  for (const name of ['Import project', 'Resize field', 'New project', 'Undo', 'Redo']) {
    await expect(page.getByRole('button', { name, exact: true })).toBeDisabled()
  }
  // Reading the project cannot disturb the run, so this one stays available.
  await expect(page.getByRole('button', { name: 'Export JSON', exact: true })).toBeEnabled()

  // The keyboard reaches past the menu, so it is guarded separately.
  await page.keyboard.press('ControlOrMeta+z')

  await download
  await expect(page.getByRole('button', { name: 'Import project', exact: true })).toBeEnabled()
  await expect(page.getByRole('button', { name: /^A1 cell 1 · Spine/ })).toBeVisible()
})

test('puts the stored level name back when a rename resolves to no change', async ({ page }) => {
  await page.goto('/')

  const name = page.getByRole('textbox', { name: 'Name' })
  await expect(name).toHaveValue('Ground')

  // Blank: the store keeps the old name, so the field has to catch up by itself.
  await name.fill('')
  await name.blur()
  await expect(name).toHaveValue('Ground')

  // Same name in wider spacing: also a no-op write, and also a stale field.
  await name.fill('   Ground   ')
  await name.blur()
  await expect(name).toHaveValue('Ground')

  await name.fill('  Mezzanine  ')
  await name.blur()
  await expect(name).toHaveValue('Mezzanine')
})

test('loads stored projects and requested levels through Back and Forward', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/project\//)
  const firstUrl = new URL(page.url())

  const secondPath = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('baywright', 1)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const transaction = database.transaction('projects', 'readwrite')
    const store = transaction.objectStore('projects')
    const firstId = location.pathname.split('/')[2]!
    const first = await new Promise<StoredProjectRecord>((resolve, reject) => {
      const request = store.get(firstId)
      request.onsuccess = () => resolve(request.result as StoredProjectRecord)
      request.onerror = () => reject(request.error)
    })
    const document = structuredClone(first.document)
    document.id = 'second-project'
    document.name = 'Second Project'
    const ground = document.levels[0]
    if (!ground) throw new Error('starter project does not contain a level')
    ground.id = 'second-ground'
    ground.name = 'Second Ground'
    const upper = structuredClone(ground)
    upper.id = 'second-upper'
    upper.name = 'Second Upper'
    upper.y = 24
    document.levels.push(upper)
    store.put({ id: document.id, name: document.name, updatedAt: Date.now(), document })
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
    database.close()
    return '/project/second-project/level/second-upper'
  })

  await paintSpineCells(page)
  await page.getByRole('button', { name: /^A1 cell 1 · Empty/ }).click()
  await pushRoute(page, secondPath)
  await expect(page).toHaveURL(new RegExp(`${secondPath}$`))
  await expect(page.getByText('Second Project', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Plan canvas').getByText('Second Upper', { exact: true })).toBeVisible()

  await page.goBack()
  await expect(page).toHaveURL(firstUrl.href)
  await expect(page.getByText('Second Project', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^A1 cell 1 · Spine/ })).toBeVisible()

  await page.goForward()
  await expect(page).toHaveURL(new RegExp(`${secondPath}$`))
  await expect(page.getByText('Second Project', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Plan canvas').getByText('Second Upper', { exact: true })).toBeVisible()

  await pushRoute(page, '/project/missing-project/level/missing-level')
  await expect(page).toHaveURL(new RegExp(`${secondPath}$`))
  await expect(page.getByText('Second Project', { exact: true })).toBeVisible()

  // The first load waits on a flush. The immediately newer route must win.
  await pushRoute(page, firstUrl.pathname)
  await pushRoute(page, secondPath)
  await expect(page).toHaveURL(new RegExp(`${secondPath}$`))
  await expect(page.getByText('Second Project', { exact: true })).toBeVisible()
})

test('opens project output without document overflow on a short desktop viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 601 })
  await page.goto('/')

  const bottom = page.getByRole('region', { name: 'Project output' })
  await expect(bottom).toBeVisible()
  await page.getByRole('button', { name: 'Issues' }).click()
  await expect(page.getByRole('heading', { name: 'Issues' })).toBeVisible()
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight)).toBe(true)
  const bounds = await bottom.boundingBox()
  expect(bounds).not.toBeNull()
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(601)
})
