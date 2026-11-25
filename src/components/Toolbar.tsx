import { useEffect, useRef, useState } from 'react'
import { clampZoom, editedFileName, screenRectToPdf, totalRotation } from '../lib/geometry'
import { copyBytes, readImageFile } from '../lib/images'
import { exportPdf } from '../pdf/exportPdf'
import { getPdfDocument } from '../pdf/pdfjs'
import { PDF_FONT_FAMILIES, composeFont, fontFamilyOf, fontIsBold, fontIsItalic } from '../pdf/fonts'
import { activeSelectionStyle, formatActiveColor, formatActiveSelection, type StyleKey } from '../pdf/textRuns'
import { useEditorStore } from '../store/editorStore'
import {
  HIGHLIGHT_COLORS,
  INK_COLORS,
  TEXT_COLORS,
  type Annotation,
  type PdfFontId,
  type Tool,
} from '../types'

const TOOLS: { id: Tool; label: string }[] = [
  { id: 'select', label: 'Select' },
  { id: 'text', label: 'Text' },
  { id: 'highlight', label: 'Highlight' },
  { id: 'ink', label: 'Draw' },
  { id: 'image', label: 'Image' },
  { id: 'sign', label: 'Sign' },
  { id: 'cut', label: 'Cut' },
]

export function Toolbar({ onOpen }: { onOpen: () => void }) {
  const doc = useEditorStore((state) => state.doc)
  const tool = useEditorStore((state) => state.tool)
  const zoom = useEditorStore((state) => state.zoom)
  const past = useEditorStore((state) => state.past.length)
  const future = useEditorStore((state) => state.future.length)
  const gestureDirty = useEditorStore((state) => state.gesture?.dirty ?? false)
  const exporting = useEditorStore((state) => state.exporting)
  const currentPageId = useEditorStore((state) => state.currentPageId)
  const setTool = useEditorStore((state) => state.setTool)
  const setZoom = useEditorStore((state) => state.setZoom)
  const undo = useEditorStore((state) => state.undo)
  const redo = useEditorStore((state) => state.redo)
  const setCurrentPage = useEditorStore((state) => state.setCurrentPage)
  const setSignatureOpen = useEditorStore((state) => state.setSignatureOpen)
  const imageRef = useRef<HTMLInputElement>(null)

  if (!doc) return null
  const pages = doc.pages
  const index = pages.findIndex((page) => page.id === currentPageId)

  async function download() {
    const state = useEditorStore.getState()
    if (!state.doc || state.doc.pages.length === 0) return
    state.setExporting(true)
    state.setError(null)
    try {
      const bytes = await exportPdf(state.doc.pdfBytes, state.doc.pages, state.doc.annotations)
      const url = URL.createObjectURL(new Blob([copyBytes(bytes)], { type: 'application/pdf' }))
      const link = document.createElement('a')
      link.href = url
      link.download = editedFileName(state.doc.fileName)
      link.click()
      URL.revokeObjectURL(url)
      state.markClean()
    } catch (error) {
      state.setError(error instanceof Error ? error.message : 'Could not build the PDF.')
    } finally {
      state.setExporting(false)
    }
  }

  async function addImage(file: File | undefined) {
    if (!file) return
    const state = useEditorStore.getState()
    const pdf = getPdfDocument()
    const pageRef = state.doc?.pages.find((page) => page.id === state.currentPageId)
    if (!pdf || !pageRef) return
    try {
      const image = await readImageFile(file)
      const pdfPage = await pdf.getPage(pageRef.sourceIndex + 1)
      const viewport = pdfPage.getViewport({
        scale: 1,
        rotation: totalRotation(pdfPage.rotate, pageRef.rotation),
      })
      const cssW = Math.min(220, viewport.width * 0.5)
      const cssH = cssW * (image.height / Math.max(1, image.width))
      const left = Math.max(0, (viewport.width - cssW) / 2)
      const top = Math.min(72, Math.max(0, viewport.height - cssH - 36))
      const rect = screenRectToPdf(viewport, { left, top, width: cssW, height: cssH })
      state.addAnnotation({
        id: crypto.randomUUID(),
        type: 'image',
        pageId: pageRef.id,
        ...rect,
        bytes: image.bytes,
        mime: image.mime,
      })
    } catch (error) {
      state.setError(error instanceof Error ? error.message : 'Could not add that image.')
    }
  }

  return (
    <header className="toolbar">
      <div className="toolbar-row">
        <button type="button" onClick={onOpen}>
          Open
        </button>
        <span className="file-name" title={doc.fileName}>
          {doc.fileName}
        </span>
        <span className="toolbar-gap" />
        {TOOLS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={tool === item.id ? 'active' : ''}
            aria-pressed={tool === item.id}
            onClick={() => {
              if (item.id === 'image') {
                setTool('image')
                imageRef.current?.click()
                return
              }
              if (item.id === 'sign') {
                setTool('sign')
                if (!useEditorStore.getState().signature) setSignatureOpen(true)
                return
              }
              setTool(item.id)
            }}
          >
            {item.label}
          </button>
        ))}
        <input
          ref={imageRef}
          type="file"
          accept="image/png,image/jpeg"
          hidden
          onChange={(event) => {
            void addImage(event.target.files?.[0])
            event.target.value = ''
          }}
        />
        <span className="toolbar-gap" />
        <button type="button" onClick={undo} disabled={past === 0 && !gestureDirty}>
          Undo
        </button>
        <button type="button" onClick={redo} disabled={future === 0 || gestureDirty}>
          Redo
        </button>
        <span className="toolbar-gap" />
        <button type="button" aria-label="Zoom out" onClick={() => setZoom(clampZoom(zoom / 1.1))}>
          −
        </button>
        <span className="zoom-label">{Math.round(zoom * 100)}%</span>
        <button type="button" aria-label="Zoom in" onClick={() => setZoom(clampZoom(zoom * 1.1))}>
          +
        </button>
        <span className="toolbar-gap" />
        <button
          type="button"
          aria-label="Previous page"
          disabled={index <= 0}
          onClick={() => {
            const previous = pages[index - 1]
            if (previous) setCurrentPage(previous.id)
          }}
        >
          Prev
        </button>
        <span className="page-label">{pages.length === 0 ? '0 / 0' : `${Math.max(index, 0) + 1} / ${pages.length}`}</span>
        <button
          type="button"
          aria-label="Next page"
          disabled={index < 0 || index >= pages.length - 1}
          onClick={() => {
            const next = pages[index + 1]
            if (next) setCurrentPage(next.id)
          }}
        >
          Next
        </button>
        <span className="toolbar-gap" />
        <button
          type="button"
          className="primary"
          onClick={() => void download()}
          disabled={exporting || pages.length === 0}
          aria-busy={exporting}
        >
          {exporting ? 'Preparing…' : 'Download'}
        </button>
      </div>
      <Properties />
    </header>
  )
}

function Properties() {
  const tool = useEditorStore((state) => state.tool)
  const selectedId = useEditorStore((state) => state.selectedId)
  const annotations = useEditorStore((state) => state.doc?.annotations ?? [])
  const textDefaults = useEditorStore((state) => state.textDefaults)
  const pageText = useEditorStore((state) => state.pageText)
  const inkDefaults = useEditorStore((state) => state.inkDefaults)
  const highlightColor = useEditorStore((state) => state.highlightColor)
  const cutShape = useEditorStore((state) => state.cutShape)
  const setCutShape = useEditorStore((state) => state.setCutShape)
  const signature = useEditorStore((state) => state.signature)
  const selected = annotations.find((annotation) => annotation.id === selectedId) ?? null
  const removeSelected = useEditorStore((state) => state.removeSelected)

  const showText = selected?.type === 'text' || (!selected && tool === 'text')
  const showHighlight = selected?.type === 'highlight' || (!selected && tool === 'highlight')
  const showInk = selected?.type === 'ink' || (!selected && tool === 'ink')
  const showSign = tool === 'sign'
  const showCut = !selected && tool === 'cut'

  const textSize = selected?.type === 'text' ? selected.fontSize : textDefaults.fontSize
  const textFont = selected?.type === 'text' ? selected.font : textDefaults.font
  const selectionStyle = useSelectionStyle()
  const textColor = selectionStyle?.color || (selected?.type === 'text' ? '' : textDefaults.color)
  const boldOn = selectionStyle?.bold ?? (selected?.type !== 'text' && fontIsBold(textFont))
  const italicOn = selectionStyle?.italic ?? (selected?.type !== 'text' && fontIsItalic(textFont))
  const underlineOn = selectionStyle?.underline ?? (selected?.type !== 'text' && textDefaults.underline)
  const inkWidth = selected?.type === 'ink' ? selected.strokeWidth : inkDefaults.strokeWidth
  const inkColor = selected?.type === 'ink' ? selected.color : inkDefaults.color
  const activeHighlight = selected?.type === 'highlight' ? selected.color : highlightColor

  return (
    <div className="properties">
      {showText ? (
        <>
          <label>
            Font
            <select
              value={fontFamilyOf(textFont)}
              onChange={(event) => {
                const family = event.target.value as 'Helvetica' | 'Times' | 'Courier'
                const keepStyle = selected?.type === 'text'
                applyText({
                  font: composeFont(family, keepStyle ? false : fontIsBold(textFont), keepStyle ? false : fontIsItalic(textFont)),
                })
              }}
            >
              {PDF_FONT_FAMILIES.map((font) => (
                <option key={font.id} value={font.id}>
                  {font.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className={boldOn ? 'style-toggle active' : 'style-toggle'}
            aria-pressed={boldOn}
            title="Bold the selected words"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => toggleStyle('bold')}
          >
            Bold
          </button>
          <button
            type="button"
            className={italicOn ? 'style-toggle italic active' : 'style-toggle italic'}
            aria-pressed={italicOn}
            title="Italicize the selected words"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => toggleStyle('italic')}
          >
            Italic
          </button>
          <button
            type="button"
            className={underlineOn ? 'style-toggle underline active' : 'style-toggle underline'}
            aria-pressed={underlineOn}
            title="Underline the selected words"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => toggleStyle('underline')}
          >
            Underline
          </button>
          <label>
            Size
            <input
              type="number"
              min={8}
              max={96}
              value={textSize}
              onFocus={() => useEditorStore.getState().beginGesture()}
              onBlur={() => useEditorStore.getState().endGesture()}
              onChange={(event) => {
                const fontSize = clampNumber(Number(event.target.value), 8, 96)
                applyText({ fontSize })
              }}
            />
          </label>
          <Swatches
            colors={TEXT_COLORS}
            value={textColor}
            keepSelection
            onChange={applyTextColor}
          />
          <EyeDropperButton keepSelection onPick={applyTextColor} />
          {!selected && pageText === 'no' ? <span className="hint">This page has no text layer.</span> : null}
          {!selected && pageText === 'yes' ? (
            <span className="hint">Drag across a few words or several lines. Click a line to edit all of it.</span>
          ) : null}
          {selected?.type === 'text' ? <span className="hint">Select words, then use Bold, Italic, Underline, or a color.</span> : null}
        </>
      ) : null}
      {showHighlight ? (
        <Swatches colors={HIGHLIGHT_COLORS} value={activeHighlight} onChange={applyHighlight} />
      ) : null}
      {showInk ? (
        <>
          <label>
            Width
            <input
              type="number"
              min={1}
              max={16}
              value={inkWidth}
              onFocus={() => useEditorStore.getState().beginGesture()}
              onBlur={() => useEditorStore.getState().endGesture()}
              onChange={(event) => {
                const strokeWidth = clampNumber(Number(event.target.value), 1, 16)
                applyInk({ strokeWidth })
              }}
            />
          </label>
          <Swatches colors={INK_COLORS} value={inkColor} onChange={(color) => applyInk({ color })} />
          <EyeDropperButton onPick={(color) => applyInk({ color })} />
        </>
      ) : null}
      {showSign ? (
        <span className="hint">
          {signature ? 'Click the page to place your signature.' : 'Create a signature, then click the page.'}
        </span>
      ) : null}
      {showSign ? (
        <button type="button" onClick={() => useEditorStore.getState().setSignatureOpen(true)}>
          New signature
        </button>
      ) : null}
      {showCut ? (
        <>
          <button
            type="button"
            className={cutShape === 'rect' ? 'style-toggle active' : 'style-toggle'}
            aria-pressed={cutShape === 'rect'}
            onClick={() => setCutShape('rect')}
          >
            Rectangle
          </button>
          <button
            type="button"
            className={cutShape === 'circle' ? 'style-toggle active' : 'style-toggle'}
            aria-pressed={cutShape === 'circle'}
            onClick={() => setCutShape('circle')}
          >
            Circle
          </button>
          <span className="hint">Drag to lift that patch, then move it.</span>
        </>
      ) : null}
      {selected ? (
        <button type="button" onClick={removeSelected}>
          Remove
        </button>
      ) : null}
      {!showText && !showHighlight && !showInk && !showSign && !showCut && !selected ? (
        <span className="hint">New text uses the standard PDF fonts. Highlights are rectangles.</span>
      ) : null}
    </div>
  )
}

function EyeDropperButton({
  keepSelection = false,
  onPick,
}: {
  keepSelection?: boolean
  onPick: (color: string) => void
}) {
  if (!canPickColor()) return null
  return (
    <button
      type="button"
      className="eyedropper"
      title="Pick a color from the page"
      onMouseDown={keepSelection ? (event) => event.preventDefault() : undefined}
      onClick={() => void pickScreenColor(onPick)}
    >
      Pick
    </button>
  )
}

async function pickScreenColor(apply: (color: string) => void) {
  const Dropper = (window as EyedropperWindow).EyeDropper
  if (!Dropper) return
  try {
    const result = await new Dropper().open()
    apply(result.sRGBHex)
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return
    console.error(error)
  }
}

function canPickColor(): boolean {
  return typeof (window as EyedropperWindow).EyeDropper === 'function'
}

type EyedropperWindow = Window & {
  EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> }
}

function Swatches({
  colors,
  value,
  onChange,
  keepSelection = false,
}: {
  colors: readonly string[]
  value: string
  onChange: (color: string) => void
  keepSelection?: boolean
}) {
  return (
    <div className="swatches">
      {colors.map((color) => (
        <button
          key={color}
          type="button"
          className={color === value ? 'swatch active' : 'swatch'}
          style={{ background: color }}
          aria-label={`Color ${color}`}
          aria-pressed={color === value}
          onMouseDown={keepSelection ? (event) => event.preventDefault() : undefined}
          onClick={() => onChange(color)}
        />
      ))}
    </div>
  )
}

function applyText(patch: { fontSize?: number; color?: string; font?: PdfFontId; underline?: boolean }) {
  const { selectedId, doc, updateAnnotation, patchAnnotation, setTextDefaults, gesture } = useEditorStore.getState()
  setTextDefaults(patch)
  const selected = doc?.annotations.find((annotation) => annotation.id === selectedId)
  if (selected?.type !== 'text') return
  const annotationPatch: { fontSize?: number; color?: string; font?: PdfFontId } = {}
  if (patch.fontSize !== undefined) annotationPatch.fontSize = patch.fontSize
  if (patch.font !== undefined) annotationPatch.font = patch.font
  const recipe = (annotation: Annotation) =>
    annotation.type === 'text' ? { ...annotation, ...annotationPatch } : annotation
  if (gesture) patchAnnotation(selected.id, recipe)
  else updateAnnotation(selected.id, recipe)
}

function applyTextColor(color: string) {
  const formatted = formatActiveColor(color)
  if (formatted) {
    const { gesture, patchAnnotation, updateAnnotation } = useEditorStore.getState()
    const recipe = (annotation: Annotation) =>
      annotation.type === 'text' && annotation.id === formatted.id ? { ...annotation, runs: formatted.runs } : annotation
    if (gesture) patchAnnotation(formatted.id, recipe)
    else updateAnnotation(formatted.id, recipe)
    return
  }
  const selected = useEditorStore.getState().doc?.annotations.find((annotation) => annotation.id === useEditorStore.getState().selectedId)
  if (selected?.type === 'text') return
  applyText({ color })
}

function toggleStyle(key: StyleKey) {
  const formatted = formatActiveSelection(key)
  if (formatted) {
    const { gesture, patchAnnotation, updateAnnotation } = useEditorStore.getState()
    const recipe = (annotation: Annotation) =>
      annotation.type === 'text' && annotation.id === formatted.id ? { ...annotation, runs: formatted.runs } : annotation
    if (gesture) patchAnnotation(formatted.id, recipe)
    else updateAnnotation(formatted.id, recipe)
    return
  }
  const { doc, selectedId } = useEditorStore.getState()
  const selected = doc?.annotations.find((annotation) => annotation.id === selectedId)
  if (selected?.type === 'text') return
  const defaults = useEditorStore.getState().textDefaults
  if (key === 'underline') {
    applyText({ underline: !defaults.underline })
    return
  }
  const family = fontFamilyOf(defaults.font)
  const bold = key === 'bold' ? !fontIsBold(defaults.font) : fontIsBold(defaults.font)
  const italic = key === 'italic' ? !fontIsItalic(defaults.font) : fontIsItalic(defaults.font)
  applyText({ font: composeFont(family, bold, italic) })
}

function useSelectionStyle() {
  const [style, setStyle] = useState(activeSelectionStyle())
  useEffect(() => {
    const update = () => setStyle(activeSelectionStyle())
    document.addEventListener('selectionchange', update)
    return () => document.removeEventListener('selectionchange', update)
  }, [])
  return style
}

function applyInk(patch: { strokeWidth?: number; color?: string }) {
  const { selectedId, doc, updateAnnotation, patchAnnotation, setInkDefaults, gesture } = useEditorStore.getState()
  setInkDefaults(patch)
  const selected = doc?.annotations.find((annotation) => annotation.id === selectedId)
  if (selected?.type !== 'ink') return
  const recipe = (annotation: Annotation) =>
    annotation.type === 'ink' ? { ...annotation, ...patch } : annotation
  if (gesture) patchAnnotation(selected.id, recipe)
  else updateAnnotation(selected.id, recipe)
}

function applyHighlight(color: string) {
  const { selectedId, doc, updateAnnotation, setHighlightColor } = useEditorStore.getState()
  setHighlightColor(color)
  const selected = doc?.annotations.find((annotation) => annotation.id === selectedId)
  if (selected?.type !== 'highlight') return
  updateAnnotation(selected.id, (annotation) =>
    annotation.type === 'highlight' ? { ...annotation, color } : annotation,
  )
}

function clampNumber(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min
  return Math.min(max, Math.max(min, value))
}
