import { useEffect, useRef, useState, type RefObject } from 'react'
import type { PageViewport } from 'pdfjs-dist'
import { clampZoom, totalRotation } from '../lib/geometry'
import { cancelPaint, getPdfDocument, isCancelledRender, paintPdfPage } from '../pdf/pdfjs'
import { useEditorStore } from '../store/editorStore'
import { AnnotationLayer } from './AnnotationLayer'

export function PageStage() {
  const doc = useEditorStore((state) => state.doc)
  const zoom = useEditorStore((state) => state.zoom)
  const currentPageId = useEditorStore((state) => state.currentPageId)
  const setZoom = useEditorStore((state) => state.setZoom)
  const select = useEditorStore((state) => state.select)
  const tool = useEditorStore((state) => state.tool)
  const page = doc?.pages.find((item) => item.id === currentPageId) ?? null
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const fitted = useRef<string | null>(null)
  const [viewport, setViewport] = useState<PageViewport | null>(null)
  const [renderError, setRenderError] = useState<string | null>(null)

  useEffect(() => {
    const node = stageRef.current
    if (!node) return
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      const current = useEditorStore.getState().zoom
      setZoom(clampZoom(current * (event.deltaY > 0 ? 0.92 : 1.08)))
    }
    node.addEventListener('wheel', onWheel, { passive: false })
    return () => node.removeEventListener('wheel', onWheel)
  }, [setZoom, doc?.sessionId])

  useEffect(() => {
    const current = useEditorStore.getState().doc
    if (!current || !stageRef.current || current.pages.length === 0) return
    if (fitted.current === current.sessionId) return
    const width = stageRef.current.clientWidth
    if (width < 120) return
    const pdf = getPdfDocument()
    const first = current.pages[0]
    if (!pdf || !first) return
    fitted.current = current.sessionId
    const sourceIndex = first.sourceIndex
    const rotation = first.rotation
    void (async () => {
      const pdfPage = await pdf.getPage(sourceIndex + 1)
      const base = pdfPage.getViewport({
        scale: 1,
        rotation: totalRotation(pdfPage.rotate, rotation),
      })
      setZoom(clampZoom((width - 64) / base.width))
    })()
  }, [doc?.sessionId, setZoom])

  useEffect(() => {
    const handle = { cancelled: false }
    const canvas = canvasRef.current
    const pdf = getPdfDocument()
    if (!canvas || !pdf || !page) return
    const sourceIndex = page.sourceIndex
    const pageRotation = page.rotation
    void (async () => {
      try {
        const pdfPage = await pdf.getPage(sourceIndex + 1)
        if (handle.cancelled) return
        const rotation = totalRotation(pdfPage.rotate, pageRotation)
        const next = pdfPage.getViewport({ scale: zoom, rotation })
        setViewport(next)
        setRenderError(null)
        const task = paintPdfPage(pdfPage, canvas, next, window.devicePixelRatio || 1)
        await task.promise
      } catch (error) {
        if (isCancelledRender(error) || handle.cancelled) return
        console.error(error)
        setRenderError(error instanceof Error ? error.message : 'This page couldn’t be drawn.')
      }
    })()
    return () => {
      handle.cancelled = true
      cancelPaint(canvas)
    }
  }, [doc?.sessionId, page, zoom])

  return (
    <div className="stage" ref={stageRef}>
      {!page ? <p className="empty-pages">All pages were removed. Undo to bring a page back.</p> : null}
      {page ? (
        <div
          className="page-frame"
          ref={frameRef}
          data-rotation={page.rotation}
          style={viewport ? { width: viewport.width, height: viewport.height } : undefined}
          onPointerDown={(event) => {
            const target = event.target
            const inField = target instanceof HTMLElement && target.closest('textarea, input, [data-rich-text]')
            if (!inField && useEditorStore.getState().editingId) {
              useEditorStore.getState().setEditingId(null)
            }
            if (tool === 'select' && !inField) select(null)
          }}
        >
          <canvas ref={canvasRef} className="page-canvas" />
          {renderError ? <p className="page-render-error">{renderError}</p> : null}
          {viewport ? <AnnotationLayer viewport={viewport} frameRef={frameRef as RefObject<HTMLDivElement | null>} /> : null}
        </div>
      ) : null}
    </div>
  )
}
