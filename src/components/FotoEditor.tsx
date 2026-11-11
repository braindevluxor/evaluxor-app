import { useEffect, useRef, useState, type PointerEvent as Dedo } from 'react'
import { Check, Pencil, Trash2, Undo2, X } from 'lucide-react'
import {
  COLORES_TRAZO,
  grosorEnImagen,
  pintarTrazos,
  puntoAImagen,
  quemarTrazos,
  type Trazo
} from '../lib/fotos'
import { Button, Modal, Spinner, cn } from './ui'

interface FotoAEditar {
  id: string
  url: string
  blob: Blob
}

/**
 * Editor de trazo sobre una foto de evidencia.
 *
 * Sirve para **resaltar un daño o un detalle** con el dedo: la rayadura, el
 * golpe, el sello ilegible. Al guardar, la marca se **quema** sobre el blob de
 * la foto conservando su id, así que el PDF, la nube y cualquier referencia
 * posterior ven la foto marcada sin que haya que regenerar ni re-subir nada a
 * mano: lo que se sube es exactamente el blob de acá.
 *
 * El lienzo cubre exactamente la imagen renderizada y el trazo se guarda en
 * coordenadas de la imagen final (no de la pantalla), así que la marca no se
 * mueve con el zoom ni con el tamaño del equipo.
 */
export function FotoEditor({
  foto,
  onGuardar,
  onCancel
}: {
  foto: FotoAEditar | null
  onGuardar: (id: string, blob: Blob, mime: string) => void
  onCancel: () => void
}) {
  const [imagen, setImagen] = useState<{ ancho: number; alto: number } | null>(null)
  const [trazos, setTrazos] = useState<Trazo[]>([])
  const [enCurso, setEnCurso] = useState<Trazo | null>(null)
  const [color, setColor] = useState<string>(COLORES_TRAZO[0].hex)
  const [guardando, setGuardando] = useState(false)
  const lienzoRef = useRef<HTMLCanvasElement>(null)

  // Cada foto entra con su propio lienzo limpio (el `src` cambia de foto).
  useEffect(() => {
    setImagen(null)
    setTrazos([])
    setEnCurso(null)
    setGuardando(false)
    if (!foto) return
    const img = new Image()
    img.onload = () => setImagen({ ancho: img.naturalWidth, alto: img.naturalHeight })
    img.src = foto.url
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [foto?.url])

  // Redibujo: los trazos ya hechos más el que va en curso con el dedo.
  useEffect(() => {
    const ctx = lienzoRef.current?.getContext('2d')
    if (!ctx || !imagen) return
    ctx.clearRect(0, 0, imagen.ancho, imagen.alto)
    pintarTrazos(ctx, enCurso ? [...trazos, enCurso] : trazos)
  }, [trazos, enCurso, imagen])

  function cajaDe(e: Dedo<HTMLCanvasElement>) {
    const r = e.currentTarget.getBoundingClientRect()
    return { left: r.left, top: r.top, ancho: r.width, alto: r.height }
  }

  function bajar(e: Dedo<HTMLCanvasElement>) {
    if (!imagen) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const caja = cajaDe(e)
    setEnCurso({
      color,
      grosor: grosorEnImagen(caja, imagen),
      puntos: [puntoAImagen({ x: e.clientX, y: e.clientY }, caja, imagen)]
    })
  }

  function mover(e: Dedo<HTMLCanvasElement>) {
    if (!enCurso || !imagen) return
    const punto = puntoAImagen({ x: e.clientX, y: e.clientY }, cajaDe(e), imagen)
    setEnCurso({ ...enCurso, puntos: [...enCurso.puntos, punto] })
  }

  function soltar(e: Dedo<HTMLCanvasElement>) {
    if (!enCurso) return
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    setTrazos((prev) => [...prev, enCurso])
    setEnCurso(null)
  }

  async function guardar() {
    if (!foto || !trazos.length) return
    setGuardando(true)
    try {
      const { blob, mime } = await quemarTrazos(foto.blob, trazos)
      // El id no cambia: la foto queda marcada para el PDF y para la nube.
      onGuardar(foto.id, blob, mime)
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Modal
      open={!!foto}
      onClose={onCancel}
      title="Marca el daño en la foto"
      wide
      backdropClassName="bg-slate-950/90"
      footer={
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={onCancel} className="flex-1">
            <X className="h-4 w-4" />
            Cancelar
          </Button>
          <Button
            type="button"
            variant="success"
            onClick={() => void guardar()}
            disabled={!trazos.length || guardando}
            className="flex-1"
          >
            {guardando ? <Spinner size={16} light /> : <Check className="h-4 w-4" />}
            {guardando ? 'Guardando…' : 'Guardar marca'}
          </Button>
        </div>
      }
    >
      {foto ? (
        <div className="space-y-3">
          <p className="text-xs text-slate-500">
            Dibuja con el dedo sobre la foto para señalar el daño; la marca queda guardada en la imagen.
          </p>
          <div className="relative mx-auto inline-block max-w-full rounded-lg bg-slate-950">
            <img
              src={foto.url}
              alt="Foto a marcar"
              draggable={false}
              className="block max-h-[48vh] w-auto max-w-full select-none rounded-lg"
            />
            {imagen ? (
              <canvas
                ref={lienzoRef}
                width={imagen.ancho}
                height={imagen.alto}
                aria-label="Lienzo para dibujar sobre la foto"
                className="absolute inset-0 h-full w-full touch-none rounded-lg"
                style={{ cursor: 'crosshair' }}
                onPointerDown={bajar}
                onPointerMove={mover}
                onPointerUp={soltar}
                onPointerCancel={soltar}
              />
            ) : null}
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3">
            {COLORES_TRAZO.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setColor(c.hex)}
                aria-label={`Trazo ${c.nombre}`}
                aria-pressed={color === c.hex}
                className={cn(
                  'grid h-9 w-9 place-items-center rounded-full border-2 transition-colors',
                  color === c.hex ? 'border-primary-900' : 'border-transparent hover:bg-slate-100'
                )}
              >
                <span className="h-6 w-6 rounded-full border border-slate-300" style={{ backgroundColor: c.hex }} />
              </button>
            ))}
            <button
              type="button"
              onClick={() => setTrazos((prev) => prev.slice(0, -1))}
              disabled={!trazos.length}
              aria-label="Deshacer el último trazo"
              title="Deshacer"
              className="grid h-9 w-9 place-items-center rounded-full text-slate-500 hover:bg-slate-100 disabled:opacity-40"
            >
              <Undo2 className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={() => setTrazos([])}
              disabled={!trazos.length}
              aria-label="Borrar todas las marcas"
              title="Borrar todo"
              className="grid h-9 w-9 place-items-center rounded-full text-slate-500 hover:bg-slate-100 disabled:opacity-40"
            >
              <Trash2 className="h-5 w-5" />
            </button>
          </div>

          <p className="flex items-center justify-center gap-1 text-[11px] text-slate-400">
            <Pencil className="h-3.5 w-3.5" />
            {trazos.length} marca{trazos.length === 1 ? '' : 's'} en esta foto
          </p>
        </div>
      ) : null}
    </Modal>
  )
}
