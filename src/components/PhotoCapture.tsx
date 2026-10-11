import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, Image as ImageIcon, X } from 'lucide-react'
import { addPhoto, deletePhoto, getPhotos } from '../lib/offline/db'
import { comprimirFoto } from '../lib/fotos'
import { Spinner } from './ui'
import { ModalImagen } from './ModalImagen'

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

export function MinaFotos({ photoIds, onQuitar }: { photoIds: string[]; onQuitar?: (id: string) => void }) {
  const [previews, setPreviews] = useState<Preview[]>([])
  const [imagenAbierta, setImagenAbierta] = useState<string | null>(null)
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
          <button type="button" onClick={() => setImagenAbierta(p.url)} aria-label="Ampliar evidencia" className="h-full w-full">
            <img src={p.url} alt="Evidencia" className="h-full w-full object-cover" />
          </button>
          <button
            type="button"
            onClick={() => onQuitar?.(p.id)}
            className="absolute right-1 top-1 grid h-7 w-7 place-items-center rounded-full bg-slate-900/70 text-white"
            aria-label="Quitar foto"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
      <ModalImagen
        src={imagenAbierta}
        alt="Evidencia"
        onClose={() => setImagenAbierta(null)}
      />
    </div>
  )
}

export function PhotoCapture({ photoIds, onChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const galeriaRef = useRef<HTMLInputElement>(null)
  const [subiendo, setSubiendo] = useState(false)

  function quitar(id: string) {
    void deletePhoto(id)
    onChange(photoIds.filter((x) => x !== id))
  }

  async function agregar(input: HTMLInputElement) {
    setSubiendo(true)
    const nuevos = await guardarFotosDe(input.files)
    setSubiendo(false)
    if (nuevos.length) onChange([...photoIds, ...nuevos])
    input.value = ''
  }

  return (
    <div className="space-y-3">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        className="hidden"
        onChange={(e) => void agregar(e.target)}
      />
      <input
        ref={galeriaRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => void agregar(e.target)}
      />
      <div className="space-y-2">
        {subiendo ? (
          <div className="grid aspect-square w-full place-items-center rounded-xl bg-slate-50">
            <Spinner />
          </div>
        ) : null}
        <MinaFotos photoIds={photoIds} onQuitar={quitar} />
      </div>
      {/* Dos botones en fila, del mismo alto y alineados: antes iban apilados y
          desfasados a la derecha, y quedaban como círculos sueltos. */}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={subiendo}
          aria-label="Tomar foto"
          className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-3 text-sm font-semibold text-white transition-colors hover:bg-primary-700 disabled:opacity-50"
        >
          <Camera className="h-5 w-5 shrink-0" />
          <span className="truncate">Tomar foto</span>
        </button>
        <button
          type="button"
          onClick={() => galeriaRef.current?.click()}
          disabled={subiendo}
          aria-label="Adjuntar foto desde la galería"
          className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-primary-200 bg-white px-3 text-sm font-semibold text-primary transition-colors hover:bg-primary-50 disabled:opacity-50"
        >
          <ImageIcon className="h-5 w-5 shrink-0" />
          <span className="truncate">Galería</span>
        </button>
      </div>
    </div>
  )
}