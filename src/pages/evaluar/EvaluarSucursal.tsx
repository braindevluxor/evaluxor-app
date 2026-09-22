import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useModulosActivos, useCatalog } from '../../context/CatalogContext'
import { getDraft, putDraft, type DraftEval } from '../../lib/offline/db'
import { ItemRenderer } from '../../components/ItemRenderer'
import { Button, Field, Input, ProgressBar } from '../../components/ui'
import { MobileLayout } from '../../components/layouts/MobileLayout'

export function EvaluarSucursal() {
  const { sucursalId = '' } = useParams()
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { modulosActivos, itemsDe } = useModulosActivos()
  const { sucursales } = useCatalog()
  const sucursal = sucursales.find((s) => s.id === sucursalId)

  const [draft, setDraft] = useState<DraftEval | null>(null)
  const [cargando, setCargando] = useState(true)
  const [idxModulo, setIdxModulo] = useState(() => {
    const raw = sessionStorage.getItem(`evx:${sucursalId}:mod`)
    return raw ? Number(raw) : 0
  })

  const guardadoRef = useRef<Map<string, number>>(new Map())
  const draftRef = useRef<DraftEval | null>(null)

  const modulos = useMemo(
    () => modulosActivos.filter((m) => itemsDe(m).length > 0),
    [modulosActivos, itemsDe]
  )

  useEffect(() => {
    if (!profile) return
    void (async () => {
      const existente = await getDraft(sucursalId)
      const d: DraftEval = existente ?? {
        sucursal_id: sucursalId,
        evaluador_id: profile.id,
        fecha: new Date().toISOString().slice(0, 10),
        comentario_general: '',
        puntuacion: null,
        respuestas: {},
        updated_at: Date.now()
      }
      setDraft(d)
      draftRef.current = d
      setCargando(false)
    })()
  }, [sucursalId, profile])

  useEffect(() => {
    if (!draft) return
    draftRef.current = draft
  }, [draft])

  useEffect(() => {
    const flush = () => {
      const d = draftRef.current
      if (d) void putDraft(d)
    }
    const onVis = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('pagehide', flush)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('pagehide', flush)
    }
  }, [])

  useEffect(() => {
    if (!modulos.length) return
    if (idxModulo >= modulos.length) setIdxModulo(modulos.length - 1)
  }, [modulos, idxModulo])

  if (cargando || !draft) {
    return <MobileLayout titulo="Cargando…"><div className="py-20 text-center text-slate-400">Cargando evaluación…</div></MobileLayout>
  }

  const actual = draft

  if (!modulos.length) {
    return (
      <MobileLayout titulo="Evaluación">
        <div className="rounded-2xl bg-white p-6 text-center">
          <p className="text-slate-600">No hay módulos con ítems configurados todavía. Pídele al Líder que active el catálogo.</p>
          <Link to="/evaluar" className="mt-4 inline-block font-semibold text-primary">← Volver</Link>
        </div>
      </MobileLayout>
    )
  }

  const modulo = modulos[Math.min(idxModulo, modulos.length - 1)]
  const items = itemsDe(modulo)

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
  }

  const respondidos = Object.keys(actual.respuestas).length
  const totalItems = modulos.reduce((a, m) => a + itemsDe(m).length, 0)
  const resumir = (m: typeof modulo) => itemsDe(m).filter((i) => actual.respuestas[i.id]).length

  return (
    <MobileLayout titulo="Evaluación" subtitulo={`Módulo ${idxModulo + 1} de ${modulos.length}`}>
      <div className="space-y-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
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
                onClick={() => setIdxModulo(i)}
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

        <div className="space-y-4">
          {items.map((item, i) => (
            <ItemRenderer
              key={item.id}
              item={item}
              index={i}
              total={items.length}
              valor={actual.respuestas[item.id]?.valor}
              shopId={sucursal?.shop_id}
              onChange={(v) => cambiarValor(item.id, v)}
            />
          ))}
        </div>

        <div className="flex gap-3 pt-2">
          <Button
            variant="secondary"
            onClick={() => {
              const n = idxModulo - 1
              sessionStorage.setItem(`evx:${sucursalId}:mod`, String(n))
              setIdxModulo(n)
            }}
            disabled={idxModulo === 0}
            className="flex-1"
          >
            ← Anterior
          </Button>
          {idxModulo < modulos.length - 1 ? (
            <Button
              variant="primary"
              className="flex-1"
              onClick={() => {
                const n = idxModulo + 1
                sessionStorage.setItem(`evx:${sucursalId}:mod`, String(n))
                setIdxModulo(n)
              }}
            >
              Siguiente →
            </Button>
          ) : (
            <Button variant="success" className="flex-1" onClick={() => navigate(`/evaluar/${sucursalId}/resumen`)}>
              Ver resumen ✓
            </Button>
          )}
        </div>

        <Field label="Fecha de la evaluación">
          <Input
            type="date"
            value={actual.fecha}
            onChange={(e) => {
              const nuevo = { ...actual, fecha: e.target.value }
              setDraft(nuevo)
              void putDraft(nuevo)
            }}
          />
        </Field>

        <div className="text-center">
          <Link to="/evaluar" className="text-sm font-medium text-slate-500 hover:text-primary">
            Guardar y salir
          </Link>
        </div>
      </div>
    </MobileLayout>
  )
}