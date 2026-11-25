import { StandardFonts } from 'pdf-lib'
import type { PdfFontId } from '../types'

export type PdfFontFace = {
  id: PdfFontId
  label: string
  family: string
  weight: number
  style: 'normal' | 'italic'
  standard: StandardFonts
}

export const PDF_FONTS: readonly PdfFontFace[] = [
  face('Helvetica', 'Helvetica', 'Helvetica, Arial, sans-serif', 400, 'normal', StandardFonts.Helvetica),
  face('Helvetica-Bold', 'Helvetica Bold', 'Helvetica, Arial, sans-serif', 700, 'normal', StandardFonts.HelveticaBold),
  face('Helvetica-Oblique', 'Helvetica Oblique', 'Helvetica, Arial, sans-serif', 400, 'italic', StandardFonts.HelveticaOblique),
  face('Helvetica-BoldOblique', 'Helvetica Bold Oblique', 'Helvetica, Arial, sans-serif', 700, 'italic', StandardFonts.HelveticaBoldOblique),
  face('Times-Roman', 'Times Roman', '"Times New Roman", Times, serif', 400, 'normal', StandardFonts.TimesRoman),
  face('Times-Bold', 'Times Bold', '"Times New Roman", Times, serif', 700, 'normal', StandardFonts.TimesRomanBold),
  face('Times-Italic', 'Times Italic', '"Times New Roman", Times, serif', 400, 'italic', StandardFonts.TimesRomanItalic),
  face('Times-BoldItalic', 'Times Bold Italic', '"Times New Roman", Times, serif', 700, 'italic', StandardFonts.TimesRomanBoldItalic),
  face('Courier', 'Courier', '"Courier New", Courier, monospace', 400, 'normal', StandardFonts.Courier),
  face('Courier-Bold', 'Courier Bold', '"Courier New", Courier, monospace', 700, 'normal', StandardFonts.CourierBold),
  face('Courier-Oblique', 'Courier Oblique', '"Courier New", Courier, monospace', 400, 'italic', StandardFonts.CourierOblique),
  face('Courier-BoldOblique', 'Courier Bold Oblique', '"Courier New", Courier, monospace', 700, 'italic', StandardFonts.CourierBoldOblique),
]

const FONT_BY_ID = new Map(PDF_FONTS.map((item) => [item.id, item]))

export function pdfFontFace(id: PdfFontId): PdfFontFace {
  return FONT_BY_ID.get(id) ?? PDF_FONTS[0]
}

export type PdfFontFamily = 'Helvetica' | 'Times' | 'Courier'

export const PDF_FONT_FAMILIES: readonly { id: PdfFontFamily; label: string }[] = [
  { id: 'Helvetica', label: 'Helvetica' },
  { id: 'Times', label: 'Times Roman' },
  { id: 'Courier', label: 'Courier' },
]

export function fontFamilyOf(id: PdfFontId): PdfFontFamily {
  if (id.startsWith('Times')) return 'Times'
  if (id.startsWith('Courier')) return 'Courier'
  return 'Helvetica'
}

export function fontIsBold(id: PdfFontId): boolean {
  return id.includes('Bold')
}

export function fontIsItalic(id: PdfFontId): boolean {
  return id.includes('Italic') || id.includes('Oblique')
}

export function composeFont(family: PdfFontFamily, bold: boolean, italic: boolean): PdfFontId {
  if (family === 'Times') {
    if (bold && italic) return 'Times-BoldItalic'
    if (bold) return 'Times-Bold'
    if (italic) return 'Times-Italic'
    return 'Times-Roman'
  }
  if (family === 'Courier') {
    if (bold && italic) return 'Courier-BoldOblique'
    if (bold) return 'Courier-Bold'
    if (italic) return 'Courier-Oblique'
    return 'Courier'
  }
  if (bold && italic) return 'Helvetica-BoldOblique'
  if (bold) return 'Helvetica-Bold'
  if (italic) return 'Helvetica-Oblique'
  return 'Helvetica'
}

export function guessPdfFont(fontFamily: string): PdfFontId {
  const name = fontFamily.toLowerCase()
  const bold = /bold|black|semibold|demi/.test(name)
  const italic = /italic|oblique/.test(name)
  const sans = /helvetica|arial|calibri|verdana|sans/.test(name)
  const mono = /courier|mono|consolas|fixed/.test(name)
  const serif = !sans && /times|roman|cambria|georgia|garamond|serif/.test(name)
  if (mono) {
    if (bold && italic) return 'Courier-BoldOblique'
    if (bold) return 'Courier-Bold'
    if (italic) return 'Courier-Oblique'
    return 'Courier'
  }
  if (serif) {
    if (bold && italic) return 'Times-BoldItalic'
    if (bold) return 'Times-Bold'
    if (italic) return 'Times-Italic'
    return 'Times-Roman'
  }
  if (bold && italic) return 'Helvetica-BoldOblique'
  if (bold) return 'Helvetica-Bold'
  if (italic) return 'Helvetica-Oblique'
  return 'Helvetica'
}

function face(
  id: PdfFontId,
  label: string,
  family: string,
  weight: number,
  style: 'normal' | 'italic',
  standard: StandardFonts,
): PdfFontFace {
  return { id, label, family, weight, style, standard }
}
