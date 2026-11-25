import { OPS, type PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'

const FALLBACK = '#1c1915'
const IDENTITY = [1, 0, 0, 1, 0, 0]

export type InkMark = {
  x: number
  y: number
  endX: number
  color: string
}

type InkState = {
  ctm: number[]
  line: number[]
  text: number[]
  fill: string
  fontSize: number
  leading: number
  charSpacing: number
  wordSpacing: number
  horizontalScale: number
}

export async function readInkMarks(page: PDFPageProxy): Promise<InkMark[]> {
  const ops = await page.getOperatorList()
  const state = freshState()
  const stack: InkState[] = []
  const marks: InkMark[] = []
  for (let index = 0; index < ops.fnArray.length; index += 1) {
    const fn = ops.fnArray[index]
    const args = ops.argsArray[index]
    if (fn === OPS.save) {
      stack.push(cloneState(state))
      continue
    }
    if (fn === OPS.restore) {
      const previous = stack.pop()
      if (previous) copyState(state, previous)
      continue
    }
    if (fn === OPS.transform) {
      const matrix = asMatrix(args)
      if (matrix) state.ctm = multiply(state.ctm, matrix)
      continue
    }
    if (fn === OPS.beginText) {
      state.line = [...IDENTITY]
      state.text = [...IDENTITY]
      continue
    }
    if (fn === OPS.setTextMatrix) {
      const matrix = asMatrix(args)
      if (matrix) {
        state.line = matrix
        state.text = [...matrix]
      }
      continue
    }
    if (fn === OPS.setFont) {
      const size = Array.isArray(args) ? Number(args[1]) : Number.NaN
      if (size > 0) state.fontSize = size
      continue
    }
    if (fn === OPS.setLeading) {
      const leading = Array.isArray(args) ? Number(args[0]) : Number.NaN
      if (Number.isFinite(leading)) state.leading = leading
      continue
    }
    if (fn === OPS.setCharSpacing) {
      const spacing = Array.isArray(args) ? Number(args[0]) : Number.NaN
      if (Number.isFinite(spacing)) state.charSpacing = spacing
      continue
    }
    if (fn === OPS.setWordSpacing) {
      const spacing = Array.isArray(args) ? Number(args[0]) : Number.NaN
      if (Number.isFinite(spacing)) state.wordSpacing = spacing
      continue
    }
    if (fn === OPS.setHScale) {
      const scale = Array.isArray(args) ? Number(args[0]) : Number.NaN
      if (scale > 0) state.horizontalScale = scale / 100
      continue
    }
    if (fn === OPS.setFillRGBColor || fn === OPS.setFillGray || fn === OPS.setFillCMYKColor || fn === OPS.setFillColor) {
      const next = fillColor(fn, args)
      if (next) state.fill = next
      continue
    }
    if (fn === OPS.moveText || fn === OPS.setLeadingMoveText) {
      const shift = asPair(args)
      if (!shift) continue
      if (fn === OPS.setLeadingMoveText) state.leading = -shift[1]
      moveLine(state, shift[0], shift[1])
      continue
    }
    if (fn === OPS.nextLine) {
      moveLine(state, 0, -state.leading)
      continue
    }
    if (fn === OPS.nextLineShowText) {
      moveLine(state, 0, -state.leading)
      paintText(state, marks, glyphList(args))
      continue
    }
    if (fn === OPS.nextLineSetSpacingShowText) {
      const word = Array.isArray(args) ? Number(args[0]) : Number.NaN
      const char = Array.isArray(args) ? Number(args[1]) : Number.NaN
      if (Number.isFinite(word)) state.wordSpacing = word
      if (Number.isFinite(char)) state.charSpacing = char
      moveLine(state, 0, -state.leading)
      paintText(state, marks, Array.isArray(args) ? args[2] : null)
      continue
    }
    if (fn === OPS.showText || fn === OPS.showSpacedText) {
      paintText(state, marks, glyphList(args))
    }
  }
  return marks
}

export function colorAt(marks: readonly InkMark[], x: number, y: number, fontSize: number): string {
  const yLimit = Math.max(1.5, fontSize * 0.25)
  let best: InkMark | null = null
  for (const mark of marks) {
    if (Math.abs(mark.y - y) > yLimit) continue
    const start = Math.min(mark.x, mark.endX) - 1.5
    const end = Math.max(mark.x, mark.endX) + 1.5
    if (x < start || x > end) continue
    if (!best || mark.x >= best.x) best = mark
  }
  return best?.color ?? FALLBACK
}

function paintText(state: InkState, marks: InkMark[], glyphs: unknown) {
  const advance = measure(glyphs, state)
  const start = userPoint(state, 0, 0)
  const end = userPoint(state, advance, 0)
  marks.push({ x: start.x, y: start.y, endX: end.x, color: state.fill })
  state.text = translate(state.text, advance, 0)
}

function moveLine(state: InkState, tx: number, ty: number) {
  state.line = translate(state.line, tx, ty)
  state.text = [...state.line]
}

function measure(glyphs: unknown, state: InkState): number {
  if (!Array.isArray(glyphs)) return 0
  let width = 0
  let chars = 0
  let spaces = 0
  for (const glyph of glyphs) {
    if (typeof glyph === 'number') {
      width -= (glyph / 1000) * state.fontSize * state.horizontalScale
      continue
    }
    if (!glyph || typeof glyph !== 'object' || !('width' in glyph)) continue
    const record = glyph as { width?: number; isSpace?: boolean }
    width += ((Number(record.width) || 0) / 1000) * state.fontSize * state.horizontalScale
    chars += 1
    if (record.isSpace) spaces += 1
  }
  if (chars > 1) width += state.charSpacing * (chars - 1) * state.horizontalScale
  width += state.wordSpacing * spaces * state.horizontalScale
  return width
}

function glyphList(args: unknown): unknown {
  if (!Array.isArray(args)) return args
  return args[0]
}

function fillColor(fn: number, args: unknown): string | null {
  if (!Array.isArray(args) || args.length === 0) return null
  if (typeof args[0] === 'string' && args[0].startsWith('#')) return normalizeHex(args[0])
  if (fn === OPS.setFillGray || args.length === 1) return grayHex(Number(args[0]))
  if (fn === OPS.setFillCMYKColor || args.length >= 4) return cmykHex(Number(args[0]), Number(args[1]), Number(args[2]), Number(args[3]))
  if (args.length >= 3) return rgbHex(Number(args[0]), Number(args[1]), Number(args[2]))
  return null
}

function normalizeHex(value: string): string {
  const hex = value.slice(1, 7)
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return FALLBACK
  return `#${hex.toLowerCase()}`
}

function rgbHex(red: number, green: number, blue: number): string | null {
  if (![red, green, blue].every(Number.isFinite)) return null
  return `#${channel(red)}${channel(green)}${channel(blue)}`
}

function grayHex(gray: number): string | null {
  if (!Number.isFinite(gray)) return null
  const byte = channel(gray)
  return `#${byte}${byte}${byte}`
}

function cmykHex(cyan: number, magenta: number, yellow: number, key: number): string | null {
  if (![cyan, magenta, yellow, key].every(Number.isFinite)) return null
  return rgbHex((1 - cyan) * (1 - key), (1 - magenta) * (1 - key), (1 - yellow) * (1 - key))
}

function channel(value: number): string {
  const byte = Math.max(0, Math.min(255, Math.round(value * 255)))
  return byte.toString(16).padStart(2, '0')
}

function userPoint(state: InkState, tx: number, ty: number): { x: number; y: number } {
  const x = state.text[0] * tx + state.text[2] * ty + state.text[4]
  const y = state.text[1] * tx + state.text[3] * ty + state.text[5]
  return {
    x: state.ctm[0] * x + state.ctm[2] * y + state.ctm[4],
    y: state.ctm[1] * x + state.ctm[3] * y + state.ctm[5],
  }
}

function translate(matrix: number[], tx: number, ty: number): number[] {
  return [
    matrix[0],
    matrix[1],
    matrix[2],
    matrix[3],
    matrix[0] * tx + matrix[2] * ty + matrix[4],
    matrix[1] * tx + matrix[3] * ty + matrix[5],
  ]
}

function multiply(left: number[], right: number[]): number[] {
  return [
    left[0] * right[0] + left[2] * right[1],
    left[1] * right[0] + left[3] * right[1],
    left[0] * right[2] + left[2] * right[3],
    left[1] * right[2] + left[3] * right[3],
    left[0] * right[4] + left[2] * right[5] + left[4],
    left[1] * right[4] + left[3] * right[5] + left[5],
  ]
}

function asMatrix(args: unknown): number[] | null {
  const nested = arrayLike(args, 1) ? valuesOf(arrayLikeItem(args, 0)) : null
  const direct = valuesOf(args)
  const source = nested && nested.length >= 6 ? nested : direct
  if (!source || source.length < 6 || !source.slice(0, 6).every(Number.isFinite)) return null
  return source.slice(0, 6)
}

function asPair(args: unknown): [number, number] | null {
  const nested = arrayLike(args, 1) ? valuesOf(arrayLikeItem(args, 0)) : null
  const source = nested && nested.length >= 2 ? nested : valuesOf(args)
  if (!source || source.length < 2) return null
  const x = source[0]
  const y = source[1]
  return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null
}

function valuesOf(value: unknown): number[] | null {
  if (!arrayLike(value)) return null
  const numbers = Array.from(value as ArrayLike<unknown>, (item) => Number(item))
  return numbers
}

function arrayLike(value: unknown, min = 0): value is ArrayLike<unknown> {
  return !!value && typeof value === 'object' && 'length' in value && typeof (value as { length: unknown }).length === 'number' && (value as { length: number }).length >= min
}

function arrayLikeItem(value: unknown, index: number): unknown {
  return (value as ArrayLike<unknown>)[index]
}

function freshState(): InkState {
  return {
    ctm: [...IDENTITY],
    line: [...IDENTITY],
    text: [...IDENTITY],
    fill: '#000000',
    fontSize: 12,
    leading: 0,
    charSpacing: 0,
    wordSpacing: 0,
    horizontalScale: 1,
  }
}

function cloneState(state: InkState): InkState {
  return {
    ...state,
    ctm: [...state.ctm],
    line: [...state.line],
    text: [...state.text],
  }
}

function copyState(target: InkState, source: InkState) {
  target.ctm = [...source.ctm]
  target.line = [...source.line]
  target.text = [...source.text]
  target.fill = source.fill
  target.fontSize = source.fontSize
  target.leading = source.leading
  target.charSpacing = source.charSpacing
  target.wordSpacing = source.wordSpacing
  target.horizontalScale = source.horizontalScale
}
