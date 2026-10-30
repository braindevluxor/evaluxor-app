import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, Image as ImageIcon, Pencil, Play, Video, X } from 'lucide-react'
import { addPhoto, deletePhoto, getPhotos, updatePhotoBlob } from '../lib/offline/db'
import { avisar } from '../lib/aviso'
import { comprimirFoto, duracionVideo, esVideo, LIMITE_SEGUNDOS_VIDEO } from '../lib/fotos'
import { destinoRespaldo, guardarEnGaleria } from '../lib/galeria'
import { Button, Spinner } from './ui'
import { FotoEditor } from './FotoEditor'
import { ModalImagen } from './ModalImagen'

interface Props {
  photoIds: string[]
  onChange: (ids: string[]) => void
}

interface Preview {
  id: string
  url: string
  blob: Blob
  /** MIME real: de él se colige si la miniatura es foto o video. */
  mime: string
  key: number
}

/**
 * Guarda las evidencias en la app: fotos comprimidas y videos tal cual.
 *
 * `respaldar` sólo se enciende cuando vinieron de la cámara: las elegidas desde
 * la galería ya están en el teléfono y copiarlas de nuevo sólo ensuciaría. La
 * copia se hace con el archivo original, sin comprimir, para que sirva de
 * rescate si algún día se pierde lo que hay dentro de la app. Los archivos
 * rechazados por el límite de duración tampoco se respaldan: no entraron.
 *
 * Los videos pasan sin tocar —el navegador no los transcodifica— y los que
 * duren más de `LIMITE_SEGUNDOS_VIDEO` se descartan con un aviso, que es la
 * única forma de frenar la subida en el celular.
 *
 * En PC de escritorio no hay copia: la guardaría en *Descargas* en cada foto
 * (eso lo reportó el usuario como ruido). La guarda vive dentro de
 * `guardarEnGaleria`, así que ningún llamador tiene que acordársela.
 */
export async function guardarFotosDe(files: FileList | null, respaldar = false): Promise<string[]> {
  if (!files || !files.length) return []
  const originales = Array.from(files)
  const ids: string[] = []
  const aceptados: File[] = []
  for (const f of originales) {
    if (esVideo(f.type)) {
      const duracion = await duracionVideo(f)
      if (duracion != null && duracion > LIMITE_SEGUNDOS_VIDEO + 0.5) {
        avisar(`El video dura ${Math.round(duracion)} segundos y el máximo es ${LIMITE_SEGUNDOS_VIDEO}. Gráballo más corto.`, 'error')
        continue
      }
      // Sin tipo declarado (algunos .mov del iPhone), el nombre lo delata.
      const mime = f.type || (/\.mov$/i.test(f.name) ? 'video/quicktime' : 'video/mp4')
      ids.push(await addPhoto(f, mime))
      aceptados.push(f)
      continue
    }
    const { blob, mime } = await comprimirFoto(f)
    ids.push(await addPhoto(blob, mime))
    aceptados.push(f)
  }
  if (respaldar && aceptados.length) await guardarEnGaleria(aceptados)
  return ids
}

export function MinaFotos({ photoIds, onQuitar }: { photoIds: string[]; onQuitar?: (id: string) => void }) {
  const [previews, setPreviews] = useState<Preview[]>([])
  const [imagenAbierta, setImagenAbierta] = useState<Preview | null>(null)
  const [editando, setEditando] = useState<Preview | null>(null)
  const keyRef = useRef(0)

  const cargarPreviews = useCallback(async () => {
    const recs = await getPhotos(photoIds)
    const prevs = recs.map((r) => ({
      id: r.id,
      url: URL.createObjectURL(r.blob),
      blob: r.blob,
      mime: r.mime,
      key: keyRef.current++
    }))
    setPreviews((old) => {
      old.forEach((p) => URL.revokeObjectURL(p.url))
      return prevs
    })
  }, [photoIds])

  // La marca se quema sobre el mismo id: al recargar, la miniatura y el PDF
  // ven la foto ya marcada, sin tocar ningún registro.
  function guardarMarca(id: string, blob: Blob, mime: string) {
    void updatePhotoBlob(id, blob, mime)
      .then(() => {
        setEditando(null)
        return cargarPreviews()
      })
      .catch(() => setEditando(null))
  }

  useEffect(() => {
    void cargarPreviews()
  }, [cargarPreviews])

  if (!previews.length) return null

  return (
    <div className="grid grid-cols-3 gap-2">
      {previews.map((p) => (
        <div key={p.id} className="relative aspect-square overflow-hidden rounded-xl border border-slate-200">
          <button type="button" onClick={() => setImagenAbierta(p)} aria-label="Ampliar evidencia" className="h-full w-full">
            {esVideo(p.mime) ? (
              <video src={p.url} preload="metadata" muted playsInline className="h-full w-full object-cover" />
            ) : (
              <img src={p.url} alt="Evidencia" className="h-full w-full object-cover" />
            )}
          </button>
          {/* La cruz de «play» es la única pista de que eso es un video y no
              una foto congelada: la miniatura sólo trae el primer cuadro. */}
          {esVideo(p.mime) ? (
            <span aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center">
              <span className="grid h-8 w-8 place-items-center rounded-full bg-slate-900/60 text-white">
                <Play className="h-4 w-4" />
              </span>
            </span>
          ) : null}
          {/* El lápiz quema trazos sobre el blob: no aplica a un video. */}
          {!esVideo(p.mime) ? (
            <button
              type="button"
              onClick={() => setEditando(p)}
              className="absolute bottom-1 left-1 grid h-7 w-7 place-items-center rounded-full bg-primary-900/80 text-white"
              aria-label="Marcar daño en la foto"
              title="Dibujar sobre la foto"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          ) : null}
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
        src={imagenAbierta?.url ?? null}
        esVideo={!!imagenAbierta && esVideo(imagenAbierta.mime)}
        alt="Evidencia"
        onClose={() => setImagenAbierta(null)}
        footer={
          !imagenAbierta || esVideo(imagenAbierta.mime) ? undefined : (
            <Button type="button" onClick={() => setEditando(imagenAbierta)} className="w-full">
              <Pencil className="h-4 w-4" />
              Dibujar sobre la foto
            </Button>
          )
        }
      />
      <FotoEditor
        foto={editando}
        onGuardar={guardarMarca}
        onCancel={() => setEditando(null)}
      />
    </div>
  )
}

export function PhotoCapture({ photoIds, onChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLInputElement>(null)
  const galeriaRef = useRef<HTMLInputElement>(null)
  const [subiendo, setSubiendo] = useState(false)
  // En PC no hay respaldo automático (sólo ensuciaría la carpeta Descargas),
  // así que el destino sólo se promete donde de verdad existe.
  const destino = destinoRespaldo()

  function quitar(id: string) {
    void deletePhoto(id)
    onChange(photoIds.filter((x) => x !== id))
  }

  async function agregar(input: HTMLInputElement, desdeCamara: boolean) {
    setSubiendo(true)
    const nuevos = await guardarFotosDe(input.files, desdeCamara)
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
        onChange={(e) => void agregar(e.target, true)}
      />
      {/* Cámara en modo video: el mismo `capture` abre la grabadora del
          teléfono. El límite de duración se valida al adjuntar, porque el
          sistema no deja limitar la grabación. */}
      <input
        ref={videoRef}
        type="file"
        accept="video/*"
        capture="environment"
        className="hidden"
        onChange={(e) => void agregar(e.target, true)}
      />
      <input
        ref={galeriaRef}
        type="file"
        accept="image/*,video/*"
        multiple
        className="hidden"
        onChange={(e) => void agregar(e.target, false)}
      />
      <div className="space-y-2">
        {subiendo ? (
          <div className="grid aspect-square w-full place-items-center rounded-xl bg-slate-50">
            <Spinner />
          </div>
        ) : null}
        <MinaFotos photoIds={photoIds} onQuitar={quitar} />
      </div>
      {/* Tres botones en fila, del mismo alto y alineados: foto, video y
          galería (que ya ofrece las dos cosas). */}
      <div className="grid grid-cols-3 gap-2">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={subiendo}
          aria-label="Tomar foto"
          className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-3 text-sm font-semibold text-white transition-colors hover:bg-primary-700 disabled:opacity-50"
        >
          <Camera className="h-5 w-5 shrink-0" />
          <span className="truncate">Foto</span>
        </button>
        <button
          type="button"
          onClick={() => videoRef.current?.click()}
          disabled={subiendo}
          aria-label="Grabar video"
          title={`Máximo ${LIMITE_SEGUNDOS_VIDEO} segundos por video`}
          className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-primary-200 bg-white px-3 text-sm font-semibold text-primary transition-colors hover:bg-primary-50 disabled:opacity-50"
        >
          <Video className="h-5 w-5 shrink-0" />
          <span className="truncate">Video</span>
        </button>
        <button
          type="button"
          onClick={() => galeriaRef.current?.click()}
          disabled={subiendo}
          aria-label="Adjuntar foto o video desde la galería"
          className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-primary-200 bg-white px-3 text-sm font-semibold text-primary transition-colors hover:bg-primary-50 disabled:opacity-50"
        >
          <ImageIcon className="h-5 w-5 shrink-0" />
          <span className="truncate">Galería</span>
        </button>
      </div>
      {/* El tope de duración no lo impone el teléfono al grabar, así que hay
          que decirlo: si no, el video se graba largo y se rechaza después. */}
      <p className="text-[11px] leading-tight text-slate-400">
        Máximo {LIMITE_SEGUNDOS_VIDEO} segundos por video.
      </p>
      {/* El respaldo es automático y no avisa en pantalla, así que acá se dice
          claramente dónde va a estar: no sirve de respaldo si nadie sabe que
          existe. En PC no hay respaldo y no se promete ningún destino. */}
      {destino !== 'ninguno' ? (
        <p className="text-[11px] leading-tight text-slate-400">
          {destino === 'fotos'
            ? 'Cada foto que tomes también se guarda en Fotos.'
            : 'Cada foto que tomes también se guarda en Descargas.'}
        </p>
      ) : null}
    </div>
  )
}