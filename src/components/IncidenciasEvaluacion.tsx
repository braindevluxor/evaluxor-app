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
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    let vivo = true
    void (async () => {
      try {
        const { data, error } = await supabase
          .from('incidencias')
          .select('id, descripcion, fotos, modulo_id, created_at, evaluador:profiles(nombre), modulo:modulos(nombre)')
          .eq('evaluacion_id', evaluacionId)
          .order('created_at', { ascending: false })
        if (!vivo) return
        // Si la tabla todavía no existe en Supabase, la sección queda vacía en vez
        // de romper la pantalla del detalle.
        setFilas(error || !data ? [] : (data as IncidenciaFila[]))
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

  if (!filas?.length) return null

  return (
    <section className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4 shadow-sm">
      <div className="mb-1 flex items-center gap-2">
        <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600" />
        <p className="font-bold text-amber-900">Incidencias reportadas ({filas.length})</p>
      </div>
      <p className="mb-3 text-xs text-amber-800/80">
        Lo que los evaluadores vieron en la tienda y no está en el cuestionario.
      </p>
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
