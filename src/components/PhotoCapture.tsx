import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, X } from 'lucide-react'
import { addPhoto, deletePhoto, getPhotos } from '../lib/offline/db'
import { comprimirFoto } from '../lib/fotos'
import { Spinner } from './ui'

interface Props {
  photoIds: string[]
  onChange: (ids: string[]) => void
}

interface Preview {
  id: string
  url: string
  key: number
}

export async function guardarFotosDe(files: FileList | null): Promise<string[]> {
  if (!files || !files.length) return []
  const ids: string[] = []
  for (const f of Array.from(files)) {
    const { blob, mime } = await comprimirFoto(f)
    ids.push(await addPhoto(blob, mime))
  }
  return ids
}

export function MinaFotos({ photoIds, onQuitar }: { photoIds: string[]; onQuitar: (id: string) => void }) {
  const [previews, setPreviews] = useState<Preview[]>([])
  const keyRef = useRef(0)

  const cargarPreviews = useCallback(async () => {
    const recs = await getPhotos(photoIds)
    const prevs = recs.map((r) => ({
      id: r.id,
      url: URL.createObjectURL(r.blob),
      key: keyRef.current++
    }))
    setPreviews((old) => {
      old.forEach((p) => URL.revokeObjectURL(p.url))
      return prevs
    })
  }, [photoIds])

  useEffect(() => {
    void cargarPreviews()
  }, [cargarPreviews])

  if (!previews.length) return null

  return (
    <div className="grid grid-cols-3 gap-2">
      {previews.map((p) => (
        <div key={p.id} className="relative aspect-square overflow-hidden rounded-xl border border-slate-200">
          <img src={p.url} alt="Evidencia" className="h-full w-full object-cover" />
          <button
            type="button"
            onClick={() => onQuitar(p.id)}
            className="absolute right-1 top-1 grid h-7 w-7 place-items-center rounded-full bg-slate-900/70 text-white"
            aria-label="Quitar foto"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  )
}

export function PhotoCapture({ photoIds, onChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [subiendo, setSubiendo] = useState(false)

  function quitar(id: string) {
    void deletePhoto(id)
    onChange(photoIds.filter((x) => x !== id))
  }

  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex-1 space-y-2">
        {subiendo ? (
          <div className="grid aspect-square w-full place-items-center rounded-xl border border-dashed border-slate-300">
            <Spinner />
          </div>
        ) : null}
        <MinaFotos photoIds={photoIds} onQuitar={quitar} />
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        className="hidden"
        onChange={(e) => {
          void (async () => {
            setSubiendo(true)
            const nuevos = await guardarFotosDe(e.target.files)
            setSubiendo(false)
            if (nuevos.length) onChange([...photoIds, ...nuevos])
          })()
          e.target.value = ''
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={subiendo}
        aria-label="Tomar / agregar foto"
        className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-primary text-white transition-colors hover:bg-primary-700 disabled:opacity-50"
      >
        <Camera className="h-5 w-5" />
      </button>
    </div>
  )
}