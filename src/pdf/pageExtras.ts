import {
  PDFArray,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFRef,
  PDFString,
  type PDFDocument,
  type PDFObject,
  type PDFPage,
} from 'pdf-lib'
import type { PdfRect } from '../lib/geometry'

export type WebLink = PdfRect & {
  url: string
}

export function readWebLinks(page: PDFPage): WebLink[] {
  const annots = page.node.Annots()
  if (!annots) return []
  const links: WebLink[] = []
  for (let index = 0; index < annots.size(); index += 1) {
    const dict = annots.lookupMaybe(index, PDFDict)
    if (!dict) continue
    const link = webLinkFrom(dict)
    if (link) links.push(link)
  }
  return links
}

export function stripPageExtras(page: PDFPage): void {
  const context = page.doc.context
  const keep = contentRefs(page)
  purgeAdditionalActions(context, page.node.get(PDFName.of('AA')), keep)
  page.node.delete(PDFName.of('AA'))
  const annotsRef = page.node.get(PDFName.Annots)
  const annots = page.node.Annots()
  const items = annots ? annots.asArray() : []
  page.node.delete(PDFName.Annots)
  dropRef(context, annotsRef, keep)
  for (const item of items) purgeAnnot(context, item, keep)
}

export function addWebLinks(page: PDFPage, links: readonly WebLink[]): void {
  if (links.length === 0) return
  const context = page.doc.context
  const refs = links.map((link) =>
    context.register(
      context.obj({
        Type: 'Annot',
        Subtype: 'Link',
        Rect: [link.x, link.y, link.x + link.width, link.y + link.height],
        Border: [0, 0, 0],
        A: {
          S: 'URI',
          URI: pdfLiteral(link.url),
        },
      }),
    ),
  )
  page.node.set(PDFName.Annots, context.obj(refs))
}

export function rectsIntersect(a: PdfRect, b: PdfRect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

function webLinkFrom(dict: PDFDict): WebLink | null {
  if (dict.get(PDFName.of('Subtype')) !== PDFName.of('Link')) return null
  if (dict.has(PDFName.of('AA'))) return null
  const action = dict.lookup(PDFName.of('A'))
  if (!(action instanceof PDFDict)) return null
  if (action.has(PDFName.of('Next'))) return null
  if (action.get(PDFName.of('S')) !== PDFName.of('URI')) return null
  const url = httpUrl(pdfText(action.lookup(PDFName.of('URI'))))
  const rect = rectangleOf(dict)
  if (!url || !rect) return null
  return { ...rect, url }
}

function httpUrl(value: string | null): string | null {
  if (!value) return null
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (url.username !== '' || url.password !== '') return null
  return url.href
}

function rectangleOf(dict: PDFDict): PdfRect | null {
  const rect = dict.lookupMaybe(PDFName.of('Rect'), PDFArray)
  if (!rect || rect.size() !== 4) return null
  try {
    const box = rect.asRectangle()
    const x = Math.min(box.x, box.x + box.width)
    const y = Math.min(box.y, box.y + box.height)
    return { x, y, width: Math.abs(box.width), height: Math.abs(box.height) }
  } catch {
    return null
  }
}

function pdfText(value: PDFObject | undefined): string | null {
  if (value instanceof PDFString) return value.decodeText()
  if (value instanceof PDFHexString) return hexText(value)
  return null
}

function hexText(value: PDFHexString): string {
  const bytes = value.asBytes()
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    let text = ''
    for (let index = 2; index + 1 < bytes.length; index += 2) {
      text += String.fromCharCode((bytes[index] << 8) | bytes[index + 1])
    }
    return text
  }
  let text = ''
  for (const byte of bytes) text += String.fromCharCode(byte)
  return text
}

function pdfLiteral(value: string): PDFString {
  return PDFString.of(value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)'))
}

function contentRefs(page: PDFPage): Set<PDFRef> {
  const keep = new Set<PDFRef>()
  const contents = page.node.get(PDFName.Contents)
  if (contents instanceof PDFRef) keep.add(contents)
  if (contents instanceof PDFArray) {
    for (let index = 0; index < contents.size(); index += 1) {
      const item = contents.get(index)
      if (item instanceof PDFRef) keep.add(item)
    }
  }
  const resources = page.node.get(PDFName.Resources)
  if (resources instanceof PDFRef) keep.add(resources)
  return keep
}

function dropRef(context: PDFDocument['context'], value: PDFObject | undefined, keep: Set<PDFRef>) {
  if (value instanceof PDFRef && !keep.has(value)) context.delete(value)
}

function purgeAnnot(context: PDFDocument['context'], value: PDFObject, keep: Set<PDFRef>) {
  const dict = value instanceof PDFRef ? context.lookup(value) : value
  if (dict instanceof PDFDict) {
    purgeAction(context, dict.get(PDFName.of('A')), keep)
    purgeAdditionalActions(context, dict.get(PDFName.of('AA')), keep)
    purgeFileSpec(context, dict.get(PDFName.of('FS')), keep)
    dropRef(context, dict.get(PDFName.of('Contents')), keep)
    dropRef(context, dict.get(PDFName.of('RC')), keep)
  }
  dropRef(context, value, keep)
}

function purgeAdditionalActions(
  context: PDFDocument['context'],
  value: PDFObject | undefined,
  keep: Set<PDFRef>,
) {
  if (!value) return
  const dict = value instanceof PDFRef ? context.lookup(value) : value
  if (dict instanceof PDFDict) {
    for (const [, action] of dict.entries()) purgeAction(context, action, keep)
  }
  dropRef(context, value, keep)
}

function purgeAction(
  context: PDFDocument['context'],
  action: PDFObject | undefined,
  keep: Set<PDFRef>,
  seen = new Set<PDFRef>(),
) {
  if (!action) return
  if (action instanceof PDFRef) {
    if (seen.has(action) || keep.has(action)) return
    seen.add(action)
  }
  const resolved = action instanceof PDFRef ? context.lookup(action) : action
  if (resolved instanceof PDFDict) {
    dropRef(context, resolved.get(PDFName.of('JS')), keep)
    const next = resolved.get(PDFName.of('Next'))
    const chain = next instanceof PDFRef ? context.lookup(next) : next
    if (chain instanceof PDFArray) {
      for (let index = 0; index < chain.size(); index += 1) {
        purgeAction(context, chain.get(index), keep, seen)
      }
      dropRef(context, next, keep)
    } else {
      purgeAction(context, next, keep, seen)
    }
  }
  dropRef(context, action, keep)
}

function purgeFileSpec(
  context: PDFDocument['context'],
  spec: PDFObject | undefined,
  keep: Set<PDFRef>,
) {
  if (!spec) return
  const dict = spec instanceof PDFRef ? context.lookup(spec) : spec
  if (dict instanceof PDFDict) {
    const embedded = dict.get(PDFName.of('EF'))
    const streams = embedded instanceof PDFRef ? context.lookup(embedded) : embedded
    if (streams instanceof PDFDict) {
      for (const name of ['F', 'UF', 'DOS', 'Mac', 'Unix']) {
        dropRef(context, streams.get(PDFName.of(name)), keep)
      }
    }
    dropRef(context, embedded, keep)
  }
  dropRef(context, spec, keep)
}
