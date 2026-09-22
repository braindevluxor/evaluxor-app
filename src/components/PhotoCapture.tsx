import { useCallback, useEffect, useRef, useState } from 'react'
import { addPhoto, deletePhoto, getPhotos } from '../lib/offline/db'
import { comprimirFoto } from '../lib/fotos'
import { Button, Spinner } from './ui'

interface Props {
  photoIds: string[]
  onChange: (ids: string[]) => void
}

interface Preview {
  id: string
  url: string
  key: number
}

export function PhotoCapture({ photoIds, onChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [previews, setPreviews] = useState<Preview[]>([])
  const [subiendo, setSubiendo] = useState(false)
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

  async function onFiles(files: FileList | null) {
    if (!files || !files.length) return
    setSubiendo(true)
    const nuevos: string[] = []
    for (const f of Array.from(files)) {
      const { blob, mime } = await comprimirFoto(f)
      const id = await addPhoto(blob, mime)
      nuevos.push(id)
    }
    onChange([...photoIds, ...nuevos])
    setSubiendo(false)
  }

  async function quitar(id: string) {
    await deletePhoto(id)
    onChange(photoIds.filter((x) => x !== id))
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        {previews.map((p) => (
          <div key={p.id} className="group relative aspect-square overflow-hidden rounded-xl border border-slate-200">
            <img src={p.url} alt="Evidencia" className="h-full w-full object-cover" />
            <button
              type="button"
              onClick={() => void quitar(p.id)}
              className="absolute right-1 top-1 grid h-7 w-7 place-items-center rounded-full bg-slate-900/70 text-xs text-white"
              aria-label="Quitar foto"
            >
              ✕
            </button>
          </div>
        ))}
        {subiendo ? (
          <div className="grid aspect-square place-items-center rounded-xl border border-dashed border-slate-300">
            <Spinner />
          </div>
        ) : null}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        className="hidden"
        onChange={(e) => {
          void onFiles(e.target.files)
          e.target.value = ''
        }}
      />
      <Button type="button" variant="secondary" onClick={() => inputRef.current?.click()} disabled={subiendo}>
        📷 Tomar / agregar foto
      </Button>
    </div>
  )
}