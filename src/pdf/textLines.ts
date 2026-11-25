import type { PDFPageProxy, PageViewport } from 'pdfjs-dist'
import { pdfRectToScreen, type ScreenRect } from '../lib/geometry'
import type { PdfFontId, Point, TextRun } from '../types'
import { guessPdfFont } from './fonts'
import { colorAt, readInkMarks, type InkMark } from './inkColor'
import { getPdfDocument } from './pdfjs'
import { mergeRuns, textRun } from './textRuns'

const COVER_PAD = 0.75

export type TextPiece = {
  key: string
  text: string
  x: number
  y: number
  width: number
  fontSize: number
  font: PdfFontId
  color: string
}

export type TextLine = {
  key: string
  text: string
  x: number
  y: number
  width: number
  height: number
  fontSize: number
  font: PdfFontId
  pieces: TextPiece[]
}

export type TextStrip = {
  text: string
  x: number
  y: number
  width: number
  height: number
  fontSize: number
  font: PdfFontId
  sourceKeys: string[]
  pieces: TextPiece[]
}

type RawItem = {
  str: string
  x: number
  y: number
  width: number
  fontSize: number
  font: PdfFontId
  color: string
}

const cache = new Map<string, TextLine[]>()
const pending = new Map<string, Promise<TextLine[]>>()

export function clearTextLines() {
  cache.clear()
  pending.clear()
}

export function loadTextLines(sessionId: string, sourceIndex: number): Promise<TextLine[]> {
  const key = `${sessionId}:${sourceIndex}`
  const ready = cache.get(key)
  if (ready) return Promise.resolve(ready)
  const inflight = pending.get(key)
  if (inflight) return inflight
  const task = readLines(sourceIndex)
    .then((lines) => {
      cache.set(key, lines)
      pending.delete(key)
      return lines
    })
    .catch((error: unknown) => {
      pending.delete(key)
      throw error
    })
  pending.set(key, task)
  return task
}

export function lineAtPoint(lines: TextLine[], viewport: PageViewport, local: Point): TextLine | null {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]
    const screen = pdfRectToScreen(viewport, line)
    const pad = 4
    const inside =
      local.x >= screen.left - pad &&
      local.x <= screen.left + screen.width + pad &&
      local.y >= screen.top - pad &&
      local.y <= screen.top + screen.height + pad
    if (inside) return line
  }
  return null
}

export function stripsInRect(lines: readonly TextLine[], viewport: PageViewport, rect: ScreenRect): TextStrip[] {
  const screens = lines.map((line) => pdfRectToScreen(viewport, line))
  const strips: TextStrip[] = []
  lines.forEach((line, index) => {
    const band = lineBand(screens, index)
    if (!overlapsY(band, rect)) return
    const hit = line.pieces.filter((piece) => overlapsX(pieceScreen(viewport, line, piece), rect))
    if (hit.length === 0) return
    const strip = stripFrom(line, hit)
    if (strip) strips.push(strip)
  })
  return strips
}

async function readLines(sourceIndex: number): Promise<TextLine[]> {
  const pdf = getPdfDocument()
  if (!pdf) return []
  const page = await pdf.getPage(sourceIndex + 1)
  const content = await page.getTextContent()
  const marks = await readInkMarks(page).catch(() => [] as InkMark[])
  return groupTextLines(content, sourceIndex, marks)
}

type PdfTextContent = Awaited<ReturnType<PDFPageProxy['getTextContent']>>

export function groupTextLines(content: PdfTextContent, sourceIndex: number, marks: readonly InkMark[] = []): TextLine[] {
  const items: RawItem[] = []
  for (const item of content.items) {
    if (!('str' in item) || item.dir === 'ttb' || !item.str) continue
    const fontSize = fontSizeOf(item)
    const width = item.width > 0 ? item.width : Math.max(fontSize * 0.5, item.str.length * fontSize * 0.45)
    items.push({
      str: item.str,
      x: Number(item.transform[4]) || 0,
      y: Number(item.transform[5]) || 0,
      width,
      fontSize,
      font: guessPdfFont(content.styles[item.fontName]?.fontFamily ?? ''),
      color: colorAt(marks, Number(item.transform[4]) || 0, Number(item.transform[5]) || 0, fontSize),
    })
  }
  items.sort((a, b) => b.y - a.y || a.x - b.x)

  const groups: RawItem[][] = []
  for (const item of items) {
    const group = groups.find((candidate) => {
      const sample = candidate[0]
      const limit = Math.max(sample.fontSize, item.fontSize) * 0.35
      return Math.abs(sample.y - item.y) <= limit
    })
    if (group) group.push(item)
    else groups.push([item])
  }

  const lines: TextLine[] = []
  groups.forEach((group, index) => {
    group.sort((a, b) => a.x - b.x)
    const text = joinLine(group).replace(/\s+/g, ' ').trim()
    if (!text) return
    const fontSize = round(Math.max(...group.map((item) => item.fontSize)))
    const font = dominantFont(group)
    const minX = Math.min(...group.map((item) => item.x))
    const maxX = Math.max(...group.map((item) => item.x + item.width))
    const baseline = group.reduce((sum, item) => sum + item.y, 0) / group.length
    const width = Math.max(fontSize, maxX - minX) + COVER_PAD * 2
    const pieces: TextPiece[] = []
    for (const item of group) {
      for (const token of splitItem(item)) {
        pieces.push({
          key: `${sourceIndex}:${index}:${pieces.length}`,
          text: token.text,
          x: token.x,
          y: item.y,
          width: token.width,
          fontSize: item.fontSize,
          font: item.font,
          color: item.color,
        })
      }
    }
    lines.push({
      key: `${sourceIndex}:${index}`,
      text,
      x: round(minX - COVER_PAD),
      y: round(baseline - fontSize * 0.38 - COVER_PAD),
      width: round(width),
      height: round(fontSize * 1.2 + COVER_PAD * 2),
      fontSize,
      font,
      pieces,
    })
  })
  return lines
}

function splitItem(item: RawItem): Array<{ text: string; x: number; width: number }> {
  const parts = item.str.split(/(\s+)/).filter((part) => part.length > 0)
  const units = parts.map((part) => [...part].reduce((sum, char) => sum + unitWidth(char), 0))
  const total = units.reduce((sum, size) => sum + size, 0) || 1
  let x = item.x
  const tokens: Array<{ text: string; x: number; width: number }> = []
  parts.forEach((part, index) => {
    const width = item.width * (units[index] / total)
    if (part.trim()) tokens.push({ text: part, x, width })
    x += width
  })
  return tokens.length > 0 ? tokens : [{ text: item.str, x: item.x, width: item.width }]
}

function unitWidth(char: string): number {
  if (char === ' ' || char === '\t') return 0.28
  if ('iljftI'.includes(char)) return 0.28
  if ('mwMW'.includes(char)) return 0.85
  if (char >= 'A' && char <= 'Z') return 0.72
  if (char >= '0' && char <= '9') return 0.56
  return 0.5
}

function stripFrom(line: TextLine, pieces: TextPiece[]): TextStrip | null {
  const ordered = [...pieces].sort((a, b) => a.x - b.x)
  const text = joinLine(
    ordered.map((piece) => ({
      str: piece.text,
      x: piece.x,
      y: piece.y,
      width: piece.width,
      fontSize: piece.fontSize,
      font: piece.font,
      color: piece.color,
    })),
  )
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) return null
  const minX = Math.min(...ordered.map((piece) => piece.x))
  const maxX = Math.max(...ordered.map((piece) => piece.x + piece.width))
  return {
    text,
    x: round(minX - COVER_PAD),
    y: line.y,
    width: round(Math.max(line.fontSize * 0.4, maxX - minX) + COVER_PAD * 2),
    height: line.height,
    fontSize: line.fontSize,
    font: dominantFont(
      ordered.map((piece) => ({
        str: piece.text,
        x: piece.x,
        y: piece.y,
        width: piece.width,
        fontSize: piece.fontSize,
        font: piece.font,
        color: piece.color,
      })),
    ),
    sourceKeys: ordered.map((piece) => piece.key),
    pieces: ordered,
  }
}

function pieceScreen(viewport: PageViewport, line: TextLine, piece: TextPiece): ScreenRect {
  return pdfRectToScreen(viewport, {
    x: piece.x,
    y: line.y,
    width: Math.max(piece.width, 0.5),
    height: line.height,
  })
}

function lineBand(screens: ScreenRect[], index: number): { top: number; bottom: number } {
  const screen = screens[index]
  const above = index > 0 ? screens[index - 1] : null
  const below = index < screens.length - 1 ? screens[index + 1] : null
  let top = screen.top
  let bottom = screen.top + screen.height
  if (above) top = Math.min(top, (above.top + above.height + screen.top) / 2)
  else top -= Math.max(8, screen.height * 0.6)
  if (below) bottom = Math.max(bottom, (bottom + below.top) / 2)
  else bottom += Math.max(8, screen.height * 0.6)
  return { top, bottom }
}

function overlapsY(band: { top: number; bottom: number }, rect: ScreenRect): boolean {
  return rect.top < band.bottom && rect.top + rect.height > band.top
}

function overlapsX(piece: ScreenRect, rect: ScreenRect): boolean {
  const pad = 3
  return piece.left < rect.left + rect.width + pad && piece.left + piece.width > rect.left - pad
}

function joinLine(group: RawItem[]): string {
  let text = ''
  let end = group[0].x
  for (const item of group) {
    const gap = item.x - end
    if (text && gap > item.fontSize * 0.18 && !text.endsWith(' ') && !item.str.startsWith(' ')) text += ' '
    text += item.str
    end = Math.max(end, item.x + item.width)
  }
  return text
}

export function runsForPieces(pieces: readonly TextPiece[], underline: boolean): TextRun[] {
  if (pieces.length === 0) return [textRun('', 'Helvetica', underline)]
  const group: RawItem[] = [...pieces]
    .sort((a, b) => a.x - b.x)
    .map((piece) => ({
      str: piece.text,
      x: piece.x,
      y: piece.y,
      width: piece.width,
      fontSize: piece.fontSize,
      font: piece.font,
      color: piece.color,
    }))
  const text = joinLine(group).replace(/\s+/g, ' ').trim()
  const runs = mergeRuns(normalizeColored(coloredJoin(group)).map((part) => textRun(part.text, part.font, underline, part.color)))
  if (runs.map((run) => run.text).join('') !== text) return [textRun(text, dominantFont(group), underline, dominantColor(group))]
  return runs
}

function coloredJoin(group: RawItem[]): Array<{ text: string; font: PdfFontId; color: string }> {
  const parts: Array<{ text: string; font: PdfFontId; color: string }> = []
  let end = group[0].x
  for (const item of group) {
    const gap = item.x - end
    if (parts.length > 0 && gap > item.fontSize * 0.18 && !parts[parts.length - 1].text.endsWith(' ') && !item.str.startsWith(' ')) {
      parts.push({ text: ' ', font: item.font, color: item.color })
    }
    parts.push({ text: item.str, font: item.font, color: item.color })
    end = Math.max(end, item.x + item.width)
  }
  return parts
}

function normalizeColored(parts: Array<{ text: string; font: PdfFontId; color: string }>): Array<{ text: string; font: PdfFontId; color: string }> {
  const chars: Array<{ ch: string; font: PdfFontId; color: string }> = []
  for (const part of parts) {
    for (const ch of part.text) chars.push({ ch, font: part.font, color: part.color })
  }
  while (chars.length > 0 && /\s/.test(chars[0].ch)) chars.shift()
  while (chars.length > 0 && /\s/.test(chars[chars.length - 1].ch)) chars.pop()
  const kept: Array<{ ch: string; font: PdfFontId; color: string }> = []
  let skippedSpace = false
  for (const item of chars) {
    if (/\s/.test(item.ch)) {
      skippedSpace = true
      continue
    }
    if (skippedSpace && kept.length > 0) kept.push({ ch: ' ', font: item.font, color: item.color })
    skippedSpace = false
    kept.push(item)
  }
  const grouped: Array<{ text: string; font: PdfFontId; color: string }> = []
  for (const item of kept) {
    const last = grouped[grouped.length - 1]
    if (last && last.font === item.font && last.color === item.color) last.text += item.ch
    else grouped.push({ text: item.ch, font: item.font, color: item.color })
  }
  return grouped
}

function dominantColor(group: RawItem[]): string {
  let best = group[0]
  for (const item of group) {
    if (item.width > best.width) best = item
  }
  return best.color
}

function dominantFont(group: RawItem[]): PdfFontId {
  let best = group[0]
  for (const item of group) {
    if (item.width > best.width) best = item
  }
  return best.font
}

function fontSizeOf(item: { transform: ReadonlyArray<unknown>; height: number }): number {
  const vertical = Math.hypot(Number(item.transform[2]) || 0, Number(item.transform[3]) || 0)
  const horizontal = Math.hypot(Number(item.transform[0]) || 0, Number(item.transform[1]) || 0)
  const size = vertical || horizontal || item.height || 12
  return Math.max(1, size)
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}
