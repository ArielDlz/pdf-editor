import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import type { PageViewport } from 'pdfjs-dist'
import {
  HANDLES,
  localPoint,
  pdfRectToScreen,
  pointsBounds,
  resizeScreenRect,
  scalePoints,
  screenDeltaToPdf,
  screenRectToPdf,
  type Handle,
  type ScreenRect,
} from '../lib/geometry'
import { canvasToPng, copyBytes } from '../lib/images'
import { composeFont, fontFamilyOf, pdfFontFace } from '../pdf/fonts'
import { cropPageRegion } from '../pdf/pdfjs'
import { lineAtPoint, loadTextLines, runsForPieces, stripsInRect, type TextStrip } from '../pdf/textLines'
import { paintRuns, plainText, runsFromDom, textRun, type TextStyle } from '../pdf/textRuns'
import { useEditorStore } from '../store/editorStore'
import { cloneAnnotation, type Annotation, type Point, type TextRun } from '../types'

const TEXT_PAD = 4

export function AnnotationLayer({
  viewport,
  frameRef,
}: {
  viewport: PageViewport
  frameRef: RefObject<HTMLDivElement | null>
}) {
  const annotations = useEditorStore((state) => state.doc?.annotations ?? [])
  const currentPageId = useEditorStore((state) => state.currentPageId)
  const tool = useEditorStore((state) => state.tool)
  const selectedId = useEditorStore((state) => state.selectedId)
  const editingId = useEditorStore((state) => state.editingId)
  const highlightColor = useEditorStore((state) => state.highlightColor)
  const cutShape = useEditorStore((state) => state.cutShape)
  const inkDefaults = useEditorStore((state) => state.inkDefaults)
  const [preview, setPreview] = useState<ScreenRect | null>(null)
  const [inkPreview, setInkPreview] = useState<Point[] | null>(null)
  const stopDrag = useRef<(() => void) | null>(null)
  const textClick = useRef(0)
  const cutClick = useRef(0)
  const sessionId = useEditorStore((state) => state.doc?.sessionId)
  const sourceIndex = useEditorStore(
    (state) => state.doc?.pages.find((item) => item.id === state.currentPageId)?.sourceIndex,
  )

  useEffect(() => () => stopDrag.current?.(), [])

  useEffect(() => {
    if (!sessionId || sourceIndex === undefined) return
    let cancelled = false
    useEditorStore.getState().setPageText('unknown')
    void loadTextLines(sessionId, sourceIndex)
      .then((lines) => {
        if (!cancelled) useEditorStore.getState().setPageText(lines.length > 0 ? 'yes' : 'no')
      })
      .catch((error: unknown) => {
        console.error(error)
        if (!cancelled) useEditorStore.getState().setPageText('no')
      })
    return () => {
      cancelled = true
    }
  }, [sessionId, sourceIndex])

  const pageAnnotations = annotations.filter((annotation) => annotation.pageId === currentPageId)
  const drawing = tool === 'highlight' || tool === 'ink' || tool === 'text' || tool === 'sign' || tool === 'cut'

  function pdfPoint(local: Point): Point {
    const [x, y] = viewport.convertToPdfPoint(local.x, local.y)
    return { x: Number(x), y: Number(y) }
  }

  function placeText(local: Point, createIfMiss: boolean) {
    const pageId = currentPageId
    const doc = useEditorStore.getState().doc
    const page = doc?.pages.find((item) => item.id === pageId)
    if (!doc || !page || !pageId) return
    const token = ++textClick.current
    void (async () => {
      const lines = await loadTextLines(doc.sessionId, page.sourceIndex).catch((error: unknown) => {
        console.error(error)
        return []
      })
      if (textClick.current !== token || useEditorStore.getState().currentPageId !== pageId) return
      const hit = lineAtPoint(lines, viewport, local)
      if (hit) {
        const keys = hit.pieces.map((piece) => piece.key)
        const existing = findCover(pageId, keys)
        if (existing) {
          useEditorStore.setState({ selectedId: existing.id, editingId: existing.id, tool: 'select' })
          return
        }
        const { textDefaults, addAnnotation } = useEditorStore.getState()
        const runs = runsForPieces(hit.pieces, textDefaults.underline)
        addAnnotation({
          id: crypto.randomUUID(),
          type: 'text',
          pageId,
          x: hit.x,
          y: hit.y,
          width: hit.width,
          height: hit.height,
          fontSize: hit.fontSize,
          font: composeFont(fontFamilyOf(hit.font), false, false),
          color: runs.find((run) => run.text.trim())?.color ?? textDefaults.color,
          runs,
          cover: true,
          covers: [{ x: hit.x, y: hit.y, width: hit.width, height: hit.height }],
          sourceKey: hit.key,
          sourceKeys: keys,
        })
        return
      }
      if (!createIfMiss) return
      const { textDefaults, addAnnotation } = useEditorStore.getState()
      const cssW = 200 * viewport.scale
      const cssH = (textDefaults.fontSize * 1.2 + TEXT_PAD * 2) * viewport.scale
      const left = clamp(local.x, 0, Math.max(0, viewport.width - cssW))
      const top = clamp(local.y, 0, Math.max(0, viewport.height - cssH))
      const rect = screenRectToPdf(viewport, { left, top, width: cssW, height: cssH })
      addAnnotation({
        id: crypto.randomUUID(),
        type: 'text',
        pageId,
        ...rect,
        fontSize: textDefaults.fontSize,
        font: composeFont(fontFamilyOf(textDefaults.font), false, false),
        color: textDefaults.color,
        runs: [textRun('', textDefaults.font, textDefaults.underline, textDefaults.color)],
        cover: false,
        covers: [],
        sourceKey: null,
        sourceKeys: [],
      })
    })()
  }

  function selectTextArea(rect: ScreenRect) {
    const pageId = currentPageId
    const doc = useEditorStore.getState().doc
    const page = doc?.pages.find((item) => item.id === pageId)
    if (!doc || !page || !pageId) return
    const token = ++textClick.current
    void (async () => {
      const lines = await loadTextLines(doc.sessionId, page.sourceIndex).catch((error: unknown) => {
        console.error(error)
        return []
      })
      if (textClick.current !== token || useEditorStore.getState().currentPageId !== pageId) return
      const strips = stripsInRect(lines, viewport, rect)
      if (strips.length === 0) return
      const keys = strips.flatMap((strip) => strip.sourceKeys)
      const { textDefaults, placeTextCover } = useEditorStore.getState()
      const box = unionStrips(strips)
      const sample = strips.reduce((best, strip) => (strip.width > best.width ? strip : best))
      const runs = coverRuns(strips, textDefaults.underline)
      const replaceIds = coversTouching(pageId, keys).map((annotation) => annotation.id)
      placeTextCover(
        {
          id: crypto.randomUUID(),
          type: 'text',
          pageId,
          ...box,
          fontSize: sample.fontSize,
          font: composeFont(fontFamilyOf(sample.font), false, false),
          color: runs.find((run) => run.text.trim())?.color ?? textDefaults.color,
          runs,
          cover: true,
          covers: strips.map((strip) => ({ x: strip.x, y: strip.y, width: strip.width, height: strip.height })),
          sourceKey: null,
          sourceKeys: keys,
        },
        replaceIds,
      )
    })()
  }

  function startTextDrag(origin: Point, clickEditsLine: boolean) {
    let moved = false
    const move = (pointer: globalThis.PointerEvent) => {
      if (!frameRef.current) return
      const current = clampPoint(localPoint(pointer, frameRef.current), viewport.width, viewport.height)
      const rect = rectFromPoints(origin, current)
      if (rect.width < 4 && rect.height < 4) return
      moved = true
      setPreview(rect)
    }
    const up = (pointer: globalThis.PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setPreview(null)
      if (!frameRef.current) return
      const current = clampPoint(localPoint(pointer, frameRef.current), viewport.width, viewport.height)
      const rect = rectFromPoints(origin, current)
      if (!moved || (rect.width < 4 && rect.height < 4)) {
        if (clickEditsLine) placeText(origin, true)
        return
      }
      selectTextArea(rect)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  function placeSignature(local: Point) {
    const { signature, setSignatureOpen, addAnnotation } = useEditorStore.getState()
    if (!signature) {
      setSignatureOpen(true)
      return
    }
    if (!currentPageId) return
    const pageWidth = viewport.width / viewport.scale
    const boxW = Math.min(180, pageWidth * 0.45)
    const boxH = boxW * (signature.height / Math.max(1, signature.width))
    const cssW = boxW * viewport.scale
    const cssH = boxH * viewport.scale
    const left = clamp(local.x - cssW / 2, 0, Math.max(0, viewport.width - cssW))
    const top = clamp(local.y - cssH / 2, 0, Math.max(0, viewport.height - cssH))
    const rect = screenRectToPdf(viewport, { left, top, width: cssW, height: cssH })
    addAnnotation({
      id: crypto.randomUUID(),
      type: 'signature',
      pageId: currentPageId,
      ...rect,
      bytes: signature.bytes,
      mime: 'image/png',
    })
  }

  function onDrawDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || !frameRef.current || !currentPageId) return
    event.stopPropagation()
    const local = localPoint(event, frameRef.current)
    if (tool === 'text') {
      startTextDrag(local, true)
      event.stopPropagation()
      return
    }
    if (tool === 'sign') {
      placeSignature(local)
      return
    }
    if (tool === 'highlight') {
      const origin = local
      setPreview({ left: origin.x, top: origin.y, width: 0, height: 0 })
      event.currentTarget.setPointerCapture(event.pointerId)
      const move = (pointer: globalThis.PointerEvent) => {
        if (!frameRef.current) return
        const current = clampPoint(localPoint(pointer, frameRef.current), viewport.width, viewport.height)
        setPreview(rectFromPoints(origin, current))
      }
      const up = (pointer: globalThis.PointerEvent) => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        setPreview(null)
        if (!frameRef.current) return
        const current = clampPoint(localPoint(pointer, frameRef.current), viewport.width, viewport.height)
        const rect = rectFromPoints(origin, current)
        if (rect.width < 4 || rect.height < 4) return
        const pdf = screenRectToPdf(viewport, rect)
        useEditorStore.getState().addAnnotation({
          id: crypto.randomUUID(),
          type: 'highlight',
          pageId: currentPageId,
          ...pdf,
          color: useEditorStore.getState().highlightColor,
        })
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
      return
    }
    if (tool === 'cut') {
      const origin = local
      const shape = useEditorStore.getState().cutShape
      const pageId = currentPageId
      const token = ++cutClick.current
      setPreview({ left: origin.x, top: origin.y, width: 0, height: 0 })
      event.currentTarget.setPointerCapture(event.pointerId)
      const move = (pointer: globalThis.PointerEvent) => {
        if (!frameRef.current) return
        const current = clampPoint(localPoint(pointer, frameRef.current), viewport.width, viewport.height)
        setPreview(rectFromPoints(origin, current))
      }
      const up = (pointer: globalThis.PointerEvent) => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        setPreview(null)
        if (!frameRef.current) return
        const current = clampPoint(localPoint(pointer, frameRef.current), viewport.width, viewport.height)
        const rect = rectFromPoints(origin, current)
        if (rect.width < 8 || rect.height < 8) return
        const pdf = screenRectToPdf(viewport, rect)
        const page = useEditorStore.getState().doc?.pages.find((item) => item.id === pageId)
        if (!page) return
        void cropPageRegion(page.sourceIndex, viewport.rotation, pdf, shape)
          .then(async (canvas) => {
            if (!canvas || cutClick.current !== token || useEditorStore.getState().currentPageId !== pageId) return
            const bytes = await canvasToPng(canvas)
            if (cutClick.current !== token || useEditorStore.getState().currentPageId !== pageId) return
            useEditorStore.getState().addCut(
              {
                id: crypto.randomUUID(),
                type: 'cover',
                pageId,
                ...pdf,
                shape,
              },
              {
                id: crypto.randomUUID(),
                type: 'image',
                pageId,
                ...pdf,
                bytes,
                mime: 'image/png',
              },
            )
          })
          .catch((error: unknown) => {
            console.error(error)
          })
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
      return
    }
    if (tool === 'ink') {
      const points = [pdfPoint(local)]
      setInkPreview(points)
      event.currentTarget.setPointerCapture(event.pointerId)
      let last = local
      const move = (pointer: globalThis.PointerEvent) => {
        if (!frameRef.current) return
        const current = localPoint(pointer, frameRef.current)
        if (Math.hypot(current.x - last.x, current.y - last.y) < 1.5) return
        last = current
        points.push(pdfPoint(current))
        setInkPreview([...points])
      }
      const up = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        setInkPreview(null)
        if (points.length < 2) return
        const { inkDefaults, addAnnotation } = useEditorStore.getState()
        addAnnotation({
          id: crypto.randomUUID(),
          type: 'ink',
          pageId: currentPageId,
          points: points.map((point) => ({ ...point })),
          color: inkDefaults.color,
          strokeWidth: inkDefaults.strokeWidth,
        })
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    }
  }

  function startMove(event: ReactPointerEvent, annotation: Annotation) {
    if (tool !== 'select' || event.button !== 0) return
    if (editingId === annotation.id) return
    event.stopPropagation()
    const { select, beginGesture, patchAnnotation, endGesture } = useEditorStore.getState()
    select(annotation.id)
    beginGesture()
    const original = cloneAnnotation(annotation)
    const startX = event.clientX
    const startY = event.clientY
    const move = (pointer: globalThis.PointerEvent) => {
      const delta = screenDeltaToPdf(viewport, pointer.clientX - startX, pointer.clientY - startY)
      patchAnnotation(annotation.id, () => translate(original, delta.x, delta.y))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      stopDrag.current = null
      endGesture()
    }
    stopDrag.current = up
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  function startResize(event: ReactPointerEvent, annotation: Annotation, handle: Handle) {
    if (event.button !== 0) return
    event.stopPropagation()
    const { select, beginGesture, patchAnnotation, endGesture } = useEditorStore.getState()
    select(annotation.id)
    beginGesture()
    const original = cloneAnnotation(annotation)
    const startScreen = screenBox(viewport, original)
    const startX = event.clientX
    const startY = event.clientY
    const move = (pointer: globalThis.PointerEvent) => {
      const nextScreen = resizeScreenRect(
        startScreen,
        handle,
        pointer.clientX - startX,
        pointer.clientY - startY,
      )
      const nextPdf = screenRectToPdf(viewport, nextScreen)
      patchAnnotation(annotation.id, () => resize(original, nextPdf))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      stopDrag.current = null
      endGesture()
    }
    stopDrag.current = up
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const ordered = [...pageAnnotations].sort((a, b) => {
    if (a.id === selectedId) return 1
    if (b.id === selectedId) return -1
    return 0
  })

  return (
    <div
      className="annotation-layer"
      onPointerDown={(event) => {
        if (tool !== 'select' || event.button !== 0 || !frameRef.current) return
        const target = event.target
        if (target instanceof Element && target.closest('.ann, textarea, input, [data-rich-text]')) return
        startTextDrag(localPoint(event, frameRef.current), false)
      }}
      onDoubleClick={(event) => {
        if (tool !== 'select' || !frameRef.current) return
        const target = event.target
        if (target instanceof Element && target.closest('.ann, textarea, input')) return
        placeText(localPoint(event, frameRef.current), false)
      }}
    >
      {ordered.map((annotation) => (
        <AnnotationView
          key={annotation.id}
          annotation={annotation}
          viewport={viewport}
          selected={annotation.id === selectedId && tool === 'select'}
          editing={annotation.id === editingId}
          selectable={tool === 'select'}
          onMove={(event) => startMove(event, annotation)}
          onResize={(event, handle) => startResize(event, annotation, handle)}
        />
      ))}
      {inkPreview ? (
        <InkSvg
          viewport={viewport}
          points={inkPreview}
          color={inkDefaults.color}
          strokeWidth={inkDefaults.strokeWidth}
          interactive={false}
        />
      ) : null}
      {preview && tool === 'text' ? <div className="text-preview" style={boxStyle(preview)} /> : null}
      {preview && tool === 'cut' ? (
        <div className={cutShape === 'circle' ? 'cut-preview circle' : 'cut-preview'} style={boxStyle(preview)} />
      ) : null}
      {preview && tool !== 'text' && tool !== 'cut' ? (
        <div className="highlight-preview" style={{ ...boxStyle(preview), background: highlightColor }} />
      ) : null}
      {drawing ? (
        <div
          className="draw-layer"
          style={{ cursor: tool === 'text' ? 'text' : 'crosshair' }}
          onPointerDown={onDrawDown}
        />
      ) : null}
    </div>
  )
}

function AnnotationView({
  annotation,
  viewport,
  selected,
  selectable,
  editing,
  onMove,
  onResize,
}: {
  annotation: Annotation
  viewport: PageViewport
  selected: boolean
  selectable: boolean
  editing: boolean
  onMove: (event: ReactPointerEvent) => void
  onResize: (event: ReactPointerEvent, handle: Handle) => void
}) {
  if (annotation.type === 'ink') {
    return (
      <>
        <InkSvg
          viewport={viewport}
          points={annotation.points}
          color={annotation.color}
          strokeWidth={annotation.strokeWidth}
          interactive={selected || selectable}
          onPointerDown={onMove}
        />
        {selected ? (
          <Box
            viewport={viewport}
            rect={pointsBounds(annotation.points)}
            className="ann-ink-box"
            onPointerDown={(event) => event.stopPropagation()}
            onResize={onResize}
          />
        ) : null}
      </>
    )
  }

  const rect = { x: annotation.x, y: annotation.y, width: annotation.width, height: annotation.height }
  const textCover = annotation.type === 'text' && annotation.cover
  const singleCover = textCover && annotation.covers.length <= 1
  const hole = annotation.type === 'cover'
  return (
    <Box
      viewport={viewport}
      rect={rect}
      className={['ann', `ann-${annotation.type}`, textCover ? 'ann-cover' : '', singleCover ? 'ann-cover-line' : '', textCover && !singleCover ? 'ann-cover-block' : '', hole ? 'ann-hole' : '', hole && annotation.shape === 'circle' ? 'circle' : '', selected ? 'ann-selected' : ''].filter(Boolean).join(' ')}
      annotation={annotation}
      editing={editing}
      onPointerDown={onMove}
      onResize={selected ? onResize : undefined}
    />
  )
}

function Box({
  viewport,
  rect,
  className,
  annotation,
  editing,
  onPointerDown,
  onResize,
}: {
  viewport: PageViewport
  rect: { x: number; y: number; width: number; height: number }
  className: string
  annotation?: Annotation
  editing?: boolean
  onPointerDown: (event: ReactPointerEvent) => void
  onResize?: (event: ReactPointerEvent, handle: Handle) => void
}) {
  const screen = pdfRectToScreen(viewport, rect)
  const setEditingId = useEditorStore((state) => state.setEditingId)
  const patchAnnotation = useEditorStore((state) => state.patchAnnotation)
  const beginGesture = useEditorStore((state) => state.beginGesture)
  const endGesture = useEditorStore((state) => state.endGesture)
  const textRef = useRef<HTMLDivElement>(null)
  const painted = useRef<string>('')

  useEffect(() => {
    if (!editing) return
    const id = window.setTimeout(() => textRef.current?.focus(), 0)
    return () => window.clearTimeout(id)
  }, [editing])

  useEffect(() => {
    const node = textRef.current
    if (!node || annotation?.type !== 'text') return
    const signature = JSON.stringify(annotation.runs)
    if (node.dataset.skipPaint === 'true') {
      delete node.dataset.skipPaint
      painted.current = signature
      return
    }
    if (painted.current === signature && node.childNodes.length > 0) return
    paintRuns(node, annotation.runs)
    painted.current = signature
  }, [annotation, editing])

  const style = boxStyle(screen)
  if (annotation?.type === 'text') {
    const face = pdfFontFace(composeFont(fontFamilyOf(annotation.font), false, false))
    style.color = annotation.color
    style.fontSize = `${annotation.fontSize * viewport.scale}px`
    style.fontFamily = face.family
    style.fontWeight = 400
    style.fontStyle = 'normal'
    style['--pad'] = `${(annotation.cover ? 0.75 : TEXT_PAD) * viewport.scale}px`
  }
  if (annotation?.type === 'text' && annotation.covers.length > 1) {
    const tops = annotation.covers.map((strip) => pdfRectToScreen(viewport, strip).top)
    const step = tops[1] - tops[0]
    if (step > 1) style.lineHeight = `${step}px`
  }
  if (annotation?.type === 'highlight') {
    style.background = annotation.color
  }

  return (
    <div
      className={className}
      style={style}
      data-annotation-id={annotation?.id}
      onPointerDown={onPointerDown}
      onDoubleClick={(event) => {
        if (annotation?.type !== 'text') return
        event.stopPropagation()
        setEditingId(annotation.id)
      }}
    >
      {annotation?.type === 'text'
        ? annotation.covers.map((strip, index) => {
            const stripScreen = pdfRectToScreen(viewport, strip)
            return (
              <span
                key={`${strip.x}:${strip.y}:${index}`}
                className="ann-cover-strip"
                style={{
                  left: stripScreen.left - screen.left,
                  top: stripScreen.top - screen.top,
                  width: stripScreen.width,
                  height: stripScreen.height,
                }}
              />
            )
          })
        : null}
      {annotation?.type === 'text' ? (
        <div
          ref={textRef}
          className={plainText(annotation.runs) ? 'rich-text' : 'rich-text placeholder'}
          data-rich-text="true"
          data-annotation-id={annotation.id}
          data-fallback-bold={String(annotation.runs[0]?.bold ?? false)}
          data-fallback-italic={String(annotation.runs[0]?.italic ?? false)}
          data-fallback-underline={String(annotation.runs[0]?.underline ?? false)}
          data-fallback-color={annotation.runs[0]?.color ?? annotation.color}
          contentEditable={editing}
          role="textbox"
          aria-multiline="true"
          suppressContentEditableWarning
          onPointerDown={(event) => {
            if (editing) event.stopPropagation()
          }}
          onFocus={() => beginGesture()}
          onBlur={() => endGesture()}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return
            event.preventDefault()
            document.execCommand('insertText', false, '\n')
          }}
          onInput={() => {
            const node = textRef.current
            if (!node) return
            const fallback: TextStyle = {
              bold: annotation.runs[0]?.bold ?? false,
              italic: annotation.runs[0]?.italic ?? false,
              underline: annotation.runs[0]?.underline ?? false,
              color: annotation.runs[0]?.color ?? annotation.color,
            }
            const runs = runsFromDom(node, fallback)
            paintRuns(node, runs)
            painted.current = JSON.stringify(runs)
            node.dataset.skipPaint = 'true'
            patchAnnotation(annotation.id, (current) => (current.type === 'text' ? { ...current, runs } : current))
          }}
        />
      ) : null}
      {annotation?.type === 'image' || annotation?.type === 'signature' ? (
        <AnnotationImage
          bytes={annotation.bytes}
          mime={annotation.mime}
          alt={annotation.type === 'signature' ? 'Signature' : 'Placed image'}
        />
      ) : null}
      {onResize
        ? HANDLES.map((handle) => (
            <span
              key={handle}
              className={`handle handle-${handle}`}
              onPointerDown={(event) => onResize(event, handle)}
            />
          ))
        : null}
    </div>
  )
}

function InkSvg({
  viewport,
  points,
  color,
  strokeWidth,
  interactive,
  onPointerDown,
}: {
  viewport: PageViewport
  points: Point[]
  color: string
  strokeWidth: number
  interactive: boolean
  onPointerDown?: (event: ReactPointerEvent) => void
}) {
  const drawn = points
    .map((point) => {
      const [x, y] = viewport.convertToViewportPoint(point.x, point.y)
      return `${x},${y}`
    })
    .join(' ')
  const width = Math.max(strokeWidth * viewport.scale, 1.5)
  return (
    <svg className="ink-svg" width={viewport.width} height={viewport.height} aria-hidden={!interactive}>
      <polyline
        points={drawn}
        fill="none"
        stroke="transparent"
        strokeWidth={width + 10}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ pointerEvents: interactive ? 'stroke' : 'none' }}
        onPointerDown={onPointerDown}
      />
      <polyline
        points={drawn}
        fill="none"
        stroke={color}
        strokeWidth={width}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ pointerEvents: 'none' }}
      />
    </svg>
  )
}

function AnnotationImage({ bytes, mime, alt }: { bytes: Uint8Array; mime: string; alt: string }) {
  const imageRef = useRef<HTMLImageElement>(null)
  useEffect(() => {
    const url = URL.createObjectURL(new Blob([copyBytes(bytes)], { type: mime }))
    const image = imageRef.current
    if (image) image.src = url
    return () => URL.revokeObjectURL(url)
  }, [bytes, mime])
  return <img ref={imageRef} alt={alt} draggable={false} />
}

function screenBox(viewport: PageViewport, annotation: Annotation): ScreenRect {
  if (annotation.type === 'ink') return pdfRectToScreen(viewport, pointsBounds(annotation.points))
  return pdfRectToScreen(viewport, annotation)
}

function translate(annotation: Annotation, dx: number, dy: number): Annotation {
  if (annotation.type === 'ink') {
    return {
      ...annotation,
      points: annotation.points.map((point) => ({ x: point.x + dx, y: point.y + dy })),
    }
  }
  if (annotation.type === 'text') {
    return {
      ...annotation,
      x: annotation.x + dx,
      y: annotation.y + dy,
      covers: annotation.covers.map((cover) => ({ ...cover, x: cover.x + dx, y: cover.y + dy })),
    }
  }
  return { ...annotation, x: annotation.x + dx, y: annotation.y + dy }
}

function resize(
  annotation: Annotation,
  next: { x: number; y: number; width: number; height: number },
): Annotation {
  if (annotation.type === 'ink') {
    return { ...annotation, points: scalePoints(annotation.points, pointsBounds(annotation.points), next) }
  }
  if (annotation.type === 'text' && annotation.covers.length > 0) {
    const from = { x: annotation.x, y: annotation.y, width: annotation.width, height: annotation.height }
    return { ...annotation, ...next, covers: annotation.covers.map((cover) => scaleCover(cover, from, next)) }
  }
  return { ...annotation, ...next }
}

function findCover(pageId: string, keys: readonly string[]) {
  return coversTouching(pageId, keys)[0]
}

function coversTouching(pageId: string, keys: readonly string[]) {
  if (keys.length === 0) return []
  const wanted = new Set(keys)
  return (useEditorStore.getState().doc?.annotations ?? []).filter(
    (annotation) =>
      annotation.type === 'text' &&
      annotation.pageId === pageId &&
      annotation.sourceKeys.some((key) => wanted.has(key)),
  )
}

function coverRuns(strips: readonly TextStrip[], underline: boolean): TextRun[] {
  const runs: TextRun[] = []
  strips.forEach((strip, index) => {
    const lineRuns = runsForPieces(strip.pieces, underline)
    if (index > 0 && lineRuns[0]) lineRuns[0] = { ...lineRuns[0], text: `\n${lineRuns[0].text}` }
    runs.push(...lineRuns)
  })
  return runs
}

function unionStrips(strips: readonly TextStrip[]) {
  const minX = Math.min(...strips.map((strip) => strip.x))
  const minY = Math.min(...strips.map((strip) => strip.y))
  const maxX = Math.max(...strips.map((strip) => strip.x + strip.width))
  const maxY = Math.max(...strips.map((strip) => strip.y + strip.height))
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

function scaleCover(
  cover: { x: number; y: number; width: number; height: number },
  from: { x: number; y: number; width: number; height: number },
  to: { x: number; y: number; width: number; height: number },
) {
  const scaleX = from.width === 0 ? 1 : to.width / from.width
  const scaleY = from.height === 0 ? 1 : to.height / from.height
  return {
    x: to.x + (cover.x - from.x) * scaleX,
    y: to.y + (cover.y - from.y) * scaleY,
    width: cover.width * scaleX,
    height: cover.height * scaleY,
  }
}

function rectFromPoints(a: Point, b: Point): ScreenRect {
  return {
    left: Math.min(a.x, b.x),
    top: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  }
}

function clampPoint(point: Point, width: number, height: number): Point {
  return {
    x: clamp(point.x, 0, width),
    y: clamp(point.y, 0, height),
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function boxStyle(rect: ScreenRect): CSSProperties & { '--pad'?: string } {
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  }
}
