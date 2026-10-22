import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Check, RefreshCw } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { obtenerEvaluacion, type DetalleEvaluacion } from '../lib/data/indicadores'
import { puedeCorregirConciliacion } from '../lib/roles'
import { claveRespuesta } from '../lib/pasos'
import { guardarBorradorNube } from '../lib/offline/sync'
import { etiquetaTipo } from '../lib/scoring'
import { ConciliacionEditor } from '../components/ItemRenderer'
import { Badge, Button, Skeleton, cn } from '../components/ui'

type EstadoGuardado = 'espera' | 'guardando' | 'ok' | 'error'

/** Valores de la evaluación indexados por par (ítem, registro), con la misma
 * clave que usa el borrador del evaluador (`claveRespuesta`). */
function mapaDeRespuestas(d: DetalleEvaluacion): Record<string, unknown> {
  const v: Record<string, unknown> = {}
  for (const r of d.respuestas) v[claveRespuesta(r.item_id, r.instancia_id)] = r.valor
  return v
}

export function EditarConciliacion() {
  const { evaluacionId = '' } = useParams()
  const navigate = useNavigate()
  const { profile } = useAuth()

  const [detalle, setDetalle] = useState<DetalleEvaluacion | null>(null)
  const [estado, setEstado] = useState<'cargando' | 'error' | 'ok'>('cargando')
  const [valores, setValores] = useState<Record<string, unknown>>({})
  const [guardado, setGuardado] = useState<Record<string, EstadoGuardado>>({})

  const guardadoRef = useRef<Map<string, number>>(new Map())
  const valoresRef = useRef<Record<string, unknown>>({})

  useEffect(() => {
    valoresRef.current = valores
  }, [valores])

  useEffect(() => {
    void (async () => {
      const d = await obtenerEvaluacion(evaluacionId)
      if (!d) {
        setEstado('error')
        return
      }
      setDetalle(d)
      setValores(mapaDeRespuestas(d))
      setEstado('ok')
    })()
  }, [evaluacionId])

  const estadoEval = detalle?.evaluacion.estado ?? null
  /**
   * ¿Se puede escribir en esta evaluación?
   *
   * El editor se abre desde el historial también para evaluaciones cerradas (el
   * lápiz del historial no mira el estado), y antes `guardar` devolvía acá sin
   * más: el Líder confirmaba el borrado, la fila no se movía y el producto
   * seguía en el detalle, que es justo lo que reportaron. Ver
   * `puedeCorregirConciliacion`.
   */
  const editable = !!profile && !!estadoEval && puedeCorregirConciliacion(profile.rol, estadoEval)

  /**
   * Guarda un bloque. El `instancia_id` que viaja es el del bloque que se está
   * mirando: mandar siempre `null` —lo que hacía antes— creaba una fila nueva
   * al lado de la que el detalle lee, y el producto reaparecía.
   */
  const guardar = (clave: string, itemId: string, instanciaId: string | null, valor: unknown) => {
    if (!editable) return
    setValores((prev) => ({ ...prev, [clave]: valor }))
    setGuardado((g) => ({ ...g, [clave]: 'guardando' }))
    if (guardadoRef.current.get(clave)) window.clearTimeout(guardadoRef.current.get(clave))
    const timer = window.setTimeout(() => {
      void guardarBorradorNube(evaluacionId, profile.id, [{ item_id: itemId, instancia_id: instanciaId, valor }])
        .then(() => setGuardado((g) => ({ ...g, [clave]: 'ok' })))
        .catch(() => setGuardado((g) => ({ ...g, [clave]: 'error' })))
    }, 600)
    guardadoRef.current.set(clave, timer)
  }

  const reintentar = (clave: string, itemId: string, instanciaId: string | null) => {
    const v = valoresRef.current[clave]
    if (v !== undefined) guardar(clave, itemId, instanciaId, v)
  }

  useEffect(() => () => {
    for (const t of guardadoRef.current.values()) window.clearTimeout(t)
  }, [])

  if (estado === 'cargando') {
    return (
      <div className="space-y-4">
        <div className="space-y-2">
          <Skeleton className="h-8 w-72" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-10 w-40 rounded-full" />
            <Skeleton className="h-10 w-10 rounded-full" />
          </div>
        ))}
      </div>
    )
  }

  if (estado === 'error' || !detalle) {
    return (
      <div className="min-h-screen bg-slate-50 p-4">
        <div className="rounded-2xl border border-slate-200 bg-white py-12 text-center text-slate-500">
          <p className="font-bold text-slate-700">Evaluación no disponible</p>
          <p className="mt-1 text-sm">No tienes permiso para verla o no existe.</p>
          <Button variant="secondary" className="mt-4" onClick={() => navigate(-1)}><ArrowLeft className="h-4 w-4" /> Volver</Button>
        </div>
      </div>
    )
  }

  const { evaluacion, items } = detalle
  const itemsConciliacion = items.filter((i) => i.tipo === 'CONCILIACION')
  const activa = evaluacion.estado === 'ACTIVA'
  const shopId = evaluacion.sucursal?.shop_id ?? null
  /**
   * Un editor por cada lista de productos que existe de verdad: una si el ítem
   * no tiene registros, y una por registro si los tiene. Antes había uno solo
   * por ítem y se colaban todas las listas en el mismo casillero.
   *
   * Una respuesta vive por PAR (ítem, registro), no por ítem —la misma clave que
   * usa el borrador del evaluador en el teléfono.
   */
  const bloquesDe = (item: (typeof items)[number]) => {
    const instancias = detalle.instancias.filter((x) => x.item_id === item.id).sort((a, b) => a.orden - b.orden)
    if (!instancias.length) return [{ clave: claveRespuesta(item.id, null), instanciaId: null, etiqueta: null }]
    return instancias.map((x) => ({ clave: claveRespuesta(item.id, x.id), instanciaId: x.id, etiqueta: x.etiqueta }))
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-10">
      <header className="sticky top-0 z-30 bg-primary text-white">
        <div className="mx-auto flex max-w-2xl items-center gap-2 px-4 py-3">
          <button onClick={() => navigate(-1)} className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/10 hover:bg-white/20" title="Volver">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0">
            <h1 className="truncate text-base font-extrabold">Editar conciliación</h1>
            <p className="truncate text-xs text-white/80">
              {evaluacion.departamento?.nombre ?? evaluacion.sucursal?.nombre ?? 'Sucursal'} · {new Date(`${evaluacion.fecha}T12:00:00`).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' })}
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-4 px-4 py-4">
        {activa ? (
          <p className="rounded-xl bg-green-50 px-3 py-2 text-sm font-medium text-green-700">
            Los cambios se guardan automáticamente en la nube y el Líder los ve en el detalle.
          </p>
        ) : (
          <div className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700">
            Esta evaluación está <b>{evaluacion.estado === 'CERRADA' ? 'cerrada' : 'programada'}</b>, pero puedes corregir los productos escaneados: el puntaje ya registrado no cambia, sólo el balance de conciliación.
          </div>
        )}

        {itemsConciliacion.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white py-12 text-center text-slate-500">
            <p className="font-bold text-slate-700">Sin ítems de conciliación</p>
            <p className="mt-1 text-sm">Esta evaluación no tiene respuestas con productos escaneados.</p>
          </div>
        ) : (
          itemsConciliacion.map((item) => (
            <section key={item.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <div className="flex items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-4 py-3">
                <p className="text-sm font-semibold text-primary-900">{item.texto}</p>
                <Badge color={6}>{etiquetaTipo(item.tipo)}</Badge>
              </div>
              {bloquesDe(item).map((b) => {
                const g = guardado[b.clave] ?? 'espera'
                return (
                  <div key={b.clave} className="p-4">
                    {b.etiqueta ? (
                      <p className="mb-2 rounded-lg bg-slate-50 px-3 py-1.5 text-xs font-bold text-slate-600">
                        Registro · {b.etiqueta}
                      </p>
                    ) : null}
                    <ConciliacionEditor
                      valor={valores[b.clave]}
                      onChange={(v) => guardar(b.clave, item.id, b.instanciaId, v)}
                      shopId={shopId}
                      item={item}
                    />
                    <div className={cn('mt-2 flex items-center justify-end gap-1.5 text-[11px] font-bold', g === 'ok' ? 'text-green-600' : g === 'error' ? 'text-red-500' : 'text-slate-400')}>
                      {g === 'guardando' ? (<><RefreshCw className="h-3 w-3 animate-spin" /> Guardando…</>) : null}
                      {g === 'ok' ? (<><Check className="h-3 w-3" /> Guardado en la nube</>) : null}
                      {g === 'error' ? (
                        <button type="button" onClick={() => reintentar(b.clave, item.id, b.instanciaId)} className="underline">
                          Error al guardar · reintentar
                        </button>
                      ) : null}
                      {g === 'espera' ? 'Edita una cantidad para guardar' : null}
                    </div>
                  </div>
                )
              })}
            </section>
          ))
        )}
      </main>
    </div>
  )
}