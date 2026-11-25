import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
  type PDFPageProxy,
  type PageViewport,
  type RenderTask,
} from 'pdfjs-dist/legacy/build/pdf.mjs'
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'
import { pdfRectToScreen, type PdfRect } from '../lib/geometry'

GlobalWorkerOptions.workerSrc = workerUrl

const cancelledTasks = new WeakSet<RenderTask>()
const paintTasks = new WeakMap<HTMLCanvasElement, RenderTask>()

let current: PDFDocumentProxy | null = null
let currentTask: PDFDocumentLoadingTask | null = null
let openSeq = 0

function pdfAsset(dir: string): string {
  const base = import.meta.env.BASE_URL
  const prefix = base.endsWith('/') ? base : `${base}/`
  return `${prefix}${dir}/`
}

export async function openPdfDocument(bytes: Uint8Array): Promise<PDFDocumentProxy | null> {
  const seq = ++openSeq
  const task = getDocument(documentOptions(bytes))
  const loaded = await task.promise
  if (seq !== openSeq) {
    await task.destroy()
    return null
  }
  const previous = currentTask
  currentTask = task
  current = loaded
  if (previous) await previous.destroy()
  return loaded
}

export function getPdfDocument(): PDFDocumentProxy | null {
  return current
}

export function paintPdfPage(
  pdfPage: PDFPageProxy,
  canvas: HTMLCanvasElement,
  viewport: PageViewport,
  outputScale = 1,
): RenderTask {
  cancelPaint(canvas)
  const scale = outputScale > 0 ? outputScale : 1
  canvas.width = Math.max(1, Math.floor(viewport.width * scale))
  canvas.height = Math.max(1, Math.floor(viewport.height * scale))
  const task = pdfPage.render({
    canvas,
    viewport,
    transform: scale === 1 ? undefined : [scale, 0, 0, scale, 0, 0],
  })
  paintTasks.set(canvas, task)
  void task.promise
    .finally(() => {
      if (paintTasks.get(canvas) === task) paintTasks.delete(canvas)
    })
    .catch(() => {})
  return task
}

export function cancelPaint(canvas: HTMLCanvasElement | null) {
  if (!canvas) return
  const task = paintTasks.get(canvas)
  if (!task) return
  paintTasks.delete(canvas)
  cancelRenderTask(task)
}

function cancelRenderTask(task: RenderTask) {
  if (cancelledTasks.has(task)) return
  cancelledTasks.add(task)
  task.cancel()
}

export function isCancelledRender(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: string }).name === 'RenderingCancelledException'
  )
}

export function pdfErrorMessage(error: unknown): string {
  const name =
    typeof error === 'object' && error !== null && 'name' in error
      ? String((error as { name?: string }).name)
      : ''
  if (name === 'PasswordException') {
    return 'This PDF is password-protected and can’t be opened here.'
  }
  return 'This file isn’t a readable PDF.'
}

const CROP_SCALE = 2

export async function cropPageRegion(
  sourceIndex: number,
  rotation: number,
  rect: { x: number; y: number; width: number; height: number },
  shape: 'rect' | 'circle',
): Promise<HTMLCanvasElement | null> {
  const pdf = current
  if (!pdf || rect.width < 1 || rect.height < 1) return null
  const pdfPage = await pdf.getPage(sourceIndex + 1)
  const shot = pdfPage.getViewport({ scale: CROP_SCALE, rotation })
  const full = document.createElement('canvas')
  full.width = Math.ceil(shot.width)
  full.height = Math.ceil(shot.height)
  const task = pdfPage.render({ canvas: full, viewport: shot })
  await task.promise
  const [x1, y1] = shot.convertToViewportPoint(rect.x, rect.y + rect.height)
  const [x2, y2] = shot.convertToViewportPoint(rect.x + rect.width, rect.y)
  const left = Math.max(0, Math.min(Number(x1), Number(x2)))
  const top = Math.max(0, Math.min(Number(y1), Number(y2)))
  const width = Math.max(1, Math.min(full.width - left, Math.abs(Number(x2) - Number(x1))))
  const height = Math.max(1, Math.min(full.height - top, Math.abs(Number(y2) - Number(y1))))
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(width)
  canvas.height = Math.ceil(height)
  const context = canvas.getContext('2d', { alpha: true })
  if (!context) return null
  context.drawImage(full, left, top, width, height, 0, 0, canvas.width, canvas.height)
  if (shape === 'circle') maskCircle(canvas)
  return canvas
}

function maskCircle(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('2d')
  if (!context) return
  context.globalCompositeOperation = 'destination-in'
  context.beginPath()
  context.ellipse(canvas.width / 2, canvas.height / 2, canvas.width / 2, canvas.height / 2, 0, 0, Math.PI * 2)
  context.fill()
}

const FLATTEN_DPI = 200
const MAX_FLATTEN_PIXELS = 16_000_000
const COVER_PAD = 1

export type FlattenCover = PdfRect & {
  shape: 'rect' | 'circle'
}

export type FlattenedPage = {
  png: Uint8Array
  width: number
  height: number
  viewport: PageViewport
}

function documentOptions(bytes: Uint8Array) {
  return {
    data: bytes.slice(0),
    cMapUrl: pdfAsset('cmaps'),
    cMapPacked: true,
    standardFontDataUrl: pdfAsset('standard_fonts'),
    wasmUrl: pdfAsset('wasm'),
    enableXfa: true,
  }
}

export async function openTemporaryPdf(bytes: Uint8Array): Promise<{
  pdf: PDFDocumentProxy
  destroy: () => Promise<void>
}> {
  const task = getDocument(documentOptions(bytes))
  const pdf = await task.promise
  return {
    pdf,
    destroy: () => task.destroy(),
  }
}

export async function renderFlattenedPage(
  pdf: PDFDocumentProxy,
  sourceIndex: number,
  rotation: number,
  covers: readonly FlattenCover[],
): Promise<FlattenedPage> {
  const pdfPage = await pdf.getPage(sourceIndex + 1)
  const unit = pdfPage.getViewport({ scale: 1, rotation })
  let scale = FLATTEN_DPI / 72
  const area = unit.width * scale * unit.height * scale
  if (area > MAX_FLATTEN_PIXELS && area > 0) {
    scale *= Math.sqrt(MAX_FLATTEN_PIXELS / area)
  }
  const viewport = pdfPage.getViewport({ scale, rotation })
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.ceil(viewport.width))
  canvas.height = Math.max(1, Math.ceil(viewport.height))
  await pdfPage.render({ canvas, viewport }).promise
  paintCovers(canvas, viewport, covers)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('Could not flatten this page.')
  return {
    png: new Uint8Array(await blob.arrayBuffer()),
    width: Math.max(1, unit.width),
    height: Math.max(1, unit.height),
    viewport: unit,
  }
}

function paintCovers(
  canvas: HTMLCanvasElement,
  viewport: PageViewport,
  covers: readonly FlattenCover[],
) {
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Could not flatten this page.')
  context.fillStyle = '#ffffff'
  for (const cover of covers) {
    const screen = pdfRectToScreen(viewport, expandRect(cover, COVER_PAD))
    if (cover.shape === 'circle') {
      context.beginPath()
      context.ellipse(
        screen.left + screen.width / 2,
        screen.top + screen.height / 2,
        Math.max(0.5, screen.width / 2),
        Math.max(0.5, screen.height / 2),
        0,
        0,
        Math.PI * 2,
      )
      context.fill()
      continue
    }
    context.fillRect(screen.left, screen.top, screen.width, screen.height)
  }
}

function expandRect(rect: PdfRect, pad: number): PdfRect {
  return {
    x: rect.x - pad,
    y: rect.y - pad,
    width: rect.width + pad * 2,
    height: rect.height + pad * 2,
  }
}
