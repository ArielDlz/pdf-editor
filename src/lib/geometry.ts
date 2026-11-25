import type { PageViewport } from 'pdfjs-dist'
import type { Point, Rotation } from '../types'

export type ScreenRect = {
  left: number
  top: number
  width: number
  height: number
}

export type PdfRect = {
  x: number
  y: number
  width: number
  height: number
}

export type Handle = 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se'

export const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

export const MIN_ZOOM = 0.4
export const MAX_ZOOM = 3

export function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value))
}

export function addRotation(current: Rotation): Rotation {
  const next = (current + 90) % 360
  if (next === 90 || next === 180 || next === 270) return next
  return 0
}

export function totalRotation(pageRotate: number, extra: Rotation): Rotation {
  const next = ((pageRotate + extra) % 360 + 360) % 360
  if (next === 90 || next === 180 || next === 270) return next
  return 0
}

export function pdfRectToScreen(viewport: PageViewport, rect: PdfRect): ScreenRect {
  const [x1, y1] = viewport.convertToViewportPoint(rect.x, rect.y + rect.height)
  const [x2, y2] = viewport.convertToViewportPoint(rect.x + rect.width, rect.y)
  const left = Math.min(Number(x1), Number(x2))
  const top = Math.min(Number(y1), Number(y2))
  return {
    left,
    top,
    width: Math.abs(Number(x2) - Number(x1)),
    height: Math.abs(Number(y2) - Number(y1)),
  }
}

export function screenRectToPdf(viewport: PageViewport, rect: ScreenRect): PdfRect {
  const [x1, y1] = viewport.convertToPdfPoint(rect.left, rect.top)
  const [x2, y2] = viewport.convertToPdfPoint(rect.left + rect.width, rect.top + rect.height)
  const x = Math.min(Number(x1), Number(x2))
  const y = Math.min(Number(y1), Number(y2))
  return {
    x,
    y,
    width: Math.abs(Number(x2) - Number(x1)),
    height: Math.abs(Number(y2) - Number(y1)),
  }
}

export function screenDeltaToPdf(viewport: PageViewport, dx: number, dy: number): Point {
  const [x0, y0] = viewport.convertToPdfPoint(0, 0)
  const [x1, y1] = viewport.convertToPdfPoint(dx, dy)
  return { x: Number(x1) - Number(x0), y: Number(y1) - Number(y0) }
}

export function resizeScreenRect(
  start: ScreenRect,
  handle: Handle,
  dx: number,
  dy: number,
  min = 16,
): ScreenRect {
  let left = start.left
  let top = start.top
  let right = start.left + start.width
  let bottom = start.top + start.height

  if (handle === 'n' || handle === 'nw' || handle === 'ne') top += dy
  if (handle === 's' || handle === 'sw' || handle === 'se') bottom += dy
  if (handle === 'w' || handle === 'nw' || handle === 'sw') left += dx
  if (handle === 'e' || handle === 'ne' || handle === 'se') right += dx

  if (right - left < min) {
    if (handle === 'w' || handle === 'nw' || handle === 'sw') left = right - min
    else right = left + min
  }
  if (bottom - top < min) {
    if (handle === 'n' || handle === 'nw' || handle === 'ne') top = bottom - min
    else bottom = top + min
  }

  return { left, top, width: right - left, height: bottom - top }
}

export function pointsBounds(points: Point[]): PdfRect {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const point of points) {
    minX = Math.min(minX, point.x)
    minY = Math.min(minY, point.y)
    maxX = Math.max(maxX, point.x)
    maxY = Math.max(maxY, point.y)
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 1, height: 1 }
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
  }
}

export function scalePoints(points: Point[], from: PdfRect, to: PdfRect): Point[] {
  const scaleX = from.width === 0 ? 1 : to.width / from.width
  const scaleY = from.height === 0 ? 1 : to.height / from.height
  return points.map((point) => ({
    x: to.x + (point.x - from.x) * scaleX,
    y: to.y + (point.y - from.y) * scaleY,
  }))
}

export function localPoint(event: { clientX: number; clientY: number }, element: HTMLElement): Point {
  const box = element.getBoundingClientRect()
  return { x: event.clientX - box.left, y: event.clientY - box.top }
}

export function editedFileName(fileName: string): string {
  const stripped = fileName.replace(/\.pdf$/i, '')
  return `${stripped || 'document'}-edited.pdf`
}
