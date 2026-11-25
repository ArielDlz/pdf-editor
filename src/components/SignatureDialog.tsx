import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { canvasToPng, trimSignatureCanvas } from '../lib/images'
import { useEditorStore } from '../store/editorStore'

export function SignatureDialog() {
  const open = useEditorStore((state) => state.signatureOpen)
  const setSignatureOpen = useEditorStore((state) => state.setSignatureOpen)
  const setSignature = useEditorStore((state) => state.setSignature)
  const setTool = useEditorStore((state) => state.setTool)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const [mode, setMode] = useState<'draw' | 'type'>('draw')
  const [name, setName] = useState('')
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    if (mode === 'type') {
      context.fillStyle = '#1c1915'
      context.font = '64px "Segoe Script", "Brush Script MT", cursive'
      context.textAlign = 'center'
      context.textBaseline = 'middle'
      context.fillText(name.trim() || ' ', canvas.width / 2, canvas.height / 2)
    }
  }, [open, mode, name])

  if (!open) return null

  function canvasPoint(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const box = canvas.getBoundingClientRect()
    return {
      x: ((event.clientX - box.left) * canvas.width) / box.width,
      y: ((event.clientY - box.top) * canvas.height) / box.height,
    }
  }

  function clearCanvas() {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    setName('')
    setMessage(null)
  }

  async function confirm() {
    const canvas = canvasRef.current
    if (!canvas) return
    const trimmed = trimSignatureCanvas(canvas)
    if (!trimmed) {
      setMessage('Draw or type a signature first.')
      return
    }
    const bytes = await canvasToPng(trimmed)
    setSignature({ bytes, width: trimmed.width, height: trimmed.height })
    setTool('sign')
    setSignatureOpen(false)
    setMessage(null)
  }

  return (
    <div className="modal-backdrop" onMouseDown={() => setSignatureOpen(false)}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="signature-title"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            setSignatureOpen(false)
          }
        }}
      >
        <h2 id="signature-title">Signature</h2>
        <div className="mode-switch">
          <button type="button" className={mode === 'draw' ? 'active' : ''} onClick={() => setMode('draw')}>
            Draw
          </button>
          <button type="button" className={mode === 'type' ? 'active' : ''} onClick={() => setMode('type')}>
            Type
          </button>
        </div>
        {mode === 'type' ? (
          <label className="type-name">
            Name
            <input value={name} onChange={(event) => setName(event.target.value)} autoFocus />
          </label>
        ) : (
          <p className="hint">Draw in the box. This signature can be placed again until you refresh.</p>
        )}
        <canvas
          ref={canvasRef}
          width={640}
          height={200}
          className="signature-pad"
          onPointerDown={(event) => {
            if (mode !== 'draw' || event.button !== 0) return
            const canvas = canvasRef.current
            const context = canvas?.getContext('2d')
            if (!canvas || !context) return
            drawing.current = true
            canvas.setPointerCapture(event.pointerId)
            const point = canvasPoint(event)
            context.strokeStyle = '#1c1915'
            context.lineWidth = 2.5
            context.lineCap = 'round'
            context.lineJoin = 'round'
            context.beginPath()
            context.moveTo(point.x, point.y)
          }}
          onPointerMove={(event) => {
            if (!drawing.current || mode !== 'draw') return
            const context = canvasRef.current?.getContext('2d')
            if (!context) return
            const point = canvasPoint(event)
            context.lineTo(point.x, point.y)
            context.stroke()
          }}
          onPointerUp={() => {
            drawing.current = false
          }}
        />
        {message ? <p className="error">{message}</p> : null}
        <div className="modal-actions">
          <button type="button" onClick={clearCanvas}>
            Clear
          </button>
          <button type="button" onClick={() => setSignatureOpen(false)}>
            Cancel
          </button>
          <button type="button" className="primary" onClick={() => void confirm()}>
            Use signature
          </button>
        </div>
      </div>
    </div>
  )
}
