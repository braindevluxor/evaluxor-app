import { useEffect, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { FotoEditor } from './FotoEditor'

interface FotoDeNube {
  /** El path del bucket ES el id de la foto: se re-graba en el mismo lugar. */
  id: string
  url: string
  blob: Blob
}

export interface MarcadorNube {
  /** Baja la foto del bucket y abre el editor sobre ella. */
  abrir: (path: string) => void
  /** Cierra el editor sin guardar. */
  cerrar: () => void
  /** Último fallo (permisos o conexión). Lo muestra el propio `editor`. */
  error: string | null
  /** Sube con cada marca guardada: quien muestre las fotos la agrega a los deps de sus URLs firmadas. */
  version: number
  /** Se monta una sola vez en la pantalla: editor + avisos de estado. */
  editor: ReactNode
}

/**
 * Dibujar sobre fotos que ya viven en el bucket.
 *
 * Las fotos de las incidencias y de las evidencias de las evaluaciones se suben
 * pronto y dejan de existir en el equipo. Este módulo las descarga, deja
 * marcarlas con el mismo `FotoEditor` de siempre y las vuelve a subir **al mismo
 * path** con `upsert`: como la marca queda quemada en el blob, la ven igual el
 * visor, el detalle y el PDF de esa evaluación, sin mover ni duplicar nada.
 *
 * Después de cada marca, `version` sube: es la señal para que las galerías
 * vuelvan a pedir URLs firmadas, porque la vieja sigue sirviendo la foto
 * anterior. El editor se cierra al guardar y los avisos (pill de progreso y
 * error) van aparte, sobre la galería, para que nunca queden tapados por el
 * modal de la foto.
 */
export function useMarcadorNube(): MarcadorNube {
  const [foto, setFoto] = useState<FotoDeNube | null>(null)
  const [fase, setFase] = useState<'bajar' | 'subir' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)

  // La URL del blob es temporal: se revoca al cambiar de foto y al desmontar.
  useEffect(() => {
    if (!foto) return
    return () => URL.revokeObjectURL(foto.url)
  }, [foto])

  function abrir(path: string) {
    setError(null)
    setFase('bajar')
    void supabase.storage
      .from('evidencias')
      .download(path)
      .then(({ data, error: fallo }) => {
        if (fallo || !data) {
          setError('No se pudo bajar la foto de la nube para marcarla. Revisa la conexión.')
          return
        }
        setFoto({ id: path, url: URL.createObjectURL(data), blob: data })
      })
      .finally(() => setFase(null))
  }

  function guardar(path: string, blob: Blob, mime: string) {
    setError(null)
    // El editor se cierra de una: lo que sigue es subir, y si algo sale mal el
    // aviso se ve sobre la galería, no tapado por el modal.
    setFoto(null)
    setFase('subir')
    void supabase.storage
      .from('evidencias')
      .upload(path, blob, { contentType: mime, upsert: true })
      .then(({ error: fallo }) => {
        if (fallo) {
          setError('No se pudo guardar la marca en la nube. Revisa los permisos de la foto o la conexión.')
          return
        }
        setVersion((v) => v + 1)
      })
      .finally(() => setFase(null))
  }

  function cerrar() {
    setFoto(null)
  }

  const editor: ReactNode = (
    <>
      <FotoEditor foto={foto} onGuardar={guardar} onCancel={cerrar} />
      {fase && !foto && !error ? (
        <p className="pointer-events-none fixed inset-x-0 bottom-24 z-[150] mx-auto w-fit rounded-full bg-slate-900/90 px-4 py-2 text-xs font-semibold text-white shadow-lg">
          {fase === 'bajar' ? 'Abriendo la foto…' : 'Guardando la marca…'}
        </p>
      ) : null}
      {error ? (
        <div
          role="alert"
          className="fixed inset-x-0 bottom-24 z-[150] mx-auto flex w-fit max-w-[92vw] items-center gap-3 rounded-xl bg-red-600 px-4 py-2.5 text-xs font-semibold text-white shadow-lg"
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            aria-label="Cerrar aviso"
            className="shrink-0 rounded-full p-0.5 hover:bg-red-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}
    </>
  )

  return { abrir, cerrar, error, version, editor }
}
