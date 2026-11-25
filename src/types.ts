export type Tool = 'select' | 'text' | 'highlight' | 'ink' | 'image' | 'sign' | 'cut'

export type CutShape = 'rect' | 'circle'

export type Rotation = 0 | 90 | 180 | 270

export type PageRef = {
  id: string
  sourceIndex: number
  rotation: Rotation
}

export type Point = {
  x: number
  y: number
}

export const PDF_FONT_IDS = [
  'Helvetica',
  'Helvetica-Bold',
  'Helvetica-Oblique',
  'Helvetica-BoldOblique',
  'Times-Roman',
  'Times-Bold',
  'Times-Italic',
  'Times-BoldItalic',
  'Courier',
  'Courier-Bold',
  'Courier-Oblique',
  'Courier-BoldOblique',
] as const

export type PdfFontId = (typeof PDF_FONT_IDS)[number]

export type TextRun = {
  text: string
  bold: boolean
  italic: boolean
  underline: boolean
  color: string
}

export type CoverStrip = {
  x: number
  y: number
  width: number
  height: number
}

export type TextAnnotation = {
  id: string
  type: 'text'
  pageId: string
  x: number
  y: number
  width: number
  height: number
  runs: TextRun[]
  fontSize: number
  font: PdfFontId
  color: string
  cover: boolean
  covers: CoverStrip[]
  sourceKey: string | null
  sourceKeys: string[]
}

export type ImageAnnotation = {
  id: string
  type: 'image' | 'signature'
  pageId: string
  x: number
  y: number
  width: number
  height: number
  bytes: Uint8Array
  mime: 'image/png' | 'image/jpeg'
}

export type CoverAnnotation = {
  id: string
  type: 'cover'
  pageId: string
  x: number
  y: number
  width: number
  height: number
  shape: CutShape
}

export type HighlightAnnotation = {
  id: string
  type: 'highlight'
  pageId: string
  x: number
  y: number
  width: number
  height: number
  color: string
}

export type InkAnnotation = {
  id: string
  type: 'ink'
  pageId: string
  points: Point[]
  color: string
  strokeWidth: number
}

export type Annotation =
  | TextAnnotation
  | ImageAnnotation
  | HighlightAnnotation
  | InkAnnotation
  | CoverAnnotation

export type EditorDoc = {
  sessionId: string
  fileName: string
  pdfBytes: Uint8Array
  pages: PageRef[]
  annotations: Annotation[]
}

export type Snapshot = {
  pages: PageRef[]
  annotations: Annotation[]
}

export type SignatureStamp = {
  bytes: Uint8Array
  width: number
  height: number
}

export const TEXT_COLORS = ['#1c1915', '#1d4ed8', '#9d3b2f'] as const
export const INK_COLORS = ['#1c1915', '#1d4ed8', '#9d3b2f'] as const
export const HIGHLIGHT_COLORS = ['#ffe14a', '#7dff7a', '#ff8ad4', '#7ad0ff'] as const

export function cloneAnnotation(annotation: Annotation): Annotation {
  if (annotation.type === 'ink') {
    return {
      ...annotation,
      points: annotation.points.map((point) => ({ ...point })),
    }
  }
  if (annotation.type === 'text') {
    return {
      ...annotation,
      runs: annotation.runs.map((run) => ({ ...run })),
      covers: annotation.covers.map((cover) => ({ ...cover })),
      sourceKeys: [...annotation.sourceKeys],
    }
  }
  return { ...annotation }
}

export function takeSnapshot(doc: EditorDoc): Snapshot {
  return {
    pages: doc.pages.map((page) => ({ ...page })),
    annotations: doc.annotations.map(cloneAnnotation),
  }
}
