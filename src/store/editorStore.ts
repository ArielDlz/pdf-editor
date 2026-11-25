import { create } from 'zustand'
import { openPdfDocument, pdfErrorMessage } from '../pdf/pdfjs'
import { clearTextLines } from '../pdf/textLines'
import { addRotation } from '../lib/geometry'
import {
  takeSnapshot,
  type Annotation,
  type CoverAnnotation,
  type CutShape,
  type EditorDoc,
  type ImageAnnotation,
  type PdfFontId,
  type SignatureStamp,
  type Tool,
} from '../types'

const HISTORY_LIMIT = 100
const LARGE_FILE_BYTES = 40 * 1024 * 1024
const MAX_FILE_BYTES = 150 * 1024 * 1024

type Gesture = {
  dirty: boolean
}

type EditorState = {
  doc: EditorDoc | null
  tool: Tool
  selectedId: string | null
  editingId: string | null
  zoom: number
  currentPageId: string | null
  past: ReturnType<typeof takeSnapshot>[]
  future: ReturnType<typeof takeSnapshot>[]
  gesture: Gesture | null
  dirty: boolean
  exporting: boolean
  opening: boolean
  error: string | null
  largeFile: boolean
  signature: SignatureStamp | null
  signatureOpen: boolean
  textDefaults: { fontSize: number; color: string; font: PdfFontId; underline: boolean }
  pageText: 'unknown' | 'yes' | 'no'
  inkDefaults: { strokeWidth: number; color: string }
  highlightColor: string
  cutShape: CutShape
  openFile: (file: File) => Promise<void>
  setTool: (tool: Tool) => void
  setZoom: (zoom: number) => void
  setCurrentPage: (pageId: string) => void
  select: (id: string | null) => void
  setEditingId: (id: string | null) => void
  beginGesture: () => void
  endGesture: () => void
  undo: () => void
  redo: () => void
  addAnnotation: (annotation: Annotation) => void
  placeTextCover: (annotation: Extract<Annotation, { type: 'text' }>, replaceIds: string[]) => void
  patchAnnotation: (id: string, recipe: (annotation: Annotation) => Annotation) => void
  updateAnnotation: (id: string, recipe: (annotation: Annotation) => Annotation) => void
  removeSelected: () => void
  rotatePage: (pageId: string) => void
  deletePage: (pageId: string) => void
  reorderPages: (from: number, to: number) => void
  setTextDefaults: (patch: Partial<EditorState['textDefaults']>) => void
  setPageText: (pageText: EditorState['pageText']) => void
  setInkDefaults: (patch: Partial<EditorState['inkDefaults']>) => void
  setHighlightColor: (color: string) => void
  setCutShape: (shape: CutShape) => void
  addCut: (cover: CoverAnnotation, image: ImageAnnotation) => void
  setSignature: (signature: SignatureStamp | null) => void
  setSignatureOpen: (open: boolean) => void
  setExporting: (exporting: boolean) => void
  setError: (error: string | null) => void
  markClean: () => void
}

let openSeq = 0
let gestureSnapshot: ReturnType<typeof takeSnapshot> | null = null

export const useEditorStore = create<EditorState>((set, get) => {
  const commit = (
    recipe: (doc: EditorDoc) => EditorDoc,
    extra?: (next: EditorDoc) => Partial<EditorState>,
  ) => {
    const { doc, past } = get()
    if (!doc) return
    const previous = takeSnapshot(doc)
    const next = recipe(doc)
    set({
      doc: next,
      past: [...past, previous].slice(-HISTORY_LIMIT),
      future: [],
      dirty: true,
      gesture: null,
      ...(extra?.(next) ?? {}),
    })
  }

  return {
    doc: null,
    tool: 'select',
    selectedId: null,
    editingId: null,
    zoom: 1,
    currentPageId: null,
    past: [],
    future: [],
    gesture: null,
    dirty: false,
    exporting: false,
    opening: false,
    error: null,
    largeFile: false,
    signature: null,
    signatureOpen: false,
    textDefaults: { fontSize: 16, color: '#1c1915', font: 'Helvetica', underline: false },
    pageText: 'unknown',
    inkDefaults: { strokeWidth: 2, color: '#1c1915' },
    highlightColor: '#ffe14a',
    cutShape: 'rect',

    openFile: async (file) => {
      const seq = ++openSeq
      const looksLikePdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
      if (!looksLikePdf) {
        set({ error: 'Choose a PDF file.' })
        return
      }
      if (file.size > MAX_FILE_BYTES) {
        set({ error: 'This PDF is too large to open in the browser tab.' })
        return
      }
      set({ opening: true, error: null })
      try {
        const bytes = new Uint8Array(await file.arrayBuffer())
        const pdf = await openPdfDocument(bytes)
        if (seq !== openSeq) return
        if (!pdf) {
          set({ opening: false })
          return
        }
        const pages = Array.from({ length: pdf.numPages }, (_, index) => ({
          id: crypto.randomUUID(),
          sourceIndex: index,
          rotation: 0 as const,
        }))
        gestureSnapshot = null
        clearTextLines()
        const doc: EditorDoc = {
          sessionId: crypto.randomUUID(),
          fileName: file.name,
          pdfBytes: bytes,
          pages,
          annotations: [],
        }
        set({
          doc,
          opening: false,
          past: [],
          future: [],
          gesture: null,
          dirty: false,
          selectedId: null,
          editingId: null,
          tool: 'select',
          currentPageId: pages[0]?.id ?? null,
          largeFile: bytes.byteLength > LARGE_FILE_BYTES,
          error: pdf.isPureXfa
            ? 'This PDF is an XFA form, so its pages can’t be drawn here.'
            : null,
          zoom: 1,
          pageText: 'unknown',
        })
      } catch (error) {
        if (seq !== openSeq) return
        set({ opening: false, error: pdfErrorMessage(error) })
      }
    },

    setTool: (tool) => set({ tool, editingId: tool === 'select' ? get().editingId : null }),
    setZoom: (zoom) => set({ zoom }),
    setCurrentPage: (pageId) => set({ currentPageId: pageId, selectedId: null, editingId: null }),
    select: (id) => set({ selectedId: id }),
    setEditingId: (id) => set({ editingId: id, selectedId: id ?? get().selectedId }),

    beginGesture: () => {
      const { doc, gesture } = get()
      if (!doc || gesture) return
      gestureSnapshot = takeSnapshot(doc)
      set({ gesture: { dirty: false } })
    },

    endGesture: () => {
      const snapshot = gestureSnapshot
      const { gesture, past } = get()
      gestureSnapshot = null
      if (!gesture) return
      if (!snapshot || !gesture.dirty) {
        set({ gesture: null })
        return
      }
      set({
        gesture: null,
        past: [...past, snapshot].slice(-HISTORY_LIMIT),
        future: [],
        dirty: true,
      })
    },

    undo: () => {
      get().endGesture()
      const { past, doc, future } = get()
      if (!doc || past.length === 0) return
      const previous = past[past.length - 1]
      const current = takeSnapshot(doc)
      const selectedStillThere = previous.annotations.some((annotation) => annotation.id === get().selectedId)
      set({
        doc: { ...doc, pages: previous.pages, annotations: previous.annotations },
        past: past.slice(0, -1),
        future: [...future, current].slice(-HISTORY_LIMIT),
        selectedId: selectedStillThere ? get().selectedId : null,
        editingId: null,
        currentPageId: previous.pages.some((page) => page.id === get().currentPageId)
          ? get().currentPageId
          : (previous.pages[0]?.id ?? null),
        dirty: true,
      })
    },

    redo: () => {
      get().endGesture()
      const { past, doc, future } = get()
      if (!doc || future.length === 0) return
      const next = future[future.length - 1]
      const current = takeSnapshot(doc)
      set({
        doc: { ...doc, pages: next.pages, annotations: next.annotations },
        future: future.slice(0, -1),
        past: [...past, current].slice(-HISTORY_LIMIT),
        selectedId: null,
        editingId: null,
        currentPageId: next.pages.some((page) => page.id === get().currentPageId)
          ? get().currentPageId
          : (next.pages[0]?.id ?? null),
        dirty: true,
      })
    },

    addAnnotation: (annotation) => {
      commit(
        (doc) => ({ ...doc, annotations: [...doc.annotations, annotation] }),
        () => ({
          selectedId: annotation.id,
          editingId: annotation.type === 'text' ? annotation.id : null,
          tool: annotation.type === 'highlight' || annotation.type === 'ink' ? get().tool : 'select',
          currentPageId: annotation.pageId,
        }),
      )
    },

    placeTextCover: (annotation, replaceIds) => {
      const drop = new Set(replaceIds)
      commit(
        (doc) => ({
          ...doc,
          annotations: [...doc.annotations.filter((item) => !drop.has(item.id)), annotation],
        }),
        () => ({
          selectedId: annotation.id,
          editingId: annotation.id,
          tool: 'select',
          currentPageId: annotation.pageId,
        }),
      )
    },

    patchAnnotation: (id, recipe) => {
      const { doc, gesture } = get()
      if (!doc) return
      set({
        doc: {
          ...doc,
          annotations: doc.annotations.map((annotation) =>
            annotation.id === id ? recipe(annotation) : annotation,
          ),
        },
        gesture: gesture ? { dirty: true } : gesture,
        dirty: true,
      })
    },

    updateAnnotation: (id, recipe) => {
      commit((doc) => ({
        ...doc,
        annotations: doc.annotations.map((annotation) =>
          annotation.id === id ? recipe(annotation) : annotation,
        ),
      }))
    },

    removeSelected: () => {
      const { selectedId } = get()
      if (!selectedId) return
      commit(
        (doc) => ({
          ...doc,
          annotations: doc.annotations.filter((annotation) => annotation.id !== selectedId),
        }),
        () => ({ selectedId: null, editingId: null }),
      )
    },

    rotatePage: (pageId) => {
      commit((doc) => ({
        ...doc,
        pages: doc.pages.map((page) =>
          page.id === pageId ? { ...page, rotation: addRotation(page.rotation) } : page,
        ),
      }))
    },

    deletePage: (pageId) => {
      const current = get()
      commit(
        (doc) => ({
          ...doc,
          pages: doc.pages.filter((page) => page.id !== pageId),
          annotations: doc.annotations.filter((annotation) => annotation.pageId !== pageId),
        }),
        (next) => {
          const oldIndex = current.doc?.pages.findIndex((page) => page.id === pageId) ?? 0
          const currentPageId =
            current.currentPageId === pageId
              ? (next.pages[Math.min(oldIndex, next.pages.length - 1)]?.id ?? null)
              : current.currentPageId
          const selectedId = next.annotations.some((annotation) => annotation.id === current.selectedId)
            ? current.selectedId
            : null
          return { currentPageId, selectedId, editingId: null }
        },
      )
    },

    reorderPages: (from, to) => {
      if (from === to) return
      commit((doc) => {
        const pages = [...doc.pages]
        const [moved] = pages.splice(from, 1)
        if (!moved) return doc
        pages.splice(to, 0, moved)
        return { ...doc, pages }
      })
    },

    setTextDefaults: (patch) =>
      set((state) => ({ textDefaults: { ...state.textDefaults, ...patch } })),
    setPageText: (pageText) => set({ pageText }),
    setInkDefaults: (patch) =>
      set((state) => ({ inkDefaults: { ...state.inkDefaults, ...patch } })),
    setHighlightColor: (highlightColor) => set({ highlightColor }),
    setCutShape: (cutShape) => set({ cutShape }),

    addCut: (cover, image) => {
      commit(
        (doc) => ({ ...doc, annotations: [...doc.annotations, cover, image] }),
        () => ({
          selectedId: image.id,
          editingId: null,
          tool: 'select',
          currentPageId: image.pageId,
        }),
      )
    },
    setSignature: (signature) => set({ signature }),
    setSignatureOpen: (signatureOpen) => set({ signatureOpen }),
    setExporting: (exporting) => set({ exporting }),
    setError: (error) => set({ error }),
    markClean: () => set({ dirty: false }),
  }
})
