import { useRef, useState } from 'react'
import site from '../content/site.json' with { type: 'json' }
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
    <main className="drop-screen">
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
        <p className="eyebrow">{site.tagline}</p>
        <h1>{site.headline}</h1>
        <p className="lead">{site.lead}</p>
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
          {site.limits.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </div>
      <section className="about" aria-labelledby="capabilities">
        <h2 id="capabilities">{site.featuresHeading}</h2>
        <ul className="features">
          {site.features.map((feature) => (
            <li key={feature.title}>
              <h3>{feature.title}</h3>
              <p>{feature.body}</p>
            </li>
          ))}
        </ul>
      </section>
    </main>
  )
}
