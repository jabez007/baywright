/** Browser-only PNG export for the currently rendered SVG plan. */

export interface PngExportOptions {
  filename: string
  /** Output pixels per rendered CSS pixel. */
  scale?: number
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export function pngFilename(projectName: string, levelName: string, y?: number): string {
  const project = slug(projectName) || 'baywright-project'
  const level = slug(levelName) || 'level'
  const floor = y === undefined ? '' : `-y${y}`
  return `${project}-${level}${floor}.png`
}

export async function exportSvgAsPng(svg: SVGSVGElement, options: PngExportOptions): Promise<void> {
  const { width, height } = outputSize(svg, options.scale ?? 2)
  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('width', String(width))
  clone.setAttribute('height', String(height))

  copyCustomProperties(clone)
  embedDocumentStyles(clone)
  const background = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#ffffff'
  addBackground(clone, background)

  const source = new Blob([new XMLSerializer().serializeToString(clone)], {
    type: 'image/svg+xml;charset=utf-8',
  })
  const sourceUrl = URL.createObjectURL(source)

  try {
    const image = await loadImage(sourceUrl)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('This browser cannot create a 2D canvas')
    context.fillStyle = background
    context.fillRect(0, 0, width, height)
    context.drawImage(image, 0, 0, width, height)

    const png = await canvasBlob(canvas)
    downloadBlob(png, options.filename)
  } finally {
    URL.revokeObjectURL(sourceUrl)
  }
}

function outputSize(svg: SVGSVGElement, scale: number): { width: number; height: number } {
  const viewBox = svg.viewBox.baseVal
  if (viewBox.width <= 0 || viewBox.height <= 0) throw new Error('The plan SVG has no usable viewBox')

  const bounds = svg.getBoundingClientRect()
  const renderedWidth = bounds.width > 0 ? bounds.width : 900
  const renderedHeight = bounds.height > 0 ? bounds.height : renderedWidth * (viewBox.height / viewBox.width)
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 2
  return {
    width: Math.max(1, Math.round(renderedWidth * safeScale)),
    height: Math.max(1, Math.round(renderedHeight * safeScale)),
  }
}

function copyCustomProperties(clone: SVGSVGElement): void {
  const styles = getComputedStyle(document.documentElement)
  for (let index = 0; index < styles.length; index++) {
    const property = styles.item(index)
    if (property.startsWith('--')) clone.style.setProperty(property, styles.getPropertyValue(property))
  }
}

function embedDocumentStyles(clone: SVGSVGElement): void {
  const rules: string[] = []
  for (let sheetIndex = 0; sheetIndex < document.styleSheets.length; sheetIndex++) {
    const sheet = document.styleSheets.item(sheetIndex)
    if (!sheet) continue
    try {
      for (let ruleIndex = 0; ruleIndex < sheet.cssRules.length; ruleIndex++) {
        const rule = sheet.cssRules.item(ruleIndex)
        if (rule) rules.push(rule.cssText)
      }
    } catch {
      // Cross-origin stylesheets may refuse cssRules access. The app's Vite
      // styles are same-origin, so export can continue with those.
    }
  }
  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style')
  style.textContent = rules.join('\n')
  clone.insertBefore(style, clone.firstChild)
}

function addBackground(clone: SVGSVGElement, color: string): void {
  const viewBox = clone.viewBox.baseVal
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
  rect.setAttribute('x', String(viewBox.x))
  rect.setAttribute('y', String(viewBox.y))
  rect.setAttribute('width', String(viewBox.width))
  rect.setAttribute('height', String(viewBox.height))
  rect.setAttribute('fill', color)
  const style = clone.querySelector('style')
  style?.after(rect)
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('The browser could not render the SVG plan'))
    image.src = url
  })
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('The browser could not encode the plan as PNG'))
    }, 'image/png')
  })
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
