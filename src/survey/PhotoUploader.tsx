import { useRef, useState } from 'react'
import { resizeImageFile } from './resizeImage'

interface Props {
  photos: File[]
  onChange: (photos: File[]) => void
  max?: number
}

const RESIZE_OPTIONS = { maxDimension: 1600, quality: 0.8 }

export default function PhotoUploader({ photos, onChange, max = 5 }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [processing, setProcessing] = useState(false)

  async function addFiles(files: FileList | null) {
    if (!files) return
    const remaining = Math.max(0, max - photos.length)
    const incoming = Array.from(files).slice(0, remaining)
    if (incoming.length === 0) return

    setProcessing(true)
    try {
      const resized = await Promise.all(
        incoming.map((file) =>
          resizeImageFile(file, RESIZE_OPTIONS).catch(() => file),
        ),
      )
      onChange([...photos, ...resized])
    } finally {
      setProcessing(false)
    }
  }

  function removeAt(index: number) {
    onChange(photos.filter((_, i) => i !== index))
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-gray-900">
          Photos of the sidewalk conditions
        </span>
        <span className="text-xs text-gray-500">
          {photos.length}/{max}
        </span>
      </div>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={photos.length >= max || processing}
        className="w-full rounded-md border-2 border-dashed border-gray-300 px-4 py-6 text-sm text-gray-500 hover:border-sky-500 hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {processing ? 'Processing photos…' : `Click to add photos (up to ${max})`}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          void addFiles(e.target.files)
          e.target.value = ''
        }}
      />
      {photos.length > 0 && (
        <ul className="grid grid-cols-3 gap-2">
          {photos.map((photo, i) => (
            <li key={`${photo.name}-${i}`} className="relative">
              <img
                src={URL.createObjectURL(photo)}
                alt={photo.name}
                className="h-20 w-full rounded-md object-cover"
              />
              <button
                type="button"
                onClick={() => removeAt(i)}
                className="absolute -right-1 -top-1 h-5 w-5 rounded-full bg-rose-600 text-xs font-bold text-white shadow"
                aria-label={`Remove ${photo.name}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
