import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { cancelPaint, getPdfDocument, isCancelledRender, paintPdfPage } from '../pdf/pdfjs'
import { totalRotation } from '../lib/geometry'
import { useEditorStore } from '../store/editorStore'
import type { PageRef } from '../types'

export function ThumbnailRail() {
  const pages = useEditorStore((state) => state.doc?.pages ?? [])
  const sessionId = useEditorStore((state) => state.doc?.sessionId)
  const currentPageId = useEditorStore((state) => state.currentPageId)
  const [dropIndex, setDropIndex] = useState<number | null>(null)

  if (!sessionId) return null

  return (
    <aside className="rail" aria-label="Pages">
      {pages.length === 0 ? <p className="rail-empty">No pages</p> : null}
      {pages.map((page, index) => (
        <Thumbnail
          key={page.id}
          page={page}
          index={index}
          sessionId={sessionId}
          active={page.id === currentPageId}
          dropping={dropIndex === index}
          onPointerDown={(event) => startReorder(event, index, page.id, setDropIndex)}
        />
      ))}
    </aside>
  )
}

function startReorder(
  event: ReactPointerEvent,
  index: number,
  pageId: string,
  setDropIndex: (value: number | null) => void,
) {
  if (event.button !== 0) return
  if ((event.target as HTMLElement).closest('button')) return
  const startX = event.clientX
  const startY = event.clientY
  let moved = false
  const move = (pointer: globalThis.PointerEvent) => {
    if (Math.hypot(pointer.clientX - startX, pointer.clientY - startY) > 4) moved = true
    const card = document.elementFromPoint(pointer.clientX, pointer.clientY)?.closest('[data-page-index]')
    setDropIndex(card ? Number(card.getAttribute('data-page-index')) : null)
  }
  const up = (pointer: globalThis.PointerEvent) => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    const card = document.elementFromPoint(pointer.clientX, pointer.clientY)?.closest('[data-page-index]')
    const to = card ? Number(card.getAttribute('data-page-index')) : index
    setDropIndex(null)
    if (moved && Number.isFinite(to) && to !== index) useEditorStore.getState().reorderPages(index, to)
    else useEditorStore.getState().setCurrentPage(pageId)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}

function Thumbnail({
  page,
  index,
  sessionId,
  active,
  dropping,
  onPointerDown,
}: {
  page: PageRef
  index: number
  sessionId: string
  active: boolean
  dropping: boolean
  onPointerDown: (event: ReactPointerEvent) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rotatePage = useEditorStore((state) => state.rotatePage)
  const deletePage = useEditorStore((state) => state.deletePage)

  useEffect(() => {
    const handle = { cancelled: false }
    const canvas = canvasRef.current
    const pdf = getPdfDocument()
    if (!canvas || !pdf) return
    void (async () => {
      try {
        const pdfPage = await pdf.getPage(page.sourceIndex + 1)
        if (handle.cancelled) return
        const rotation = totalRotation(pdfPage.rotate, page.rotation)
        const base = pdfPage.getViewport({ scale: 1, rotation })
        const viewport = pdfPage.getViewport({ scale: 112 / base.width, rotation })
        const task = paintPdfPage(pdfPage, canvas, viewport)
        await task.promise
      } catch (error) {
        if (!isCancelledRender(error) && !handle.cancelled) console.error(error)
      }
    })()
    return () => {
      handle.cancelled = true
      cancelPaint(canvas)
    }
  }, [page.sourceIndex, page.rotation, sessionId])

  const className = ['thumb', active ? 'active' : '', dropping ? 'dropping' : ''].filter(Boolean).join(' ')

  return (
    <div
      className={className}
      data-page-index={index}
      onPointerDown={onPointerDown}
    >
      <canvas ref={canvasRef} />
      <div className="thumb-meta">
        <span>{index + 1}</span>
        <button
          type="button"
          aria-label={`Rotate page ${index + 1}`}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => rotatePage(page.id)}
        >
          Rotate
        </button>
        <button
          type="button"
          aria-label={`Delete page ${index + 1}`}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => deletePage(page.id)}
        >
          Delete
        </button>
      </div>
    </div>
  )
}
