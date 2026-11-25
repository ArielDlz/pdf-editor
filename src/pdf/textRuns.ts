import type { PdfFontId, TextRun } from '../types'
import { fontIsBold, fontIsItalic } from './fonts'

export type TextStyle = {
  bold: boolean
  italic: boolean
  underline: boolean
  color: string
}

export type StyleKey = 'bold' | 'italic' | 'underline'

export function textRun(text: string, font: PdfFontId, underline = false, color = '#1c1915'): TextRun {
  return {
    text,
    bold: fontIsBold(font),
    italic: fontIsItalic(font),
    underline,
    color,
  }
}

export function plainText(runs: readonly TextRun[]): string {
  return runs.map((run) => run.text).join('')
}

export function mergeRuns(runs: readonly TextRun[]): TextRun[] {
  const merged: TextRun[] = []
  for (const run of runs) {
    if (!run.text) continue
    const last = merged[merged.length - 1]
    if (last && sameStyle(last, run)) last.text += run.text
    else merged.push({ ...run })
  }
  return merged.length > 0 ? merged : [{ text: '', bold: false, italic: false, underline: false, color: '#1c1915' }]
}

export function applyStyle(runs: readonly TextRun[], start: number, end: number, key: StyleKey): TextRun[] {
  const chars = explode(runs)
  const from = Math.max(0, Math.min(start, end, chars.length))
  const to = Math.max(from, Math.min(Math.max(start, end), chars.length))
  if (from === to) return mergeRuns(runs)
  const turnOn = chars.slice(from, to).some((item) => !item[key])
  for (let index = from; index < to; index += 1) chars[index] = { ...chars[index], [key]: turnOn }
  return mergeRuns(chars.map((item) => ({ text: item.ch, bold: item.bold, italic: item.italic, underline: item.underline, color: item.color })))
}

export function applyColor(runs: readonly TextRun[], start: number, end: number, color: string): TextRun[] {
  const chars = explode(runs)
  const from = Math.max(0, Math.min(start, end, chars.length))
  const to = Math.max(from, Math.min(Math.max(start, end), chars.length))
  if (from === to) return mergeRuns(runs)
  for (let index = from; index < to; index += 1) chars[index] = { ...chars[index], color }
  return mergeRuns(chars.map((item) => ({ text: item.ch, bold: item.bold, italic: item.italic, underline: item.underline, color: item.color })))
}

export function styleOfRange(runs: readonly TextRun[], start: number, end: number): TextStyle | null {
  const chars = explode(runs)
  const from = Math.max(0, Math.min(start, end, chars.length))
  const to = Math.max(from, Math.min(Math.max(start, end), chars.length))
  const slice = from === to ? chars.slice(Math.max(0, from - 1), from) : chars.slice(from, to)
  if (slice.length === 0) return null
  return {
    bold: slice.every((item) => item.bold),
    italic: slice.every((item) => item.italic),
    underline: slice.every((item) => item.underline),
    color: slice.every((item) => item.color === slice[0].color) ? slice[0].color : '',
  }
}

export function paintRuns(root: HTMLElement, runs: readonly TextRun[]) {
  const caret = selectionIn(root)
  root.replaceChildren()
  for (const run of mergeRuns(runs)) {
    if (!run.text) continue
    const span = document.createElement('span')
    span.dataset.bold = String(run.bold)
    span.dataset.italic = String(run.italic)
    span.dataset.underline = String(run.underline)
    span.dataset.color = run.color
    span.style.fontWeight = run.bold ? '700' : '400'
    span.style.fontStyle = run.italic ? 'italic' : 'normal'
    span.style.textDecoration = run.underline ? 'underline' : 'none'
    span.style.color = run.color
    span.textContent = run.text
    root.appendChild(span)
  }
  root.dataset.empty = plainText(runs).length === 0 ? 'true' : 'false'
  if (caret && document.activeElement === root) setSelection(root, caret.start, caret.end)
}

export function runsFromDom(root: HTMLElement, fallback: TextStyle): TextRun[] {
  const runs: TextRun[] = []
  collect(root, root, fallback, runs)
  return mergeRuns(runs)
}

export function selectionIn(root: HTMLElement): { start: number; end: number } | null {
  const selection = document.getSelection()
  if (!selection || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null
  const start = textOffset(root, range.startContainer, range.startOffset)
  const end = textOffset(root, range.endContainer, range.endOffset)
  return { start: Math.min(start, end), end: Math.max(start, end) }
}

export function setSelection(root: HTMLElement, start: number, end: number) {
  const startPoint = pointAt(root, start)
  const endPoint = pointAt(root, end)
  if (!startPoint || !endPoint) return
  const range = document.createRange()
  range.setStart(startPoint.node, startPoint.offset)
  range.setEnd(endPoint.node, endPoint.offset)
  const selection = document.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

export function formatActiveSelection(key: StyleKey): { id: string; runs: TextRun[] } | null {
  const selection = document.getSelection()
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null
  const anchor = selection.anchorNode
  const element = anchor instanceof Element ? anchor : anchor?.parentElement
  const root = element?.closest<HTMLElement>('[data-rich-text="true"]')
  if (!root) return null
  const id = root.dataset.annotationId
  const range = selectionIn(root)
  if (!id || !range || range.start === range.end) return null
  const current = runsFromDom(root, styleFromDataset(root))
  const runs = applyStyle(current, range.start, range.end, key)
  root.dataset.skipPaint = 'true'
  paintRuns(root, runs)
  setSelection(root, range.start, range.end)
  return { id, runs }
}

export function formatActiveColor(color: string): { id: string; runs: TextRun[] } | null {
  const selection = document.getSelection()
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null
  const anchor = selection.anchorNode
  const element = anchor instanceof Element ? anchor : anchor?.parentElement
  const root = element?.closest<HTMLElement>('[data-rich-text="true"]')
  if (!root) return null
  const id = root.dataset.annotationId
  const range = selectionIn(root)
  if (!id || !range || range.start === range.end) return null
  const current = runsFromDom(root, styleFromDataset(root))
  const runs = applyColor(current, range.start, range.end, color)
  root.dataset.skipPaint = 'true'
  paintRuns(root, runs)
  setSelection(root, range.start, range.end)
  return { id, runs }
}

export function activeSelectionStyle(): TextStyle | null {
  const selection = document.getSelection()
  if (!selection || selection.rangeCount === 0) return null
  const anchor = selection.anchorNode
  const element = anchor instanceof Element ? anchor : anchor?.parentElement
  const root = element?.closest<HTMLElement>('[data-rich-text="true"]')
  if (!root) return null
  const range = selectionIn(root)
  if (!range) return null
  return styleOfRange(runsFromDom(root, styleFromDataset(root)), range.start, range.end)
}

function styleFromDataset(root: HTMLElement): TextStyle {
  return {
    bold: root.dataset.fallbackBold === 'true',
    italic: root.dataset.fallbackItalic === 'true',
    underline: root.dataset.fallbackUnderline === 'true',
    color: root.dataset.fallbackColor || '#1c1915',
  }
}

function collect(root: HTMLElement, node: Node, style: TextStyle, runs: TextRun[]) {
  if (node.nodeType === Node.TEXT_NODE) {
    runs.push({ text: node.textContent ?? '', ...style })
    return
  }
  if (!(node instanceof HTMLElement)) return
  if (node.tagName === 'BR') {
    runs.push({ text: '\n', ...style })
    return
  }
  const next = node === root ? style : styleFromElement(node, style)
  const children = [...node.childNodes]
  if (node !== root && node.tagName === 'DIV' && children.length === 0) runs.push({ text: '\n', ...next })
  for (const child of children) collect(root, child, next, runs)
}

function styleFromElement(node: HTMLElement, fallback: TextStyle): TextStyle {
  if (node.dataset.bold == null && node.dataset.italic == null && node.dataset.underline == null && node.dataset.color == null) return fallback
  return {
    bold: node.dataset.bold === 'true',
    italic: node.dataset.italic === 'true',
    underline: node.dataset.underline === 'true',
    color: node.dataset.color || fallback.color,
  }
}

function textOffset(root: HTMLElement, node: Node, offset: number): number {
  if (node === root) {
    let count = 0
    for (let index = 0; index < offset && index < root.childNodes.length; index += 1) {
      count += root.childNodes[index]?.textContent?.length ?? 0
    }
    return count
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let count = 0
  let current = walker.nextNode()
  while (current) {
    if (current === node) return count + offset
    count += current.textContent?.length ?? 0
    current = walker.nextNode()
  }
  return count
}

function pointAt(root: HTMLElement, index: number): { node: Text; offset: number } | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let remaining = index
  let last: Text | null = null
  let current = walker.nextNode()
  while (current) {
    last = current as Text
    const length = last.textContent?.length ?? 0
    if (remaining <= length) return { node: last, offset: remaining }
    remaining -= length
    current = walker.nextNode()
  }
  if (last) return { node: last, offset: last.textContent?.length ?? 0 }
  return null
}

function explode(runs: readonly TextRun[]): Array<TextStyle & { ch: string }> {
  const chars: Array<TextStyle & { ch: string }> = []
  for (const run of runs) {
    for (const ch of run.text) chars.push({ ch, bold: run.bold, italic: run.italic, underline: run.underline, color: run.color })
  }
  return chars
}

function sameStyle(a: TextStyle, b: TextStyle): boolean {
  return a.bold === b.bold && a.italic === b.italic && a.underline === b.underline && a.color === b.color
}
