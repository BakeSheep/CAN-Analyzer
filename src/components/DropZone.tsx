import { useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import { useI18n } from '../app/i18n'

interface DropZoneProps {
  onFile: (file: File) => void
  disabled: boolean
}

/** Local-file import area: click, keyboard, or drag & drop. */
export function DropZone({ onFile, disabled }: DropZoneProps) {
  const { t } = useI18n()
  const [dragActive, setDragActive] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file && !disabled) onFile(file)
    // Allow selecting the same file again later.
    event.target.value = ''
  }

  const handleDrop = (event: DragEvent) => {
    event.preventDefault()
    setDragActive(false)
    if (disabled) return
    const file = event.dataTransfer?.files?.[0]
    if (file) onFile(file)
  }

  return (
    <div
      data-testid="drop-zone"
      className={`drop-zone${dragActive ? ' drag-active' : ''}${disabled ? ' disabled' : ''}`}
      onDragOver={(event) => {
        event.preventDefault()
        if (!disabled) setDragActive(true)
      }}
      onDragLeave={() => setDragActive(false)}
      onDrop={handleDrop}
    >
      <p className="drop-zone-hint">{t('drop.hint')}</p>
      <label className="file-label">
        {t('drop.button')}
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.CSV,text/csv"
          onChange={handleChange}
          disabled={disabled}
        />
      </label>
    </div>
  )
}
