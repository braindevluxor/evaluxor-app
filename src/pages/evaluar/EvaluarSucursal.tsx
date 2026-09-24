import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Check, List } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useModulosActivos, useCatalog } from '../../context/CatalogContext'
import { useOffline } from '../../context/OfflineContext'
import { getDraft, putDraft, type DraftEval } from '../../lib/offline/db'
import { guardarBorradorNube } from '../../lib/offline/sync'
import { listarEvaluacionesActivas, listarRespuestasEvaluacion } from '../../lib/data/indicadores'
import { ItemRenderer } from '../../components/ItemRenderer'
import { Button, ProgressBar, EmptyState, Modal, cn } from '../../components/ui'
import { MobileLayout } from '../../components/layouts/MobileLayout'

export function EvaluarSucursal() {
  const { sucursalId = '' } = useParams()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { online } = useOffline()
  const { modulosActivos, itemsDe } = useModulosActivos(sucursalId)
  const { sucursales } = useCatalog()
  const sucursal = sucursales.find((s) => s.id === sucursalId)

  const [draft, setDraft] = useState<DraftEval | null>(null)
  const [sinActiva, setSinActiva] = useState(false)
  const [cargando, setCargando] = useState(true)
  const [navAbierta, setNavAbierta] = useState(false)
  const [idxModulo, setIdxModulo] = useState(() => {
    const raw = sessionStorage.getItem(`evx:${sucursalId}:mod`)
    return raw ? Number(raw) : 0
  })
  const [idxItem, setIdxItem] = useState(() => {
    const raw = sessionStorage.getItem(`evx:${sucursalId}:item`)
    const n = raw ? Number(raw) : 0
    return Number.isFinite(n) && n >= 0 ? n : 0
  })

  const guardadoRef = useRef<Map<string, number>>(new Map())
  const evaluacionIdRef = useRef<string | null>(null)
  const draftRef = useRef<DraftEval | null>(null)
  const nubeTimer = useRef<number | null>(null)

  function agendarNube() {
    if (nubeTimer.current) window.clearTimeout(nubeTimer.current)
    nubeTimer.current = window.setTimeout(() => {
      const d = draftRef.current
      const evId = evaluacionIdRef.current
      if (!d || !evId || !online) return
      const entries = Object.entries(d.respuestas)
      if (!entries.length) return
      void guardarBorradorNube(evId, d.evaluador_id, entries.map(([item_id, r]) => ({ item_id, valor: r.valor }))).catch(() => undefined)
    }, 800)
  }

  useEffect(() => {
    if (draft) draftRef.current = draft
  }, [draft])

  useEffect(() => {
    const flush = () => {
      const d = draftRef.current
      const evId = evaluacionIdRef.current
      if (!d) return
      void putDraft(d)
      if (!evId) return
      const entries = Object.entries(d.respuestas)
      if (!entries.length) return
      void guardarBorradorNube(evId, d.evaluador_id, entries.map(([item_id, r]) => ({ item_id, valor: r.valor }))).catch(() => undefined)
    }
    window.addEventListener('beforeunload', flush)
    return () => {
      flush()
      window.removeEventListener('beforeunload', flush)
      if (nubeTimer.current) window.clearTimeout(nubeTimer.current)
    }
  }, [])

  useEffect(() => {
    if (!online) return
    const d = draftRef.current
    const evId = evaluacionIdRef.current
    if (!d || !evId) return
    const entries = Object.entries(d.respuestas)
    if (!entries.length) return
    void guardarBorradorNube(evId, d.evaluador_id, entries.map(([item_id, r]) => ({ item_id, valor: r.valor }))).catch(() => undefined)
  }, [online])

  const modulos = useMemo(
    () => modulosActivos.filter((m) => itemsDe(m).length > 0),
    [modulosActivos, itemsDe]
  )

  useEffect(() => {
    if (!profile) return
    void (async () => {
      const activas = await listarEvaluacionesActivas().catch(() => [])
      const activa = activas.find((e) => e.sucursal_id === sucursalId)
      if (!activa) {
        setSinActiva(true)
        setCargando(false)
        return
      }
      evaluacionIdRef.current = activa.id
      const existente = await getDraft(sucursalId)
      const enNube = await listarRespuestasEvaluacion(activa.id).catch(() => [])
      const nubeMias: DraftEval['respuestas'] = {}
      for (const r of enNube) {
        if (r.respondido_por === profile.id) nubeMias[r.item_id] = { valor: r.valor }
      }
      const d: DraftEval = {
        sucursal_id: sucursalId,
        evaluador_id: profile.id,
        fecha: activa.fecha,
        comentario_general: existente?.comentario_general ?? '',
        puntuacion: existente?.puntuacion ?? null,
        respuestas: { ...nubeMias, ...(existente?.respuestas ?? {}) },
        updated_at: Date.now()
      }
      await putDraft(d).catch(() => undefined)
      setDraft(d)
      setCargando(false)
    })()
  }, [sucursalId, profile])

  useEffect(() => {
    if (!modulos.length) return
    if (idxModulo >= modulos.length) setIdxModulo(modulos.length - 1)
    const itemsActuales = itemsDe(modulos[Math.min(idxModulo, modulos.length - 1)]).length
    if (idxItem >= itemsActuales) setIdxItem(Math.max(0, itemsActuales - 1))
  }, [modulos, idxModulo, idxItem, itemsDe])

  if (cargando) {
    return <MobileLayout titulo="Cargando…"><div className="py-20 text-center text-slate-400">Cargando evaluación…</div></MobileLayout>
  }

  if (sinActiva) {
    return (
      <MobileLayout titulo="Evaluación">
        <EmptyState
          title="No hay evaluación abierta"
          subtitle="El Líder aún no ha abierto la evaluación de esta sucursal. Cuando la aperture podrás llenar tus módulos."
        />
        <div className="text-center">
          <Link to="/evaluar" className="inline-flex items-center gap-1 text-sm font-semibold text-primary"><ArrowLeft className="h-4 w-4" /> Volver</Link>
        </div>
      </MobileLayout>
    )
  }

  const actual = draft!
  if (!actual) return <MobileLayout titulo="Evaluación"><div className="py-20 text-center text-slate-400">Cargando…</div></MobileLayout>

  if (!modulos.length) {
    return (
      <MobileLayout titulo="Evaluación">
        <div className="rounded-2xl bg-white p-6 text-center">
          <p className="text-slate-600">
            {profile?.rol === 'EVALUADOR'
              ? 'No tienes módulos asignados para esta evaluación. Pídele al Líder que te asigne módulos.'
              : 'La configuración de esta sucursal no deja módulos con ítems activos para evaluar. Revisa los módulos/ítems de la sucursal en Configuración o actívalos en Ítems de evaluación.'}
          </p>
          <Link to="/evaluar" className="mt-4 inline-flex items-center gap-1 font-semibold text-primary"><ArrowLeft className="h-4 w-4" /> Volver</Link>
        </div>
      </MobileLayout>
    )
  }

  const modulo = modulos[Math.min(idxModulo, modulos.length - 1)]
  const items = itemsDe(modulo)
  const item = items[Math.min(idxItem, items.length - 1)]
  const itemsEnModulo = items.length
  const ultimoItemModulo = idxItem >= itemsEnModulo - 1
  const ultimoModulo = idxModulo >= modulos.length - 1

  const irSiguiente = () => {
    if (!ultimoItemModulo) {
      const n = idxItem + 1
      sessionStorage.setItem(`evx:${sucursalId}:item`, String(n))
      setIdxItem(n)
      return
    }
    if (!ultimoModulo) {
      const n = idxModulo + 1
      sessionStorage.setItem(`evx:${sucursalId}:mod`, String(n))
      sessionStorage.setItem(`evx:${sucursalId}:item`, '0')
      setIdxModulo(n)
      setIdxItem(0)
      return
    }
    navigate(`/evaluar/${sucursalId}/resumen`)
  }

  const irAnterior = () => {
    if (idxItem > 0) {
      const n = idxItem - 1
      sessionStorage.setItem(`evx:${sucursalId}:item`, String(n))
      setIdxItem(n)
      return
    }
    if (idxModulo > 0) {
      const n = idxModulo - 1
      const prevItems = itemsDe(modulos[n]).length
      sessionStorage.setItem(`evx:${sucursalId}:mod`, String(n))
      sessionStorage.setItem(`evx:${sucursalId}:item`, String(prevItems - 1))
      setIdxModulo(n)
      setIdxItem(prevItems - 1)
    }
  }

  function cambiarValor(itemId: string, valor: unknown) {
    const nuevo: DraftEval = {
      ...actual,
      respuestas: { ...actual.respuestas, [itemId]: { valor } }
    }
    setDraft(nuevo)
    const now = Date.now()
    const ultimo = guardadoRef.current.get(itemId) ?? 0
    if (now - ultimo > 400) {
      void putDraft(nuevo)
      guardadoRef.current.set(itemId, now)
    }
    agendarNube()
  }

  const respondidos = Object.keys(actual.respuestas).length
  const totalItems = modulos.reduce((a, m) => a + itemsDe(m).length, 0)
  const resumir = (m: typeof modulo) => itemsDe(m).filter((i) => actual.respuestas[i.id]).length

  return (
    <MobileLayout
      titulo="Evaluación"
      subtitulo={`Módulo ${idxModulo + 1} de ${modulos.length} · ${new Date(`${actual.fecha}T12:00:00`).toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' })}`}
    >
      <div className="space-y-4">
        <div className="rounded-2xl bg-white p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-bold text-primary-900">Progreso</p>
            <p className="text-xs text-slate-500">
              {respondidos}/{totalItems} ítems
            </p>
          </div>
          <ProgressBar value={(respondidos / Math.max(totalItems, 1)) * 100} className="mt-2" />
          <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1">
            {modulos.map((m, i) => (
              <button
                key={m.id}
                onClick={() => {
                  sessionStorage.setItem(`evx:${sucursalId}:mod`, String(i))
                  sessionStorage.setItem(`evx:${sucursalId}:item`, '0')
                  setIdxModulo(i)
                  setIdxItem(0)
                }}
                className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                  i === idxModulo ? 'bg-primary text-white' : resumir(m) === itemsDe(m).length ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-500'
                }`}
              >
                {i + 1}. {m.nombre}
                <span className="ml-1 opacity-70">({resumir(m)}/{itemsDe(m).length})</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <ItemRenderer
            key={`${modulo.id}-${item.id}`}
            item={item}
            index={idxItem}
            total={itemsEnModulo}
            valor={actual.respuestas[item.id]?.valor}
            shopId={sucursal?.shop_id}
            branchId={sucursal?.branch_id}
            onChange={(v) => cambiarValor(item.id, v)}
          />
        </div>

        <div className="h-28" />
      </div>

      <div className="fixed inset-x-0 bottom-0 z-40 bg-white">
        <div className="mx-auto flex w-full max-w-md items-center gap-3 px-4 py-3">
          <Button
            variant="secondary"
            onClick={irAnterior}
            disabled={idxModulo === 0 && idxItem === 0}
            className="flex-1"
          >
            <ArrowLeft className="h-4 w-4" /> Anterior
          </Button>
          <Button
            variant="secondary"
            className="shrink-0 px-3"
            onClick={() => setNavAbierta(true)}
            aria-label="Navegación rápida de ítems"
            title="Navegación rápida de ítems"
          >
            <List className="h-5 w-5" />
          </Button>
          {!ultimoItemModulo ? (
            <Button variant="primary" className="flex-1" onClick={irSiguiente}>
              Siguiente <ArrowRight className="h-4 w-4" />
            </Button>
          ) : !ultimoModulo ? (
            <Button variant="primary" className="flex-1" onClick={irSiguiente}>
              Siguiente módulo <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button variant="success" className="flex-1" onClick={() => navigate(`/evaluar/${sucursalId}/resumen`)}>
              Ver resumen <Check className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      <Modal open={navAbierta} onClose={() => setNavAbierta(false)} title={`Ítems · ${modulo.nombre}`}>
        <ul className="space-y-1">
          {items.map((it, i) => {
            const respondido = !!actual.respuestas[it.id]
            const activo = i === idxItem
            return (
              <li key={it.id}>
                <button
                  type="button"
                  onClick={() => {
                    sessionStorage.setItem(`evx:${sucursalId}:item`, String(i))
                    setIdxItem(i)
                    setNavAbierta(false)
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm transition-colors',
                    activo ? 'bg-primary text-white' : 'text-slate-700 hover:bg-slate-50'
                  )}
                >
                  <span
                    className={cn(
                      'grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold',
                      activo ? 'bg-white/20' : respondido ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'
                    )}
                  >
                    {respondido ? <Check className="h-3.5 w-3.5" /> : i + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{it.texto}</span>
                  {activo ? <span className="shrink-0 text-xs font-semibold">Actual</span> : null}
                </button>
              </li>
            )
          })}
        </ul>
        <p className="mt-3 text-center text-xs text-slate-400">Toca un ítem para ir directo a él.</p>
      </Modal>
    </MobileLayout>
  )
}