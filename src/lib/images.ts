export type LoadedImage = {
  bytes: Uint8Array
  mime: 'image/png' | 'image/jpeg'
  width: number
  height: number
}

export async function readImageFile(file: File): Promise<LoadedImage> {
  const mime = file.type === 'image/png' ? 'image/png' : file.type === 'image/jpeg' ? 'image/jpeg' : null
  if (!mime) throw new Error('Use a PNG or JPEG image.')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const url = URL.createObjectURL(file)
  try {
    const size = await loadSize(url)
    return { bytes, mime, width: size.width, height: size.height }
  } finally {
    URL.revokeObjectURL(url)
  }
}

function loadSize(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
    image.onerror = () => reject(new Error('Could not read that image.'))
    image.src = url
  })
}

export function copyBytes(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(copy).set(bytes)
  return copy
}

export async function canvasToPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((result) => resolve(result), 'image/png')
  })
  if (!blob) throw new Error('Could not save the signature.')
  return new Uint8Array(await blob.arrayBuffer())
}

export function trimSignatureCanvas(source: HTMLCanvasElement): HTMLCanvasElement | null {
  const context = source.getContext('2d')
  if (!context) return null
  const { width, height } = source
  const data = context.getImageData(0, 0, width, height).data
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4
      const alpha = data[index + 3]
      const inked = alpha > 12 && (data[index] < 248 || data[index + 1] < 248 || data[index + 2] < 248)
      if (!inked) continue
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
  }
  if (maxX < minX || maxY < minY) return null
  const pad = 8
  const left = Math.max(0, minX - pad)
  const top = Math.max(0, minY - pad)
  const right = Math.min(width - 1, maxX + pad)
  const bottom = Math.min(height - 1, maxY + pad)
  const croppedWidth = right - left + 1
  const croppedHeight = bottom - top + 1
  const cropped = document.createElement('canvas')
  cropped.width = croppedWidth
  cropped.height = croppedHeight
  cropped.getContext('2d')?.drawImage(
    source,
    left,
    top,
    croppedWidth,
    croppedHeight,
    0,
    0,
    croppedWidth,
    croppedHeight,
  )
  return cropped
}
