import { useRef, useState } from 'react'
import { useEditorStore } from '../store/editorStore'
import { Logo } from './Logo'

export function DropZone() {
  const error = useEditorStore((state) => state.error)
  const opening = useEditorStore((state) => state.opening)
  const openFile = useEditorStore((state) => state.openFile)
  const [over, setOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  function takeFile(file: File | undefined) {
    if (file) void openFile(file)
  }

  return (
    <div className="drop-screen">
      <div
        className={over ? 'drop-card over' : 'drop-card'}
        onDragOver={(event) => {
          event.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault()
          setOver(false)
          takeFile(event.dataTransfer.files[0])
        }}
      >
        <Logo />
        <p className="eyebrow">PDF editor</p>
        <h1>Open a PDF</h1>
        <p className="lead">Drop a file here, or browse from this computer.</p>
        <button type="button" onClick={() => inputRef.current?.click()} disabled={opening}>
          {opening ? 'Opening…' : 'Browse'}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          hidden
          onChange={(event) => {
            takeFile(event.target.files?.[0])
            event.target.value = ''
          }}
        />
        {error ? <p className="error">{error}</p> : null}
        <ul className="limits">
          <li>The file stays in this browser. Nothing is uploaded.</li>
          <li>Drag across a few words or several lines to replace them. A scanned page has no text layer.</li>
          <li>Very large PDFs can run out of memory in the tab.</li>
        </ul>
      </div>
    </div>
  )
}
