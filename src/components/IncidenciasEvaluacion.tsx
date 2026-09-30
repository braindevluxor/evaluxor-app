import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Camera } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { Skeleton, Spinner } from './ui'

export interface IncidenciaFila {
  id: string
  descripcion: string
  fotos: string[]
  modulo_id: string | null
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

  useEffect(() => {
    let vivo = true
    void (async () => {
      try {
        const { data, error: queryError } = await supabase
          .from('incidencias')
          .select('id, descripcion, fotos, modulo_id, evaluador_id, created_at, modulo:modulos!incidencias_modulo_id_fkey(nombre)')
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
          modulo?: { nombre: string }[] | null
        }>

        const evaluadorIds = [...new Set(incidencias.map((i) => i.evaluador_id).filter(Boolean))]
        let nombresPorEvaluador = new Map<string, string>()
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
              {f.fotos?.length ? <FotosIncidencia paths={f.fotos} /> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** Miniaturas con URL firmada (el bucket `evidencias` es privado). */
function FotosIncidencia({ paths }: { paths: string[] }) {
  const [urls, setUrls] = useState<Record<string, string>>({})
  const clave = useMemo(() => paths.join('|'), [paths])

  useEffect(() => {
    let vivo = true
    void (async () => {
      try {
        const { data } = await supabase.storage.from('evidencias').createSignedUrls(paths, 3600)
        if (!vivo) return
        const map: Record<string, string> = {}
        for (const d of data ?? []) if (d.signedUrl && d.path) map[d.path] = d.signedUrl
        setUrls(map)
      } catch {
        if (vivo) setUrls({})
      }
    })()
    return () => {
      vivo = false
    }
  }, [clave, paths])

  return (
    <div className="mt-2">
      <div className="mb-1.5 flex items-center gap-1 text-[11px] text-amber-700">
        <Camera className="h-3.5 w-3.5" /> {paths.length} foto(s)
      </div>
      <div className="flex flex-wrap gap-2">
        {paths.map((p) =>
          urls[p] ? (
            <a key={p} href={urls[p]} target="_blank" rel="noreferrer" title="Ver foto de la incidencia">
              <img src={urls[p]} alt="Foto de la incidencia" className="h-16 w-16 rounded-lg border border-slate-200 object-cover" />
            </a>
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
