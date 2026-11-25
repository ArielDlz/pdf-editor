import {
  BlendMode,
  PDFDocument,
  degrees,
  rgb,
  type PDFFont,
  type PDFPage,
} from 'pdf-lib'
import type { PageViewport, PDFDocumentProxy } from 'pdfjs-dist'
import { pdfRectToScreen, totalRotation, type PdfRect } from '../lib/geometry'
import type { Annotation, PageRef, PdfFontId, TextRun } from '../types'
import { composeFont, fontFamilyOf, pdfFontFace } from './fonts'
import { addWebLinks, readWebLinks, rectsIntersect, stripPageExtras, type WebLink } from './pageExtras'
import { openTemporaryPdf, renderFlattenedPage, type FlattenCover } from './pdfjs'
import { plainText } from './textRuns'

const TEXT_PADDING = 4

export async function exportPdf(
  bytes: Uint8Array,
  pages: PageRef[],
  annotations: Annotation[],
): Promise<Uint8Array> {
  if (pages.length === 0) throw new Error('There are no pages to download.')
  const source = await PDFDocument.load(bytes.slice(0))
  const output = await PDFDocument.create()
  const fonts = new Map<PdfFontId, PDFFont>()
  const flattened = pages.some((page) => hidesContent(annotations, page.id))
  const raster = flattened ? await openTemporaryPdf(bytes.slice(0)) : null

  try {
    for (const ref of pages) {
      const pageAnnotations = annotations.filter((annotation) => annotation.pageId === ref.id)
      const links = readWebLinks(source.getPage(ref.sourceIndex))
      if (hidesContent(pageAnnotations)) {
        if (!raster) throw new Error('Could not flatten this page.')
        await appendFlattenedPage(output, raster.pdf, ref, pageAnnotations, links, fonts)
        continue
      }
      const [copied] = await output.copyPages(source, [ref.sourceIndex])
      const original = copied.getRotation().angle
      const total = ((original + ref.rotation) % 360 + 360) % 360
      copied.setRotation(degrees(total))
      stripPageExtras(copied)
      addWebLinks(copied, links)
      output.addPage(copied)
      for (const annotation of pageAnnotations) {
        await drawAnnotation(output, copied, fonts, annotation, false)
      }
    }
  } finally {
    if (raster) await raster.destroy()
  }

  return output.save()
}

function hidesContent(annotations: readonly Annotation[], pageId?: string): boolean {
  return annotations.some((annotation) => {
    if (pageId && annotation.pageId !== pageId) return false
    return annotation.type === 'cover' || (annotation.type === 'text' && annotation.cover)
  })
}

async function appendFlattenedPage(
  output: PDFDocument,
  pdf: PDFDocumentProxy,
  ref: PageRef,
  pageAnnotations: Annotation[],
  links: WebLink[],
  fonts: Map<PdfFontId, PDFFont>,
) {
  const pdfPage = await pdf.getPage(ref.sourceIndex + 1)
  const rotation = totalRotation(pdfPage.rotate, ref.rotation)
  const covers = flattenCovers(pageAnnotations)
  const flat = await renderFlattenedPage(pdf, ref.sourceIndex, rotation, covers)
  const image = await output.embedPng(flat.png)
  const page = output.addPage([flat.width, flat.height])
  page.drawImage(image, { x: 0, y: 0, width: flat.width, height: flat.height })
  const bounds = covers.map((cover) => ({
    x: cover.x,
    y: cover.y,
    width: cover.width,
    height: cover.height,
  }))
  const kept = links
    .filter((link) => !bounds.some((cover) => rectsIntersect(link, cover)))
    .map((link) => ({ ...link, ...mapRect(flat.viewport, flat.height, link) }))
  addWebLinks(page, kept)
  for (const annotation of pageAnnotations) {
    if (annotation.type === 'cover') continue
    const mapped = mapAnnotation(flat.viewport, flat.height, annotation)
    await drawAnnotation(output, page, fonts, mapped, true)
  }
}

function flattenCovers(annotations: readonly Annotation[]): FlattenCover[] {
  const covers: FlattenCover[] = []
  for (const annotation of annotations) {
    if (annotation.type === 'cover') {
      covers.push({
        x: annotation.x,
        y: annotation.y,
        width: annotation.width,
        height: annotation.height,
        shape: annotation.shape,
      })
      continue
    }
    if (annotation.type === 'text' && annotation.cover) {
      const strips = annotation.covers.length > 0 ? annotation.covers : [annotation]
      for (const strip of strips) covers.push({ ...strip, shape: 'rect' })
    }
  }
  return covers
}

function mapAnnotation(viewport: PageViewport, pageHeight: number, annotation: Annotation): Annotation {
  if (annotation.type === 'ink') {
    return {
      ...annotation,
      points: annotation.points.map((point) => mapPoint(viewport, pageHeight, point)),
    }
  }
  const rect = mapRect(viewport, pageHeight, annotation)
  if (annotation.type === 'text') {
    return {
      ...annotation,
      ...rect,
      covers: annotation.covers.map((cover) => mapRect(viewport, pageHeight, cover)),
    }
  }
  return { ...annotation, ...rect }
}

function mapRect(viewport: PageViewport, pageHeight: number, rect: PdfRect): PdfRect {
  const screen = pdfRectToScreen(viewport, rect)
  return {
    x: screen.left,
    y: pageHeight - screen.top - screen.height,
    width: screen.width,
    height: screen.height,
  }
}

function mapPoint(viewport: PageViewport, pageHeight: number, point: { x: number; y: number }) {
  const [x, y] = viewport.convertToViewportPoint(point.x, point.y)
  return { x: Number(x), y: pageHeight - Number(y) }
}

async function drawAnnotation(
  doc: PDFDocument,
  page: PDFPage,
  fonts: Map<PdfFontId, PDFFont>,
  annotation: Annotation,
  coversBaked: boolean,
): Promise<void> {
  if (annotation.type === 'highlight') {
    page.drawRectangle({
      x: annotation.x,
      y: annotation.y,
      width: annotation.width,
      height: annotation.height,
      color: hexToRgb(annotation.color),
      opacity: 0.45,
      blendMode: BlendMode.Multiply,
    })
    return
  }

  if (annotation.type === 'ink') {
    const color = hexToRgb(annotation.color)
    for (let index = 1; index < annotation.points.length; index += 1) {
      page.drawLine({
        start: annotation.points[index - 1],
        end: annotation.points[index],
        thickness: annotation.strokeWidth,
        color,
      })
    }
    return
  }

  if (annotation.type === 'text') {
    if (annotation.cover && !coversBaked) {
      const strips = annotation.covers.length > 0 ? annotation.covers : [annotation]
      for (const strip of strips) {
        page.drawRectangle({
          x: strip.x,
          y: strip.y,
          width: strip.width,
          height: strip.height,
          color: rgb(1, 1, 1),
        })
      }
    }
    await drawText(doc, page, fonts, annotation)
    return
  }

  if (annotation.type === 'cover') {
    if (coversBaked) return
    if (annotation.shape === 'circle') {
      page.drawEllipse({
        x: annotation.x + annotation.width / 2,
        y: annotation.y + annotation.height / 2,
        xScale: annotation.width / 2,
        yScale: annotation.height / 2,
        color: rgb(1, 1, 1),
      })
      return
    }
    page.drawRectangle({
      x: annotation.x,
      y: annotation.y,
      width: annotation.width,
      height: annotation.height,
      color: rgb(1, 1, 1),
    })
    return
  }

  const image =
    annotation.mime === 'image/png'
      ? await doc.embedPng(annotation.bytes)
      : await doc.embedJpg(annotation.bytes)
  page.drawImage(image, {
    x: annotation.x,
    y: annotation.y,
    width: annotation.width,
    height: annotation.height,
  })
}

async function drawText(
  doc: PDFDocument,
  page: PDFPage,
  fonts: Map<PdfFontId, PDFFont>,
  annotation: Extract<Annotation, { type: 'text' }>,
): Promise<void> {
  if (!plainText(annotation.runs).trim()) return
  const family = fontFamilyOf(annotation.font)
  const pad = annotation.cover ? 0.75 : TEXT_PADDING
  const baseline = annotation.y + annotation.height - pad - annotation.fontSize * 0.82
  const covers = annotation.covers.length > 0 ? annotation.covers : [annotation]
  const logical = splitRunLines(annotation.runs)
  if (annotation.cover && logical.length === covers.length) {
    for (let index = 0; index < covers.length; index += 1) {
      const strip = covers[index]
      const lineBaseline = strip.y + strip.height - pad - annotation.fontSize * 0.82
      await drawRunsAt(doc, page, fonts, family, logical[index], strip.x + pad, lineBaseline, annotation.fontSize)
    }
    return
  }
  const maxWidth = Math.max(8, annotation.width - pad * 2)
  const lineHeight = annotation.fontSize * 1.2
  const maxLines = Math.max(1, Math.floor((annotation.height - pad * 2) / lineHeight))
  const lines = await layoutLines(doc, fonts, family, annotation.runs, annotation.fontSize, maxWidth)
  for (let index = 0; index < Math.min(lines.length, maxLines); index += 1) {
    let x = annotation.x + pad
    const y = baseline - index * lineHeight
    for (const piece of lines[index]) {
      const font = await embedFont(doc, fonts, composeFont(family, piece.bold, piece.italic))
      const safe = sanitize(font, piece.text)
      if (!safe) continue
      const ink = hexToRgb(piece.color)
      page.drawText(safe, { x, y, size: annotation.fontSize, font, color: ink })
      if (piece.underline) drawUnderline(page, font, safe, x, y, annotation.fontSize, ink)
      x += font.widthOfTextAtSize(safe, annotation.fontSize)
    }
  }
}

function splitRunLines(runs: readonly TextRun[]): TextRun[][] {
  const lines: TextRun[][] = [[]]
  for (const run of runs) {
    const parts = run.text.split('\n')
    for (let index = 0; index < parts.length; index += 1) {
      if (index > 0) lines.push([])
      if (parts[index]) lines[lines.length - 1].push({ ...run, text: parts[index] })
    }
  }
  return lines
}

async function drawRunsAt(
  doc: PDFDocument,
  page: PDFPage,
  fonts: Map<PdfFontId, PDFFont>,
  family: ReturnType<typeof fontFamilyOf>,
  runs: readonly TextRun[],
  x: number,
  baseline: number,
  fontSize: number,
) {
  let cursor = x
  for (const run of runs) {
    const text = sanitizeText(run.text)
    if (!text) continue
    const font = await embedFont(doc, fonts, composeFont(family, run.bold, run.italic))
    const safe = sanitize(font, text)
    if (!safe) continue
    const ink = hexToRgb(run.color)
    page.drawText(safe, { x: cursor, y: baseline, size: fontSize, font, color: ink })
    if (run.underline) drawUnderline(page, font, safe, cursor, baseline, fontSize, ink)
    cursor += font.widthOfTextAtSize(safe, fontSize)
  }
}

async function layoutLines(
  doc: PDFDocument,
  fonts: Map<PdfFontId, PDFFont>,
  family: ReturnType<typeof fontFamilyOf>,
  runs: TextRun[],
  fontSize: number,
  maxWidth: number,
): Promise<TextRun[][]> {
  const lines: TextRun[][] = []
  let line: TextRun[] = []
  let width = 0
  const flush = () => {
    lines.push(line)
    line = []
    width = 0
  }
  for (const token of tokenize(runs)) {
    if (token.text === '\n') {
      flush()
      continue
    }
    const font = await embedFont(doc, fonts, composeFont(family, token.bold, token.italic))
    const size = font.widthOfTextAtSize(sanitize(font, token.text), fontSize)
    if (line.length > 0 && width + size > maxWidth && token.text.trim()) flush()
    line.push(token)
    width += size
  }
  if (line.length > 0) flush()
  return lines
}

function tokenize(runs: readonly TextRun[]): TextRun[] {
  const tokens: TextRun[] = []
  for (const run of runs) {
    const parts = run.text.split(/(\n|\s+)/)
    for (const part of parts) {
      if (part) tokens.push({ ...run, text: part })
    }
  }
  return tokens
}

function sanitizeText(text: string): string {
  return text.replace(/\s+/g, ' ')
}

function drawUnderline(
  page: PDFPage,
  font: PDFFont,
  line: string,
  x: number,
  baseline: number,
  fontSize: number,
  color: ReturnType<typeof hexToRgb>,
) {
  const width = font.widthOfTextAtSize(line, fontSize)
  if (width <= 0) return
  const y = baseline - fontSize * 0.12
  page.drawLine({
    start: { x, y },
    end: { x: x + width, y },
    thickness: Math.max(0.6, fontSize / 14),
    color,
  })
}

async function embedFont(doc: PDFDocument, fonts: Map<PdfFontId, PDFFont>, id: PdfFontId): Promise<PDFFont> {
  const cached = fonts.get(id)
  if (cached) return cached
  const font = await doc.embedFont(pdfFontFace(id).standard)
  fonts.set(id, font)
  return font
}

function sanitize(font: PDFFont, text: string): string {
  let result = ''
  for (const character of text) {
    if (character === '\n' || character === '\r') {
      result += character === '\r' ? '' : '\n'
      continue
    }
    try {
      font.encodeText(character)
      result += character
    } catch {
      result += '?'
    }
  }
  return result
}

function hexToRgb(hex: string) {
  const value = hex.replace('#', '')
  const red = Number.parseInt(value.slice(0, 2), 16) / 255
  const green = Number.parseInt(value.slice(2, 4), 16) / 255
  const blue = Number.parseInt(value.slice(4, 6), 16) / 255
  return rgb(red, green, blue)
}
