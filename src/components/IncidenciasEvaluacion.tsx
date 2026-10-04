import { useEffect, useState } from 'react'
import { AlertTriangle, Camera, ChevronLeft, ChevronRight } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { ChipsResponsables } from './EditorResponsablesIncidencia'
import { normalizarResponsables, type ResponsableIncidencia } from '../lib/data/responsablesIncidencia'
import { Skeleton, Spinner } from './ui'
import { ModalImagen } from './ModalImagen'

export interface IncidenciaFila {
  id: string
  descripcion: string
  fotos: string[]
  modulo_id: string | null
  /** Cargos responsables, tal como los cargo el evaluador. */
  responsables: ResponsableIncidencia[]
  created_at: string
  /** PostgREST devuelve las relaciones embebidas como arreglo. */
  evaluador?: { nombre: string }[] | null
  modulo?: { nombre: string }[] | null
}

/**
 * Incidencias que los evaluadores reportaron durante la visita (fuera de lo
 * programado). Solo el LÍDER las ve: es la vista de "qué encontré en la tienda
 * que no estaba en el cuestionario".
 */
export function IncidenciasEvaluacion({ evaluacionId }: { evaluacionId: string }) {
  const [filas, setFilas] = useState<IncidenciaFila[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)
  const [urlsFotos, setUrlsFotos] = useState<Record<string, Record<string, string>>>({})
  const [imagenAbierta, setImagenAbierta] = useState<{ incidenciaId: string; src: string } | null>(null)

  useEffect(() => {
    let vivo = true
    void (async () => {
      try {
        const { data, error: queryError } = await supabase
          .from('incidencias')
          .select('id, descripcion, fotos, modulo_id, evaluador_id, created_at, responsables, modulo:modulos!incidencias_modulo_id_fkey(nombre)')
          .eq('evaluacion_id', evaluacionId)
          .order('created_at', { ascending: false })
        if (!vivo) return
        if (queryError) {
          setError(queryError.message)
          setFilas([])
          return
        }

        const incidencias = (data ?? []) as Array<{
          id: string
          descripcion: string
          fotos: string[]
          modulo_id: string | null
          evaluador_id: string
          created_at: string
          responsables?: unknown
          modulo?: { nombre: string }[] | null
        }>

        const evaluadorIds = [...new Set(incidencias.map((i) => i.evaluador_id).filter(Boolean))]
        const nombresPorEvaluador = new Map<string, string>()
        if (evaluadorIds.length) {
          const { data: perfiles, error: perfilError } = await supabase
            .from('profiles')
            .select('id, nombre')
            .in('id', evaluadorIds)
          if (perfilError) {
            throw perfilError
          }
          for (const perfil of perfiles ?? []) {
            if (perfil.id && perfil.nombre) nombresPorEvaluador.set(perfil.id, perfil.nombre)
          }
        }

        const filasNormalizadas: IncidenciaFila[] = incidencias.map((item) => ({
          id: item.id,
          descripcion: item.descripcion,
          fotos: item.fotos ?? [],
          modulo_id: item.modulo_id,
          // Sin normalizar, el jsonb crudo llega directo a la vista y una incidencia
          // vieja (sin la columna) rompería el render.
          responsables: normalizarResponsables(item.responsables),
          created_at: item.created_at,
          evaluador: nombresPorEvaluador.has(item.evaluador_id) ? [{ nombre: nombresPorEvaluador.get(item.evaluador_id)! }] : null,
          modulo: item.modulo ? item.modulo : null
        }))

        setFilas(filasNormalizadas)
        setError(null)
      } catch (e) {
        if (!vivo) return
        setError(e instanceof Error ? e.message : 'No se pudieron cargar las incidencias.')
        setFilas([])
      } finally {
        if (vivo) setCargando(false)
      }
    })()
    return () => {
      vivo = false
    }
  }, [evaluacionId])

  useEffect(() => {
    let vivo = true
    const paths = Array.from(new Set((filas ?? []).flatMap((fila) => fila.fotos)))
    if (!paths.length) {
      setUrlsFotos({})
      return () => { vivo = false }
    }
    void (async () => {
      try {
        const { data, error: errorFotos } = await supabase.storage.from('evidencias').createSignedUrls(paths, 3600)
        if (errorFotos) throw errorFotos
        if (!vivo) return
        const urlsPorPath: Record<string, string> = {}
        for (const foto of data ?? []) {
          if (foto.path && foto.signedUrl) urlsPorPath[foto.path] = foto.signedUrl
        }
        const nuevasUrls: Record<string, Record<string, string>> = {}
        for (const fila of filas ?? []) {
          nuevasUrls[fila.id] = Object.fromEntries(
            fila.fotos.filter((path) => urlsPorPath[path]).map((path) => [path, urlsPorPath[path]])
          )
        }
        setUrlsFotos(nuevasUrls)
      } catch {
        if (vivo) setUrlsFotos({})
      }
    })()
    return () => { vivo = false }
  }, [filas])

  const incidenciasConFoto = (filas ?? []).filter((fila) =>
    fila.fotos.some((path) => urlsFotos[fila.id]?.[path])
  )
  const indiceIncidencia = imagenAbierta
    ? incidenciasConFoto.findIndex((fila) => fila.id === imagenAbierta.incidenciaId)
    : -1
  const incidenciaAbierta = indiceIncidencia >= 0 ? incidenciasConFoto[indiceIncidencia] : null

  function navegarIncidencia(direccion: -1 | 1) {
    const siguiente = incidenciasConFoto[indiceIncidencia + direccion]
    if (!siguiente) return
    const src = siguiente.fotos.map((path) => urlsFotos[siguiente.id]?.[path]).find(Boolean)
    if (src) setImagenAbierta({ incidenciaId: siguiente.id, src })
  }

  if (cargando) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <Skeleton className="h-4 w-48" />
      </section>
    )
  }

  if (!filas) return null

  return (
    <section className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4 shadow-sm">
      <div className="mb-1 flex items-center gap-2">
        <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" />
        <p className="font-bold text-amber-900">Incidencias reportadas ({filas.length})</p>
      </div>
      <p className="mb-3 text-xs text-amber-800/80">
        Lo que los evaluadores vieron en la tienda y no está en el cuestionario.
      </p>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-700">
          No se pudieron cargar las incidencias: {error}
        </div>
      ) : !filas.length ? (
        <div className="rounded-xl border border-dashed border-amber-200 bg-white/70 px-3 py-3 text-sm text-amber-800/80">
          No hay incidencias reportadas para esta evaluación.
        </div>
      ) : (
        <ul className="space-y-3">
          {filas.map((f) => (
            <li key={f.id} className="rounded-xl border border-amber-200 bg-white px-3 py-2.5">
              <p className="text-sm text-slate-800">{f.descripcion}</p>
              <p className="mt-1 text-[11px] text-slate-500">
                {f.evaluador?.[0]?.nombre ?? 'Evaluador'} · {f.modulo?.[0]?.nombre ?? 'Sin módulo'}
                {f.created_at
                  ? ` · ${new Date(f.created_at).toLocaleString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`
                  : ''}
              </p>
              {/* Los cargos van debajo del nombre, y los pendientes de validar
                  aparte: el Líder necesita ver qué está verificado y qué se
                  escribió a mano en la tienda. */}
              <ChipsResponsables valor={f.responsables} className="mt-1.5" />
              {f.responsables.some((r) => r.porValidar) ? (
                <p className="mt-1 text-[11px] text-amber-700">
                  Hay cargos escritos sin catálogo: no se pudieron verificar.
                </p>
              ) : null}
              {f.fotos?.length ? (
                <FotosIncidencia
                  paths={f.fotos}
                  urls={urlsFotos[f.id] ?? {}}
                  onAbrir={(src) => setImagenAbierta({ incidenciaId: f.id, src })}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <ModalImagen
        src={imagenAbierta?.src ?? null}
        alt="Foto de la incidencia"
        onClose={() => setImagenAbierta(null)}
        footer={incidenciaAbierta ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => navegarIncidencia(-1)}
                disabled={indiceIncidencia <= 0}
                aria-label="Incidencia anterior"
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-slate-200 text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <p className="text-xs font-semibold text-slate-500">
                Incidencia {indiceIncidencia + 1} de {incidenciasConFoto.length}
              </p>
              <button
                type="button"
                onClick={() => navegarIncidencia(1)}
                disabled={indiceIncidencia >= incidenciasConFoto.length - 1}
                aria-label="Siguiente incidencia"
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-slate-200 text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Observación</p>
              <p className="whitespace-pre-wrap text-sm text-slate-700">{incidenciaAbierta.descripcion}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Responsable</p>
              <ChipsResponsables valor={incidenciaAbierta.responsables} className="mt-1" />
            </div>
          </div>
        ) : undefined}
      />
    </section>
  )
}

/** Miniaturas con URL firmada (el bucket `evidencias` es privado). */
function FotosIncidencia({ paths, urls, onAbrir }: {
  paths: string[]
  urls: Record<string, string>
  onAbrir: (src: string) => void
}) {
  return (
    <div className="mt-2">
      <div className="mb-1.5 flex items-center gap-1 text-[11px] text-amber-700">
        <Camera className="h-3.5 w-3.5" /> {paths.length} foto(s)
      </div>
      <div className="flex flex-wrap gap-2">
        {paths.map((p) =>
          urls[p] ? (
            <button
              key={p}
              type="button"
              onClick={() => onAbrir(urls[p])}
              title="Ver foto de la incidencia"
              aria-label="Ampliar foto de la incidencia"
            >
              <img src={urls[p]} alt="Foto de la incidencia" className="h-16 w-16 rounded-lg border border-slate-200 object-cover" />
            </button>
          ) : (
            <div key={p} className="grid h-16 w-16 place-items-center rounded-lg border border-slate-200 bg-slate-50">
              <Spinner size={16} />
            </div>
          )
        )}
      </div>
    </div>
  )
}
