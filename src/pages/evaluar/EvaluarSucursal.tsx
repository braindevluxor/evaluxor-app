import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Check, FolderOpen, List, Plus, Tag, Trash2, X } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useModulosActivos, useCatalog } from '../../context/CatalogContext'
import { useOffline } from '../../context/OfflineContext'
import { hijosOrdenados } from '../../lib/hierarchy'
import { claveRespuesta, pasosDeModulo, raicesDeModulo } from '../../lib/pasos'
import { getDraft, putDraft, normalizarClave, instanciasPlanasDe, type DraftEval, type DraftInstancia } from '../../lib/offline/db'
import { guardarBorradorNube, instanciasDeDraft, respuestasConInstancia } from '../../lib/offline/sync'
import { listarEvaluacionesActivas, listarRespuestasEvaluacion, listarInstanciasEvaluacion } from '../../lib/data/indicadores'
import { supabase } from '../../lib/supabase'
import { ItemRenderer } from '../../components/ItemRenderer'
import { Button, EmptyState, Modal, cn } from '../../components/ui'
import { MobileLayout } from '../../components/layouts/MobileLayout'
import type { Item } from '../../lib/types'

interface RegistroActivo {
  seccionId: string
  instanciaId: string
  etiqueta: string
}

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
  const [modulosAbierta, setModulosAbierta] = useState(false)
  const [idxModulo, setIdxModulo] = useState(() => {
    const raw = sessionStorage.getItem(`evx:${sucursalId}:mod`)
    return raw ? Number(raw) : 0
  })
  const [idxItem, setIdxItem] = useState(() => {
    const raw = sessionStorage.getItem(`evx:${sucursalId}:item`)
    const n = raw ? Number(raw) : 0
    return Number.isFinite(n) && n >= 0 ? n : 0
  })
  // Sub-flujo dentro de una sección repetible: qué registro está evaluando y en qué ítem va.
  const [registro, setRegistro] = useState<RegistroActivo | null>(null)
  const [idxRegistro, setIdxRegistro] = useState(0)
  const [etiquetaNueva, setEtiquetaNueva] = useState('')
  const [focoEtiqueta, setFocoEtiqueta] = useState(0)
  const [confirmarBorrar, setConfirmarBorrar] = useState<string | null>(null)
  const etiquetaInputRef = useRef<HTMLInputElement | null>(null)

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
      const respuestas = respuestasConInstancia(d)
      const instancias = instanciasDeDraft(d)
      if (!respuestas.length && !instancias.length) return
      void guardarBorradorNube(evId, d.evaluador_id, respuestas, instancias).catch(() => undefined)
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
      const respuestas = respuestasConInstancia(d)
      const instancias = instanciasDeDraft(d)
      if (!respuestas.length && !instancias.length) return
      void guardarBorradorNube(evId, d.evaluador_id, respuestas, instancias).catch(() => undefined)
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
    const respuestas = respuestasConInstancia(d)
    const instancias = instanciasDeDraft(d)
    if (!respuestas.length && !instancias.length) return
    void guardarBorradorNube(evId, d.evaluador_id, respuestas, instancias).catch(() => undefined)
  }, [online])

  useEffect(() => {
    if (focoEtiqueta > 0) etiquetaInputRef.current?.focus()
  }, [focoEtiqueta])

  const modulos = useMemo(
    () => modulosActivos.filter((m) => itemsDe(m).some((i) => i.tipo !== 'CONTENEDOR')),
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
      const [enNube, instanciasNube] = await Promise.all([
        listarRespuestasEvaluacion(activa.id).catch(() => []),
        listarInstanciasEvaluacion(activa.id).catch(() => [])
      ])
      const nubeMias: DraftEval['respuestas'] = {}
      for (const r of enNube) {
        if (r.respondido_por === profile.id) nubeMias[claveRespuesta(r.item_id, r.instancia_id)] = { valor: r.valor }
      }
      // Borradores locales antiguos: claves sin '::' se normalizan; instancias ausentes → {}.
      const respLocal: DraftEval['respuestas'] = {}
      for (const [k, v] of Object.entries(existente?.respuestas ?? {})) respLocal[normalizarClave(k)] = v
      const instanciasLocales: Record<string, DraftInstancia[]> = structuredClone(existente?.instancias ?? {})
      for (const ins of instanciasNube) {
        const ya = (instanciasLocales[ins.item_id] ?? []).some((i) => i.id === ins.id)
        if (!ya) (instanciasLocales[ins.item_id] ??= []).push({ id: ins.id, etiqueta: ins.etiqueta, orden: ins.orden })
      }
      const d: DraftEval = {
        sucursal_id: sucursalId,
        evaluador_id: profile.id,
        fecha: activa.fecha,
        comentario_general: existente?.comentario_general ?? '',
        puntuacion: existente?.puntuacion ?? null,
        respuestas: { ...nubeMias, ...respLocal },
        instancias: instanciasLocales,
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
    const raices = raicesDeModulo(itemsDe(modulos[Math.min(idxModulo, modulos.length - 1)]))
    if (idxItem >= raices.length) setIdxItem(Math.max(0, raices.length - 1))
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
  const itemsModulo = itemsDe(modulo)
  const pasosRaices = raicesDeModulo(itemsModulo)
  const paso = pasosRaices[Math.min(idxItem, pasosRaices.length - 1)]
  const esSeccion = paso?.tipo === 'CONTENEDOR'
  const ultimoPasoModulo = idxItem >= pasosRaices.length - 1
  const ultimoModulo = idxModulo >= modulos.length - 1

  const seccion = registro ? itemsModulo.find((i) => i.id === registro.seccionId) : undefined
  const hijosSeccion = registro ? hijosOrdenados(itemsModulo, registro.seccionId) : []
  const hijoActual = registro ? hijosSeccion[Math.min(idxRegistro, hijosSeccion.length - 1)] : undefined
  const instanciasDeSeccion = (seccionId: string) => actual.instancias?.[seccionId] ?? []
  const instanciaIndex = registro ? instanciasDeSeccion(registro.seccionId).findIndex((i) => i.id === registro.instanciaId) : -1
  const ultimoHijo = registro ? idxRegistro >= hijosSeccion.length - 1 : false

  const pasosDe = (m: typeof modulo) => pasosDeModulo(itemsDe(m), instanciasPlanasDe(actual))
  const resumir = (m: typeof modulo) => pasosDe(m).filter((p) => actual.respuestas[p.key]).length
  const hechoModulo = resumir(modulo)
  const totalModulo = pasosDe(modulo).length
  const pctModulo = totalModulo ? Math.round((hechoModulo / totalModulo) * 100) : 0

  const guardarPaso = (mod: number, item: number) => {
    sessionStorage.setItem(`evx:${sucursalId}:mod`, String(mod))
    sessionStorage.setItem(`evx:${sucursalId}:item`, String(item))
  }

  const irSiguiente = () => {
    if (registro) {
      if (!ultimoHijo) {
        setIdxRegistro(idxRegistro + 1)
      } else {
        setRegistro(null)
        setFocoEtiqueta((n) => n + 1)
      }
      return
    }
    if (!ultimoPasoModulo) {
      const n = idxItem + 1
      guardarPaso(idxModulo, n)
      setIdxItem(n)
      return
    }
    if (!ultimoModulo) {
      const n = idxModulo + 1
      guardarPaso(n, 0)
      setIdxModulo(n)
      setIdxItem(0)
      return
    }
    navigate(`/evaluar/${sucursalId}/resumen`)
  }

  const irAnterior = () => {
    if (registro) {
      if (idxRegistro > 0) {
        setIdxRegistro(idxRegistro - 1)
      } else {
        setRegistro(null)
      }
      return
    }
    if (idxItem > 0) {
      const n = idxItem - 1
      guardarPaso(idxModulo, n)
      setIdxItem(n)
      return
    }
    if (idxModulo > 0) {
      const n = idxModulo - 1
      const prev = raicesDeModulo(itemsDe(modulos[n])).length
      guardarPaso(n, Math.max(0, prev - 1))
      setIdxModulo(n)
      setIdxItem(Math.max(0, prev - 1))
    }
  }

  const volverSeccion = () => {
    if (!registro) return
    setRegistro(null)
    setIdxRegistro(0)
  }

  const entrarRegistro = (seccionItem: Item, ins: DraftInstancia) => {
    setRegistro({ seccionId: seccionItem.id, instanciaId: ins.id, etiqueta: ins.etiqueta })
    setIdxRegistro(0)
    setNavAbierta(false)
  }

  function cambiarValor(itemId: string, instanciaId: string | null, valor: unknown) {
    const key = claveRespuesta(itemId, instanciaId)
    const nuevo: DraftEval = {
      ...actual,
      respuestas: { ...actual.respuestas, [key]: { valor } }
    }
    setDraft(nuevo)
    const now = Date.now()
    const ultimo = guardadoRef.current.get(key) ?? 0
    if (now - ultimo > 400) {
      void putDraft(nuevo)
      guardadoRef.current.set(key, now)
    }
    agendarNube()
  }

  function agregarRegistro() {
    if (!esSeccion) return
    const etiqueta = etiquetaNueva.trim()
    if (!etiqueta) return
    const previas = actual.instancias?.[paso.id] ?? []
    const ins: DraftInstancia = { id: crypto.randomUUID(), etiqueta, orden: previas.length }
    const nuevo: DraftEval = {
      ...actual,
      instancias: { ...actual.instancias, [paso.id]: [...previas, ins] }
    }
    setDraft(nuevo)
    setEtiquetaNueva('')
    void putDraft(nuevo)
    agendarNube()
    setRegistro({ seccionId: paso.id, instanciaId: ins.id, etiqueta })
    setIdxRegistro(0)
  }

  function eliminarInstancia(instanciaId: string) {
    if (!esSeccion) return
    const resto = instanciasDeSeccion(paso.id).filter((i) => i.id !== instanciaId)
    const respuestas: DraftEval['respuestas'] = {}
    for (const [k, v] of Object.entries(actual.respuestas)) {
      if (!k.endsWith(`::${instanciaId}`)) respuestas[k] = v
    }
    const nuevo: DraftEval = {
      ...actual,
      respuestas,
      instancias: { ...actual.instancias, [paso.id]: resto }
    }
    setDraft(nuevo)
    setConfirmarBorrar(null)
    void putDraft(nuevo)
    agendarNube()
    if (online) {
      void (async () => {
        try {
          await supabase.from('instancias_grupo').delete().eq('id', instanciaId)
        } catch {
          // El borrado local ya quedó aplicado; la nube se reconcilia con el próximo envío.
        }
      })()
    }
  }

  const burbuja = (
    <button
      type="button"
      onClick={() => setModulosAbierta(true)}
      aria-label="Progreso por módulos"
      title="Progreso por módulos"
      className="flex shrink-0 items-center gap-2 rounded-full bg-white/15 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-white/25"
    >
      <span className="grid h-6 min-w-6 place-items-center rounded-full bg-white px-1 text-[11px] font-extrabold text-primary">
        {idxModulo + 1}
      </span>
      {pctModulo}%
    </button>
  )

  return (
    <MobileLayout
      titulo="Evaluación"
      subtitulo={`Módulo ${idxModulo + 1} de ${modulos.length} · ${new Date(`${actual.fecha}T12:00:00`).toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' })}`}
      extra={burbuja}
    >
      <div className="space-y-4">
        {registro && seccion && hijoActual ? (
          <div>
            <div className="mb-3 flex items-center gap-2 rounded-xl border border-primary-200 bg-primary-50 px-3 py-2">
              <FolderOpen className="h-4 w-4 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-bold uppercase tracking-wide text-primary-500">Sección · Registro {instanciaIndex + 1} de {instanciasDeSeccion(registro.seccionId).length}</p>
                <p className="truncate text-sm font-bold text-primary-900">{seccion.texto} · {registro.etiqueta}</p>
              </div>
              <button onClick={volverSeccion} className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/70 text-primary-700 hover:bg-white" title="Volver a la sección" aria-label="Volver a la sección">
                <X className="h-4 w-4" />
              </button>
            </div>
            <ItemRenderer
              key={`${modulo.id}-${registro.instanciaId}-${hijoActual.id}`}
              item={hijoActual}
              index={idxRegistro}
              total={hijosSeccion.length}
              valor={actual.respuestas[claveRespuesta(hijoActual.id, registro.instanciaId)]?.valor}
              shopId={sucursal?.shop_id}
              branchId={sucursal?.branch_id}
              onChange={(v) => cambiarValor(hijoActual.id, registro.instanciaId, v)}
            />
          </div>
        ) : esSeccion && paso ? (
          <div className="space-y-4">
            <div className="rounded-2xl bg-white p-4">
              <div className="flex items-center gap-2 rounded-xl border border-primary-200 bg-primary-50 px-3 py-2">
                <FolderOpen className="h-4 w-4 shrink-0 text-primary" />
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-primary-500">Sección repetible</p>
                  <p className="truncate text-sm font-bold text-primary-900">{paso.texto}</p>
                </div>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-slate-500">
                Esta sección se repite por <b>registro</b>. Cada registro lleva un identificador (ej. placa, código, nombre…)
                y evalúa sus {hijosOrdenados(itemsModulo, paso.id).length} ítems. Cuando termines uno, podés agregar otro y seguir tantas veces como necesites.
              </p>
            </div>

            <div className="rounded-2xl bg-white p-4">
              <div className="flex items-center justify-between">
                <p className="font-bold text-primary-900">Registros</p>
                <p className="text-xs text-slate-500">{instanciasDeSeccion(paso.id).length} creado(s)</p>
              </div>

              {instanciasDeSeccion(paso.id).length === 0 ? (
                <div className="mt-3 rounded-xl border border-dashed border-slate-300 px-4 py-6 text-center text-xs text-slate-400">
                  Todavía no hay registros. Escribí un identificador y tocá «Agregar registro» para evaluar el primero.
                </div>
              ) : (
                <ul className="mt-3 space-y-2">
                  {instanciasDeSeccion(paso.id).map((ins, i) => {
                    const hijos = hijosOrdenados(itemsModulo, paso.id)
                    const hechos = hijos.filter((h) => actual.respuestas[claveRespuesta(h.id, ins.id)]).length
                    const completo = hijos.length > 0 && hechos === hijos.length
                    return (
                      <li key={ins.id} className="flex items-center gap-2 rounded-xl border border-slate-200 p-2.5">
                        <button type="button" onClick={() => entrarRegistro(paso, ins)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                          <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-full', completo ? 'bg-green-100 text-green-700' : 'bg-primary-50 text-primary')}>
                            {completo ? <Check className="h-4 w-4" /> : <Tag className="h-4 w-4" />}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold text-slate-800">
                              Registro {i + 1} · <span className="text-primary-900">{ins.etiqueta}</span>
                            </span>
                            <span className="block text-[11px] text-slate-500">
                              {hechos}/{hijos.length} ítems {completo ? '· completo' : ''}
                            </span>
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmarBorrar(ins.id)}
                          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-slate-400 hover:bg-red-50 hover:text-red-600"
                          title="Eliminar registro"
                          aria-label={`Eliminar registro ${ins.etiqueta}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}

              <div className="mt-3 flex gap-2">
                <input
                  ref={etiquetaInputRef}
                  value={etiquetaNueva}
                  onChange={(e) => setEtiquetaNueva(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      if (etiquetaNueva.trim()) agregarRegistro()
                    }
                  }}
                  placeholder="Identificador (ej. placa, código, nombre…)"
                  className="min-w-0 flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary-200"
                />
                <Button variant="primary" className="shrink-0" disabled={!etiquetaNueva.trim()} onClick={agregarRegistro}>
                  <Plus className="h-4 w-4" /> Agregar
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div>
            <ItemRenderer
              key={`${modulo.id}-${paso?.id}`}
              item={paso}
              index={idxItem}
              total={pasosRaices.length}
              valor={paso ? actual.respuestas[claveRespuesta(paso.id)]?.valor : undefined}
              shopId={sucursal?.shop_id}
              branchId={sucursal?.branch_id}
              onChange={(v) => cambiarValor(paso.id, null, v)}
            />
          </div>
        )}

        <div className="h-28" />
      </div>

      <div className="fixed inset-x-0 bottom-0 z-40 bg-white">
        <div className="mx-auto flex w-full max-w-md items-center gap-3 px-4 py-3">
          <Button
            variant="secondary"
            onClick={irAnterior}
            disabled={!registro && idxModulo === 0 && idxItem === 0}
            className="flex-1"
          >
            <ArrowLeft className="h-4 w-4" /> Anterior
          </Button>
          <Button
            variant="secondary"
            className="shrink-0 px-3"
            onClick={() => setNavAbierta(true)}
            aria-label="Navegación rápida"
            title="Navegación rápida"
          >
            <List className="h-5 w-5" />
          </Button>
          {registro ? (
            ultimoHijo ? (
              <>
                <Button variant="secondary" className="flex-1" onClick={volverSeccion}>
                  Terminar
                </Button>
                <Button variant="primary" className="flex-1" onClick={irSiguiente}>
                  Agregar otro registro <Plus className="h-4 w-4" />
                </Button>
              </>
            ) : (
              <Button variant="primary" className="flex-1" onClick={irSiguiente}>
                Siguiente <ArrowRight className="h-4 w-4" />
              </Button>
            )
          ) : !ultimoPasoModulo ? (
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

      <Modal open={navAbierta} onClose={() => setNavAbierta(false)} title={registro ? `${seccion?.texto ?? 'Registro'} · ${registro.etiqueta}` : `Ítems · ${modulo.nombre}`}>
        <ul className="space-y-1">
          {registro
            ? hijosSeccion.map((it, i) => {
                const clave = claveRespuesta(it.id, registro.instanciaId)
                const respondido = !!actual.respuestas[clave]
                const activo = i === idxRegistro
                return (
                  <li key={clave}>
                    <button
                      type="button"
                      onClick={() => {
                        setIdxRegistro(i)
                        setNavAbierta(false)
                      }}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-full px-3 py-2 text-left text-sm transition-colors',
                        activo ? 'bg-primary text-white' : 'text-slate-700 hover:bg-slate-50'
                      )}
                    >
                      <span className={cn('grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold', activo ? 'bg-white/20' : respondido ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500')}>
                        {respondido ? <Check className="h-3.5 w-3.5" /> : i + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{it.texto}</span>
                    </button>
                  </li>
                )
              })
            : pasosRaices.map((it, i) => {
                const clave = it.tipo === 'CONTENEDOR' ? null : claveRespuesta(it.id)
                const respondido = clave ? !!actual.respuestas[clave] : false
                const activo = i === idxItem
                const totalHijos = it.tipo === 'CONTENEDOR' ? hijosOrdenados(itemsModulo, it.id).length : 0
                return (
                  <li key={it.id}>
                    <button
                      type="button"
                      onClick={() => {
                        guardarPaso(idxModulo, i)
                        setIdxItem(i)
                        setNavAbierta(false)
                      }}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-full px-3 py-2 text-left text-sm transition-colors',
                        activo ? 'bg-primary text-white' : 'text-slate-700 hover:bg-slate-50'
                      )}
                    >
                      <span
                        className={cn(
                          'grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold',
                          activo ? 'bg-white/20' : it.tipo === 'CONTENEDOR' ? 'bg-primary-50 text-primary' : respondido ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'
                        )}
                      >
                        {it.tipo === 'CONTENEDOR' ? <FolderOpen className="h-3.5 w-3.5" /> : respondido ? <Check className="h-3.5 w-3.5" /> : i + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        {it.tipo === 'CONTENEDOR' ? (
                          <span className={cn('mb-0.5 flex items-center gap-1 text-[10px] font-semibold', activo ? 'text-white/70' : 'text-primary-600')}>
                            Sección · {totalHijos} ítems por registro
                          </span>
                        ) : null}
                        <span className="block truncate">{it.texto}</span>
                      </span>
                      {activo ? <span className="shrink-0 text-xs font-semibold">Actual</span> : null}
                    </button>
                  </li>
                )
              })}
        </ul>
        <p className="mt-3 text-center text-xs text-slate-400">Toca un elemento para ir directo a él.</p>
      </Modal>

      <Modal open={modulosAbierta} onClose={() => setModulosAbierta(false)} title="Módulos de la evaluación">
        <ul className="space-y-1">
          {modulos.map((m, i) => {
            const total = pasosDe(m).length
            const hecho = resumir(m)
            const pct = total ? Math.round((hecho / total) * 100) : 0
            const activo = i === idxModulo
            const completo = total > 0 && hecho === total
            return (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => {
                    guardarPaso(i, 0)
                    setIdxModulo(i)
                    setIdxItem(0)
                    if (registro) setRegistro(null)
                    setModulosAbierta(false)
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-full px-3 py-2 text-left text-sm transition-colors',
                    activo ? 'bg-primary text-white' : 'text-slate-700 hover:bg-slate-50'
                  )}
                >
                  <span
                    className={cn(
                      'grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold',
                      activo ? 'bg-white/20' : completo ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'
                    )}
                  >
                    {!activo && completo ? <Check className="h-3.5 w-3.5" /> : i + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{m.nombre}</span>
                    <span className={cn('block text-[11px]', activo ? 'text-white/70' : 'text-slate-400')}>
                      {hecho}/{total} ítems · {pct}%
                    </span>
                  </span>
                  {activo ? <span className="shrink-0 text-xs font-semibold">Actual</span> : null}
                </button>
              </li>
            )
          })}
        </ul>
        <p className="mt-3 text-center text-xs text-slate-400">Toca un módulo para ir directo a él.</p>
      </Modal>

      <Modal open={!!confirmarBorrar} onClose={() => setConfirmarBorrar(null)} title="Eliminar registro">
        <p className="text-sm text-slate-600">
          Se eliminará este registro y todas sus respuestas. Esta acción no se puede deshacer.
        </p>
        <div className="mt-4 flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={() => setConfirmarBorrar(null)}>Cancelar</Button>
          <Button variant="danger" className="flex-1" onClick={() => confirmarBorrar && eliminarInstancia(confirmarBorrar)}>
            Eliminar
          </Button>
        </div>
      </Modal>
    </MobileLayout>
  )
}