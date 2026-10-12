<script setup lang="ts">
import {
  AmbientLight,
  BoxGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  EdgesGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  MeshBasicMaterial,
  MeshLambertMaterial,
  NearestFilter,
  PerspectiveCamera,
  Quaternion,
  Raycaster,
  Scene as World,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Material,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'

import { blockLook, buildScene, layerSummary, type BlockFinish, type Scene } from '../domain/scene.js'
import { useProjectStore } from '../stores/project.js'

const store = useProjectStore()
const stage = ref<HTMLDivElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)
const scene = shallowRef<Scene | null>(null)
/** The highest layer drawn, or null to draw every layer. */
const layer = ref<number | null>(null)
const picked = ref<{ blockId: string; x: number; y: number; z: number } | null>(null)
const webglError = ref<string | null>(null)

// --------------------------------------------------------------------------
// The layer guide
// --------------------------------------------------------------------------

const bounds = computed(() => scene.value?.bounds ?? null)

/** One stop past the top layer stands for every layer. */
const allStop = computed(() => (bounds.value ? bounds.value.y1 + 1 : 0))

const sliderValue = computed({
  get: () => layer.value ?? allStop.value,
  set: (value: number) => {
    layer.value = Number(value) >= allStop.value ? null : Number(value)
  },
})

const summary = computed(() => (scene.value && layer.value !== null ? layerSummary(scene.value, layer.value) : null))

function step(by: 1 | -1): void {
  if (!bounds.value) return
  sliderValue.value = Math.min(allStop.value, Math.max(bounds.value.y0, sliderValue.value + by))
}

function blockName(blockId: string): string {
  return blockId.replace(/^[a-z0-9_.-]+:/, '').replace(/\[.*$/, '').replaceAll('_', ' ')
}

// --------------------------------------------------------------------------
// three.js
// --------------------------------------------------------------------------

const FINISHES: readonly BlockFinish[] = ['solid', 'glow', 'glass']

/** How far a layer below the chosen one fades toward the background. */
const FADE = 0.55

interface Group {
  mesh: InstancedMesh
  /** Each instance's y, ascending, since blocks go in layer by layer. */
  ys: Int32Array
  /** Each instance's index in the scene's blocks. A stair has two or three instances. */
  blocks: Int32Array
  colours: Float32Array
}

let renderer: WebGLRenderer | null = null
let camera: PerspectiveCamera | null = null
let controls: OrbitControls | null = null
let world: World | null = null
let groups: Group[] = []
let highlight: LineSegments | null = null
let frame = 0
let timer: ReturnType<typeof setTimeout> | undefined
let resizeObserver: ResizeObserver | null = null
let pointerDown: { x: number; y: number } | null = null
const background = new Color()
const cube = new BoxGeometry(1, 1, 1)
const materials: Record<BlockFinish, Material> = {
  solid: new MeshLambertMaterial({ map: edgeTexture() }),
  glow: new MeshBasicMaterial({ map: edgeTexture() }),
  glass: new MeshLambertMaterial({ map: edgeTexture(), transparent: true, opacity: 0.35, depthWrite: false }),
}

/** A white tile with a faint darker rim, so the block grid shows on a flat wall. */
function edgeTexture(): CanvasTexture | null {
  if (typeof document === 'undefined') return null
  const tile = document.createElement('canvas')
  tile.width = tile.height = 16
  const context = tile.getContext('2d')
  if (!context) return null
  context.fillStyle = '#c8c8c8'
  context.fillRect(0, 0, 16, 16)
  context.fillStyle = '#ffffff'
  context.fillRect(1, 1, 14, 14)
  const texture = new CanvasTexture(tile)
  texture.magFilter = NearestFilter
  texture.colorSpace = SRGBColorSpace
  return texture
}

function requestRender(): void {
  if (frame || !renderer) return
  frame = requestAnimationFrame(() => {
    frame = 0
    if (renderer && world && camera) renderer.render(world, camera)
  })
}

function setUp(): void {
  if (!canvas.value) return
  try {
    renderer = new WebGLRenderer({ canvas: canvas.value, antialias: true })
  } catch {
    webglError.value = 'This browser cannot draw 3D graphics, so only the layer guide is shown.'
    return
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  const style = getComputedStyle(document.documentElement)
  background.setStyle(style.getPropertyValue('--bg').trim() || '#f4f4f2')

  world = new World()
  world.background = background
  world.add(new AmbientLight(0xffffff, 1.6))
  const sun = new DirectionalLight(0xffffff, 1.9)
  sun.position.set(0.6, 1, 0.35)
  world.add(sun)

  highlight = new LineSegments(new EdgesGeometry(new BoxGeometry(1.02, 1.02, 1.02)), new LineBasicMaterial({ color: 0xff3d7f }))
  highlight.visible = false
  world.add(highlight)

  camera = new PerspectiveCamera(45, 1, 0.1, 4000)
  controls = new OrbitControls(camera, canvas.value)
  controls.addEventListener('change', requestRender)

  resizeObserver = new ResizeObserver(resize)
  if (stage.value) resizeObserver.observe(stage.value)
  resize()
}

function resize(): void {
  if (!renderer || !camera || !stage.value) return
  const { clientWidth: width, clientHeight: height } = stage.value
  if (width === 0 || height === 0) return
  renderer.setSize(width, height, false)
  camera.aspect = width / height
  camera.updateProjectionMatrix()
  requestRender()
}

/** Replace the meshes with the current scene's blocks. */
function fillWorld(next: Scene, refit: boolean): void {
  if (!world) return
  for (const group of groups) {
    world.remove(group.mesh)
    group.mesh.dispose()
  }

  const indices: Record<BlockFinish, number[]> = { solid: [], glow: [], glass: [] }
  next.blocks.forEach((block, index) => indices[blockLook(block.blockId).finish].push(index))

  const matrix = new Matrix4()
  const position = new Vector3()
  const scale = new Vector3()
  const rotation = new Quaternion()
  const colour = new Color()
  groups = FINISHES.filter((finish) => indices[finish].length > 0).map((finish) => {
    const members = indices[finish]
    const size = members.reduce((total, blockIndex) => total + blockLook(next.blocks[blockIndex]!.blockId).parts.length, 0)
    const mesh = new InstancedMesh(cube, materials[finish], size)
    const ys = new Int32Array(size)
    const blocks = new Int32Array(size)
    const colours = new Float32Array(size * 3)
    let instance = 0
    for (const blockIndex of members) {
      const block = next.blocks[blockIndex]!
      const look = blockLook(block.blockId)
      colour.setHex(look.colour, SRGBColorSpace)
      for (const [x0, y0, z0, x1, y1, z1] of look.parts) {
        position.set(block.x + (x0 + x1) / 2, block.y + (y0 + y1) / 2, block.z + (z0 + z1) / 2)
        scale.set(x1 - x0, y1 - y0, z1 - z0)
        mesh.setMatrixAt(instance, matrix.compose(position, rotation, scale))
        colour.toArray(colours, instance * 3)
        ys[instance] = block.y
        blocks[instance] = blockIndex
        instance++
      }
    }
    mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(colours), 3)
    world!.add(mesh)
    return { mesh, ys, blocks, colours }
  })

  if (refit) fitCamera('angle')
  showLayer()
}

/** Hide the layers above the chosen one and fade the ones below it. */
function showLayer(): void {
  const top = layer.value
  const faded = new Color()
  for (const group of groups) {
    const shown = top === null ? group.ys.length : firstAbove(group.ys, top)
    const current = top === null ? 0 : firstAbove(group.ys, top - 1)
    const out = group.mesh.instanceColor!.array as Float32Array
    for (let instance = 0; instance < shown; instance++) {
      const at = instance * 3
      faded.fromArray(group.colours, at)
      if (instance < current) faded.lerp(background, FADE)
      faded.toArray(out, at)
    }
    group.mesh.count = shown
    group.mesh.instanceColor!.needsUpdate = true
  }
  if (picked.value && top !== null && picked.value.y > top) clearPick()
  requestRender()
}

function firstAbove(ys: Int32Array, y: number): number {
  let [lo, hi] = [0, ys.length]
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (ys[mid]! <= y) lo = mid + 1
    else hi = mid
  }
  return lo
}

function fitCamera(view: 'angle' | 'top'): void {
  const box = bounds.value
  if (!camera || !controls || !box) return
  const centre = new Vector3((box.x0 + box.x1 + 1) / 2, (box.y0 + box.y1 + 1) / 2, (box.z0 + box.z1 + 1) / 2)
  const radius = new Vector3(box.x1 - box.x0 + 1, box.y1 - box.y0 + 1, box.z1 - box.z0 + 1).length() / 2
  const distance = (radius / Math.sin((camera.fov * Math.PI) / 360)) * 0.95 + 2
  // A hair off vertical, so the orbit controls keep north at the top.
  const direction = view === 'top' ? new Vector3(0, 1, 0.0001) : new Vector3(0.8, 0.75, 1.05)
  camera.position.copy(centre).addScaledVector(direction.normalize(), distance)
  controls.target.copy(centre)
  controls.update()
  requestRender()
}

// --------------------------------------------------------------------------
// Picking
// --------------------------------------------------------------------------

function onPointerDown(event: PointerEvent): void {
  pointerDown = { x: event.clientX, y: event.clientY }
}

/** A click that did not turn the view names the block under the pointer. */
function onPointerUp(event: PointerEvent): void {
  const start = pointerDown
  pointerDown = null
  if (!start || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4) return
  pick(event.clientX, event.clientY)
}

function pick(clientX: number, clientY: number): void {
  if (!camera || !canvas.value || !scene.value) return
  const rect = canvas.value.getBoundingClientRect()
  const pointer = new Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1)
  const raycaster = new Raycaster()
  raycaster.setFromCamera(pointer, camera)
  const [hit] = raycaster.intersectObjects(groups.map((group) => group.mesh), false)
  const group = hit && groups.find((candidate) => candidate.mesh === hit.object)
  if (!hit || !group || hit.instanceId === undefined) {
    clearPick()
    return
  }
  const block = scene.value.blocks[group.blocks[hit.instanceId]!]!
  picked.value = { blockId: block.blockId, x: block.x, y: block.y, z: block.z }
  if (highlight) {
    highlight.position.set(block.x + 0.5, block.y + 0.5, block.z + 0.5)
    highlight.visible = true
  }
  requestRender()
}

function clearPick(): void {
  picked.value = null
  if (highlight) highlight.visible = false
  requestRender()
}

// --------------------------------------------------------------------------
// Lifecycle
// --------------------------------------------------------------------------

function rebuild(): void {
  const first = scene.value === null
  const next = buildScene(store.toJSON())
  const box = next.bounds
  if (layer.value !== null && (!box || layer.value > box.y1)) layer.value = null
  else if (layer.value !== null && box && layer.value < box.y0) layer.value = box.y0
  clearPick()
  scene.value = next
  fillWorld(next, first)
}

function scheduleRebuild(): void {
  if (timer !== undefined) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = undefined
    rebuild()
  }, 200)
}

onMounted(() => {
  setUp()
  rebuild()
})

const stopProjectWatch = watch(() => store.project, scheduleRebuild, { deep: true })
const stopLayerWatch = watch(layer, showLayer)

onBeforeUnmount(() => {
  if (timer !== undefined) clearTimeout(timer)
  if (frame) cancelAnimationFrame(frame)
  stopProjectWatch()
  stopLayerWatch()
  resizeObserver?.disconnect()
  controls?.dispose()
  for (const group of groups) group.mesh.dispose()
  for (const material of Object.values(materials)) {
    ;(material as MeshLambertMaterial).map?.dispose()
    material.dispose()
  }
  cube.dispose()
  renderer?.dispose()
})
</script>

<template>
  <section class="block-view" aria-label="3D view">
    <div class="layout">
      <div ref="stage" class="stage">
        <canvas ref="canvas" @pointerdown="onPointerDown" @pointerup="onPointerUp" />
        <p v-if="webglError" class="no-webgl muted">{{ webglError }}</p>
        <div class="camera" role="group" aria-label="Camera">
          <button type="button" @click="fitCamera('angle')">Angle</button>
          <button type="button" @click="fitCamera('top')">Top</button>
        </div>
        <p class="picked" role="status">
          <template v-if="picked">
            <strong>{{ blockName(picked.blockId) }}</strong>
            <span class="mono">{{ picked.blockId }}</span>
            <span class="mono">x {{ picked.x }}, y {{ picked.y }}, z {{ picked.z }}</span>
          </template>
          <span v-else class="muted">Click a block to name it.</span>
        </p>
      </div>

      <section class="guide" aria-label="Layer guide">
        <template v-if="bounds">
          <label class="slider">
            <span>Layer</span>
            <input v-model.number="sliderValue" type="range" :min="bounds.y0" :max="allStop" step="1" />
          </label>
          <div class="steps">
            <button type="button" aria-label="Down a layer" :disabled="sliderValue <= bounds.y0" @click="step(-1)">Down</button>
            <button type="button" aria-label="Up a layer" :disabled="layer === null" @click="step(1)">Up</button>
          </div>

          <div v-if="summary" class="readout">
            <h3>Layer y {{ summary.y }}</h3>
            <p v-if="summary.levels.length > 0" class="muted">{{ summary.levels.join(', ') }}</p>
            <p class="mono">{{ summary.blocks.toLocaleString() }} blocks</p>
            <p v-if="summary.bounds" class="mono">
              x {{ summary.bounds.x0 }} to {{ summary.bounds.x1 }}, z {{ summary.bounds.z0 }} to {{ summary.bounds.z1 }}
            </p>
            <ol class="materials">
              <li v-for="entry in summary.materials" :key="entry.blockId">
                <span :title="entry.blockId">{{ blockName(entry.blockId) }}</span>
                <strong class="mono">{{ entry.stacks.label }}</strong>
              </li>
            </ol>
          </div>
          <div v-else-if="scene" class="readout">
            <h3>All layers</h3>
            <p class="mono">{{ scene.blocks.length.toLocaleString() }} blocks</p>
            <p class="mono">y {{ bounds.y0 }} to {{ bounds.y1 }}</p>
            <p class="muted">Move the slider down to build one layer at a time. Faded blocks are already built.</p>
          </div>
        </template>
        <p v-else class="muted">Nothing is built yet. Paint a module to see it here.</p>
      </section>
    </div>
  </section>
</template>

<style scoped>
.block-view {
  container-type: size;
  width: 100%;
  height: 100%;
  min-height: 0;
}

.layout {
  height: 100%;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 230px;
}

.stage {
  position: relative;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

canvas {
  display: block;
  width: 100%;
  height: 100%;
  touch-action: none;
}

.no-webgl {
  position: absolute;
  inset: 0;
  display: grid;
  place-content: center;
  margin: 0;
  padding: 18px;
  text-align: center;
}

.camera {
  position: absolute;
  top: 10px;
  left: 10px;
  display: flex;
  gap: 4px;
}

.picked {
  position: absolute;
  right: 10px;
  bottom: 10px;
  left: 10px;
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  margin: 0;
  padding: 6px 9px;
  background: color-mix(in srgb, var(--panel) 88%, transparent);
  border-radius: var(--radius);
  font-size: 12px;
  pointer-events: none;
}

.picked .mono {
  font-size: 11px;
}

.guide {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  overflow: auto;
  background: var(--panel);
  border-left: 1px solid var(--border);
}

.slider {
  display: grid;
  gap: 4px;
  color: var(--muted);
  font-size: 11px;
}

.slider input {
  width: 100%;
}

.steps {
  display: flex;
  gap: 6px;
}

.steps button {
  flex: 1;
}

.readout {
  display: grid;
  gap: 6px;
}

.readout h3 {
  margin: 0;
  font-size: 14px;
}

.readout p {
  margin: 0;
  font-size: 12px;
}

.materials {
  list-style: none;
  margin: 4px 0 0;
  padding: 0;
}

.materials li {
  min-width: 0;
  display: flex;
  justify-content: space-between;
  gap: 10px;
  padding: 4px 0;
  border-bottom: 1px solid var(--border);
  font-size: 12px;
}

.materials li span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.materials strong {
  flex: none;
  font-size: 11px;
}

@container (max-width: 560px) {
  .layout {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(0, 3fr) minmax(0, 2fr);
  }

  .guide {
    border-top: 1px solid var(--border);
    border-left: 0;
  }
}
</style>
