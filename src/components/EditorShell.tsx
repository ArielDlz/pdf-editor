import { useEffect, useRef } from 'react'
import { useEditorStore } from '../store/editorStore'
import { DropZone } from './DropZone'
import { PageStage } from './PageStage'
import { SignatureDialog } from './SignatureDialog'
import { ThumbnailRail } from './ThumbnailRail'
import { Toolbar } from './Toolbar'

export function EditorShell() {
  const doc = useEditorStore((state) => state.doc)
  const error = useEditorStore((state) => state.error)
  const largeFile = useEditorStore((state) => state.largeFile)
  const opening = useEditorStore((state) => state.opening)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!useEditorStore.getState().dirty) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const state = useEditorStore.getState()
      if (state.signatureOpen) return
      const target = event.target
      const typing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.closest('[data-rich-text]') !== null)
      const annotationText = target instanceof HTMLElement && target.closest('[data-rich-text]') !== null
      if (event.key === 'Escape') {
        state.setEditingId(null)
        state.setTool('select')
        if (target instanceof HTMLElement) target.blur()
        return
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return
        if (!state.selectedId) return
        if (event.key === 'Backspace' && editingAnnotationText(target, state.editingId, state.selectedId)) return
        event.preventDefault()
        state.removeSelected()
        return
      }
      if (annotationText) return
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        if (typing && !annotationText) return
        event.preventDefault()
        if (event.shiftKey) state.redo()
        else state.undo()
        return
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        if (typing && !annotationText) return
        event.preventDefault()
        state.redo()
        return
      }
      if (typing) return
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function requestOpen() {
    const { dirty, doc: current } = useEditorStore.getState()
    if (current && dirty && !window.confirm('Discard unsaved edits and open another PDF?')) return
    fileRef.current?.click()
  }

  function takeFile(file: File | undefined) {
    if (!file) return
    const { dirty, doc: current, openFile } = useEditorStore.getState()
    if (current && dirty && !window.confirm('Discard unsaved edits and open another PDF?')) return
    void openFile(file)
  }

  if (!doc) return <DropZone />

  return (
    <div
      className="app"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault()
        const file = event.dataTransfer.files[0]
        if (file) takeFile(file)
      }}
    >
      <Toolbar onOpen={requestOpen} />
      {error ? <p className="banner error">{error}</p> : null}
      {largeFile ? (
        <p className="banner">This PDF is large. If the tab becomes slow, close other tabs.</p>
      ) : null}
      {opening ? <p className="banner">Opening…</p> : null}
      <div className="workspace">
        <ThumbnailRail />
        <PageStage />
      </div>
      <p className="footer-note">
        The file stays in this tab. Drag across words or lines, or click a line, to replace them. New text uses the standard PDF fonts.
      </p>
      <input
        ref={fileRef}
        type="file"
        accept="application/pdf,.pdf"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (!file) return
          void useEditorStore.getState().openFile(file)
        }}
      />
      <SignatureDialog />
    </div>
  )
}

function editingAnnotationText(target: EventTarget | null, editingId: string | null, selectedId: string): boolean {
  if (!(target instanceof HTMLElement) || editingId !== selectedId) return false
  const root = target.closest<HTMLElement>('[data-rich-text]')
  if (!root || root.dataset.annotationId !== selectedId) return false
  if ((root.textContent ?? '').length === 0) return false
  const selection = document.getSelection()
  if (!selection || selection.rangeCount === 0) return false
  return root.contains(selection.anchorNode)
}
