import { useCallback, useEffect, useState, Fragment } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, FileDown, FolderOpen, Tag } from 'lucide-react'
import { obtenerEvaluacion, resumirEvaluacion, type DetalleEvaluacion } from '../lib/data/indicadores'
import { descargarPdf } from '../lib/pdf'
import { supabase } from '../lib/supabase'
import { itemsEnOrdenJerarquico, hijosOrdenados } from '../lib/hierarchy'
import { raicesDeModulo } from '../lib/pasos'
import { etiquetaTipo, itemsProporcion, conciliacionTotal, conciliacionPorcentaje, colaboradorCumple, unidadCumple, incumplimientosPorResponsable, valorPorResponsable, formatearLastSync, formatearPrecioBase, type ValorConciliacion, type ValorCumple, type ValorChecklist, type ValorListaColaboradores, type ValorUnidadChecklist } from '../lib/scoring'
import { etiquetaDeCampo, formatearValorConsulta } from '../lib/data/apis'
import type { Item, Opcion, SucursalOpcion } from '../lib/types'
import { Badge, Button, Card, Puntaje, Skeleton, SkeletonTarjetas, Spinner, cn } from '../components/ui'
import { Fotogaleria } from '../components/dashboard/Fotogaleria'

function extraerPaths(v: unknown): string[] {
  const p = (v as { paths?: unknown } | null)?.paths
  const ids = (v as { photoIds?: unknown } | null)?.photoIds
  const arr = Array.isArray(p) ? p : Array.isArray(ids) ? ids : []
  return arr.filter((x): x is string => typeof x === 'string')
}

function estadoBadge(puntaje: number | null): { texto: string; color: number } {
  if (puntaje == null) return { texto: 'Sin puntaje', color: 4 }
  if (puntaje >= 80) return { texto: 'Cumple', color: 2 }
  if (puntaje >= 60) return { texto: 'En riesgo', color: 3 }
  return { texto: 'No cumple', color: 4 }
}

function fmt(n: number): string {
  return Number.isInteger(n) ? `${n}` : `${Math.round(n * 100) / 100}`
}

function opcionesQueAplican(sucursalId: string, sucursalOpciones: SucursalOpcion[]): Map<string, string[]> {
  const mapa = new Map<string, string[]>()
  for (const o of sucursalOpciones.filter((x) => x.sucursal_id === sucursalId && x.activa)) {
    const arr = mapa.get(o.item_id) ?? []
    arr.push(o.opcion_id)
    mapa.set(o.item_id, arr)
  }
  return mapa
}

function ValorRespuesta({ item, valor }: { item: Item; valor: unknown }) {
  switch (item.tipo) {
    case 'CUMPLE_NO_CUMPLE': {
      const v = valor as ValorCumple | null
      if (v?.value == null) return <p className="text-sm text-slate-400">Sin responder</p>
      const comentarios = (v.evidencias ?? []).map((e) => e.comentario?.trim()).filter(Boolean) as string[]
      return (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {v.informativo ? (
              <span className="inline-flex rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-bold text-amber-800">Informativo · no descuenta</span>
            ) : null}
            <span className={cn('inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold', v.value ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700')}>
              {v.value ? 'Cumple' : 'No cumple'}
            </span>
          </div>
          {comentarios.length ? (
            <div className="space-y-1">
              {comentarios.map((c, i) => (
                <p key={i} className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">“{c}”</p>
              ))}
            </div>
          ) : null}
        </div>
      )
    }
    case 'CHECKLIST': {
      const v = valor as ValorChecklist | null
      const sel = v?.selected ?? []
      const informativos = v?.informativos ?? []
      if (!sel.length && !informativos.length) return <p className="text-sm text-slate-400">Ninguna opción marcada</p>
      const opciones = (item.opciones ?? []) as Opcion[]
      const labels = sel.map((id) => {
        const o = opciones.find((x) => x.id === id)
        if (o?.tipo_respuesta === 'RANGO') {
          return `${o.etiqueta}: ${v?.valores?.[id] ?? '—'}${o.unidad ? ` ${o.unidad}` : ''} (mín. ${o.minimo ?? '—'})`
        }
        return o?.etiqueta ?? id
      })
      const labelsInfo = informativos.map((id) => opciones.find((o) => o.id === id)?.etiqueta ?? id)
      return (
        <div className="space-y-2">
          {sel.length ? (
            <div className="flex flex-wrap gap-1.5">
              {labels.map((l) => (
                <span key={l} className="rounded-full bg-primary-50 px-2.5 py-0.5 text-xs font-semibold text-primary-700">{l}</span>
              ))}
            </div>
          ) : null}
          {informativos.length ? (
            <div className="space-y-1">
              <p className="text-[11px] font-bold text-amber-700">Informativo · no descuenta puntos</p>
              <div className="flex flex-wrap gap-1.5">
                {labelsInfo.map((l) => (
                  <span key={l} className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">{l}</span>
                ))}
              </div>
            </div>
          ) : null}
          {Object.entries(v?.evidencias ?? {}).filter(([, e]) => extraerPaths(e).length > 0).length ? (
            <p className="text-xs font-medium text-slate-500">Con evidencia fotográfica en {Object.values(v?.evidencias ?? {}).filter((e) => extraerPaths(e).length > 0).length} opción(es).</p>
          ) : null}
        </div>
      )
    }
    case 'LISTA_COLABORADORES': {
      const v = valor as ValorListaColaboradores | null
      const cols = v?.colaboradores ?? []
      if (!cols.length) return <p className="text-sm text-slate-400">Sin colaboradores</p>
      const opts = (item.opciones ?? []) as Opcion[]
      const aplican = cols.filter((c) => c.aplica)
      const cumplen = aplican.filter((c) => colaboradorCumple(c, opts)).length
      return (
        <div className="space-y-2">
          {v?.informativo ? (
            <p className="text-xs font-bold text-amber-700">Informativo · no descuenta puntos</p>
          ) : null}
          <p className="text-sm font-semibold text-slate-700">{aplican.length} colaboradores en cuenta · {cumplen}/{aplican.length} completos</p>
          <ul className="space-y-1">
            {cols.map((c) => {
              const cumple = colaboradorCumple(c, opts)
              const marcadas = (c.selected ?? []).map((id) => opts.find((o) => o.id === id)?.etiqueta ?? id)
              return (
                <li key={c.dni} className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate font-medium text-slate-800">
                      {c.name} {c.lastname}
                      <span className="ml-1.5 text-xs font-normal text-slate-500">C.I. {c.nationality ?? ''}{c.dni} · {c.role_name || 'Sin rol'}</span>
                    </span>
                    <span className="shrink-0">
                      <EstadoColaborador aplica={c.aplica} cumple={cumple} />
                    </span>
                  </div>
                  {c.aplica && marcadas.length ? (
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {marcadas.map((l) => (
                        <span key={l} className="rounded-full bg-primary-50 px-2 py-0.5 text-[11px] font-semibold text-primary-700">{l}</span>
                      ))}
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        </div>
      )
    }
    case 'UNIDAD_CHECKLIST': {
      const v = valor as ValorUnidadChecklist | null
      const unids = v?.unidades ?? []
      if (!unids.length) return <p className="text-sm text-slate-400">Sin unidades</p>
      const opts = (item.opciones ?? []) as Opcion[]
      const cumplen = unids.filter((u) => unidadCumple(u, opts)).length
      return (
        <div className="space-y-2">
          {v?.informativo ? (
            <p className="text-xs font-bold text-amber-700">Informativo · no descuenta puntos</p>
          ) : null}
          <p className="text-sm font-semibold text-slate-700">{unids.length} unidades en cuenta · {cumplen}/{unids.length} completas</p>
          <ul className="space-y-1">
            {unids.map((u, i) => {
              const cumple = unidadCumple(u, opts)
              const marcadas = (u.selected ?? []).map((id) => opts.find((o) => o.id === id)?.etiqueta ?? id)
              return (
                <li key={`${u.codigo}-${i}`} className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate font-medium text-slate-800">{u.codigo}</span>
                    <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold', cumple ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500')}>
                      {cumple ? 'Cumple' : 'Incompleto'}
                    </span>
                  </div>
                  {marcadas.length ? (
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {marcadas.map((l) => (
                        <span key={l} className="rounded-full bg-primary-50 px-2 py-0.5 text-[11px] font-semibold text-primary-700">{l}</span>
                      ))}
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        </div>
      )
    }
    case 'CONCILIACION': {
      const v = valor as ValorConciliacion | null
      const ps = v?.productos ?? []
      if (!ps.length) return <p className="text-sm text-slate-400">Sin productos</p>
      const total = conciliacionTotal(v)
      return (
        <div className="space-y-1">
          {v?.informativo ? (
            <p className="text-xs font-bold text-amber-700">Informativo · no descuenta puntos</p>
          ) : null}
          {ps.map((p, i) => {
            const infoSistema = p.soh != null || p.lastSync || p.finalBase != null
            return (
              <div key={i} className="text-sm text-slate-700">
                <p>
                  <span className="font-medium">{p.sku}</span>
                  {p.nombre ? ` — ${p.nombre}` : ''} · Teórica: {p.teorica ?? '—'} · Física: {p.fisica ?? '—'} ({conciliacionPorcentaje(p) ?? '—'}%)
                </p>
                {infoSistema ? (
                  <p className="text-[11px] text-slate-400">
                    SOH: {p.soh ?? '—'} · Últ. sync: {formatearLastSync(p.lastSync)} · Precio: {formatearPrecioBase(p.finalBase)}
                  </p>
                ) : null}
              </div>
            )
          })}
          {total != null ? <p className="text-sm font-bold text-primary-900">Total: {total}%</p> : null}
        </div>
      )
    }
    default:
      return <p className="text-sm text-slate-400">Sin respuesta</p>
  }
}

export function EvaluacionDetalle() {
  const { evaluacionId = '' } = useParams()
  const navigate = useNavigate()
  const [detalle, setDetalle] = useState<DetalleEvaluacion | null>(null)
  const [estado, setEstado] = useState<'cargando' | 'error' | 'ok'>('cargando')
  const [descargando, setDescargando] = useState(false)
  const [error, setError] = useState('')

  const recargar = useCallback(async () => {
    const d = await obtenerEvaluacion(evaluacionId)
    if (d) setDetalle(d)
  }, [evaluacionId])

  useEffect(() => {
    void (async () => {
      const d = await obtenerEvaluacion(evaluacionId)
      if (d) {
        setDetalle(d)
        setEstado('ok')
      } else {
        setEstado('error')
      }
    })()
  }, [evaluacionId])

  const estadoEval = detalle?.evaluacion.estado

  useEffect(() => {
    if (estadoEval !== 'ACTIVA') return
    const channel = supabase
      .channel(`ev-vivo-${evaluacionId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'respuestas', filter: `evaluacion_id=eq.${evaluacionId}` },
        () => void recargar()
      )
      .subscribe()
    const iv = window.setInterval(() => void recargar(), 15000)
    return () => {
      void supabase.removeChannel(channel)
      window.clearInterval(iv)
    }
  }, [evaluacionId, estadoEval, recargar])

  if (estado === 'cargando') {
    return (
      <div className="space-y-4">
        <div className="space-y-2">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-4 w-80" />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <div className="space-y-4 py-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-16 w-full" />
            </div>
          </Card>
          <Card>
            <div className="space-y-4 py-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-24 w-full" />
            </div>
          </Card>
        </div>
        <SkeletonTarjetas n={2} cols="sm:grid-cols-2" />
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

  const { evaluacion, respuestas, items, modulos, fotos, sucursalOpciones, instancias } = detalle
  const { puntaje } = resumirEvaluacion(evaluacion, respuestas, items, sucursalOpciones)
  const est = estadoBadge(puntaje)
  const aplicaOpciones = opcionesQueAplican(evaluacion.sucursal_id, sucursalOpciones)
  const aplicarOpciones = (item: Item) => {
    if (item.tipo !== 'CHECKLIST' || !item.opciones?.length) return item
    const ids = aplicaOpciones.get(item.id)
    if (!ids?.length) return item
    return { ...item, opciones: item.opciones.filter((o) => ids.includes(o.id)) }
  }

  const incumplimientos = new Map<string, number>()
  for (const r of respuestas) {
    const it = items.find((i) => i.id === r.item_id)
    if (!it) continue
    for (const a of incumplimientosPorResponsable(aplicarOpciones(it), r.valor)) {
      incumplimientos.set(a.responsable, (incumplimientos.get(a.responsable) ?? 0) + a.puntos)
    }
  }
  // Puntaje por responsable: cada ítem reparte su peso entre quienes participan en él
  // (peso ÷ nº de responsables); el % de cada responsable = logrado / posible.
  const valoresResp = valorPorResponsable(items.map(aplicarOpciones), respuestas)

  const descargar = async () => {
    setError('')
    setDescargando(true)
    try {
      await descargarPdf(evaluacion.id)
    } catch {
      setError('No se pudo generar el PDF.')
    }
    setDescargando(false)
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-10">
      <header className="sticky top-0 z-30 bg-primary text-white">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <button onClick={() => navigate(-1)} className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/10 hover:bg-white/20" title="Volver">
              <ArrowLeft className="h-4 w-4" />
            </button>
            <h1 className="truncate text-base font-extrabold">Detalle de evaluación</h1>
          </div>
          <Button
            variant="secondary"
            className="min-h-0 gap-1.5 bg-white/10 px-3 py-1.5 text-white hover:bg-white/20"
            disabled={descargando}
            onClick={() => void descargar()}
          >
            {descargando ? <Spinner size={16} /> : <FileDown className="h-4 w-4" />}
            {descargando ? 'Generando…' : 'PDF'}
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-4 px-4 py-4">
        {error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        ) : null}

        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-lg font-extrabold text-primary-900">{evaluacion.sucursal?.nombre ?? 'Sucursal'}</p>
              <p className="text-sm text-slate-500">
                {[evaluacion.sucursal?.shop_id ? `Nº tienda ${evaluacion.sucursal.shop_id}` : '', evaluacion.sucursal?.direccion ?? ''].filter(Boolean).join(' · ') || 'Sin datos de tienda'}
              </p>
              <p className="mt-1 text-xs text-slate-400">
                {new Date(`${evaluacion.fecha}T12:00:00`).toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · {evaluacion.aperturador?.nombre ?? '—'}
              </p>
            </div>
            <div className="text-right">
              <Puntaje value={puntaje} />
              <div className="mt-1">
                <Badge color={est.color}>{est.texto}</Badge>
              </div>
            </div>
          </div>
          {evaluacion.estado === 'ACTIVA' ? (
            <p className="mt-2 inline-flex items-center gap-2 rounded-full bg-green-50 px-3 py-1 text-[11px] font-bold text-green-700">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-green-600" />
              </span>
              EN VIVO · {respuestas.length} respuesta(s) registradas hasta ahora
            </p>
          ) : null}
          {evaluacion.comentario_general ? (
            <div className="mt-3 rounded-xl bg-amber-50 px-3 py-2">
              <p className="text-xs font-bold text-amber-700">Comentario general</p>
              <p className="text-sm text-amber-900">{evaluacion.comentario_general}</p>
            </div>
          ) : null}
        </section>

        {valoresResp.length ? (
          <section className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="font-bold text-primary-900">Puntaje por responsable</p>
            <p className="mb-3 text-xs text-slate-400">Cada ítem reparte su valor entre quienes participan en él (peso ÷ nº de responsables del ítem). El % de cada responsable = logrado ÷ posible.</p>
            <div className="space-y-1.5">
              {valoresResp.map((v) => {
                const fallas = incumplimientos.get(v.responsable) ?? 0
                const nivel = v.porciento == null
                  ? 'bg-slate-100 text-slate-500'
                  : v.porciento >= 80
                    ? 'bg-green-50 text-green-700'
                    : v.porciento >= 50
                      ? 'bg-amber-50 text-amber-700'
                      : 'bg-red-50 text-red-600'
                return (
                  <div key={v.responsable} className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2 last:border-0 last:pb-0">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-700">{v.responsable}</p>
                      <p className="text-xs text-slate-400">
                        <strong className="tabular-nums text-slate-600">{fmt(v.logrado)}</strong> / {fmt(v.posible)} pts
                        {fallas ? ` · ${fallas} falla${fallas !== 1 ? 's' : ''}` : ''}
                      </p>
                    </div>
                    <span className={cn('shrink-0 rounded-full px-2.5 py-0.5 text-sm font-bold tabular-nums', nivel)}>
                      {v.porciento == null ? '—' : `${v.porciento}%`}
                    </span>
                  </div>
                )
              })}
            </div>
          </section>
        ) : null}

        {modulos.map((m) => {
          const itemMod = itemsEnOrdenJerarquico(items.filter((i) => i.modulo_id === m.id))
          const respDe = (id: string, insId?: string | null) =>
            respuestas.find((r) => r.item_id === id && (r.instancia_id ?? null) === (insId ?? null))
          const raices = raicesDeModulo(itemMod)
          const instanciasDe = (itemId: string) =>
            instancias.filter((x) => x.item_id === itemId).sort((a, b) => a.orden - b.orden)
          const filaRespuesta = (item: Item, res: (typeof respuestas)[number]) => {
            const fotosItem = fotos.filter(
              (f) => f.item_id === item.id && (f.instancia_id ?? null) === (res.instancia_id ?? null)
            )
            return (
              <div key={`${res.item_id}-${res.instancia_id ?? ''}-${res.id}`} className="space-y-2 px-4 py-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-700">{item.texto}</p>
                  <Badge color={0}>{etiquetaTipo(item.tipo)}</Badge>
                </div>
                <ValorRespuesta item={item} valor={res.valor} />
                <Fotogaleria fotos={fotosItem} />
              </div>
            )
          }
          const vals = respuestas
            .filter((r) => itemMod.some((i) => i.id === r.item_id))
            .map((r) => ({ item: itemMod.find((i) => i.id === r.item_id), valor: r.valor }))
            .filter((x): x is { item: Item; valor: unknown } => !!x.item)
          const { ok, total } = itemsProporcion(vals.map((v) => ({ item: aplicarOpciones(v.item), valor: v.valor })))
          const punteo = total ? Math.round((ok / total) * 10000) / 100 : null
          return (
            <section key={m.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-3">
                <p className="font-bold text-primary-900">{m.nombre}</p>
                <p className="text-xs font-semibold text-slate-500">
                  {punteo != null ? `${punteo}%${total ? ` (${fmt(ok)}/${total})` : ''}` : 'Sin puntuable'}
                </p>
              </div>
              <div className="divide-y divide-slate-100">
                {raices.map((item) => {
                  if (item.tipo === 'CONTENEDOR') {
                    const insts = instanciasDe(item.id)
                    const hijos = hijosOrdenados(itemMod, item.id)
                    return (
                      <Fragment key={item.id}>
                        <div className="flex items-center gap-2 bg-primary-50 px-4 py-2.5">
                          <FolderOpen className="h-4 w-4 shrink-0 text-primary" />
                          <p className="text-sm font-bold text-primary-900">{item.texto}</p>
                          <span className="ml-auto text-[11px] font-semibold text-slate-500">
                            {insts.length} registro(s) · {hijos.length} ítem(s) c/u
                          </span>
                        </div>
                        {insts.map((inst, i) => (
                          <Fragment key={inst.id}>
                            <div className="flex items-center gap-2 border-t border-primary-100 bg-primary-50/60 px-4 py-1.5">
                              <Tag className="h-3.5 w-3.5 shrink-0 text-primary" />
                              <p className="truncate text-xs font-bold text-primary-900">
                                Registro {i + 1} · {inst.etiqueta}
                              </p>
                            </div>
                            {item.api_id && inst.datos && Object.keys(inst.datos).length ? (
                              <div className="flex flex-wrap gap-1.5 bg-primary-50/40 px-4 pb-2">
                                {Object.entries(inst.datos)
                                  .filter(([, v]) => v != null && v !== '')
                                  .map(([k, v]) => (
                                    <span key={k} className="rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-semibold text-primary-800">
                                      {etiquetaDeCampo(item.api_id, k)}: {formatearValorConsulta(v)}
                                    </span>
                                  ))}
                              </div>
                            ) : null}
                            {hijos.map((hijo) => {
                              const res = respDe(hijo.id, inst.id)
                              if (!res) return null
                              return filaRespuesta(hijo, res)
                            })}
                          </Fragment>
                        ))}
                      </Fragment>
                    )
                  }
                  const res = respDe(item.id, null)
                  if (!res) return null
                  return filaRespuesta(item, res)
                })}
              </div>
            </section>
          )
        })}
      </main>
    </div>
  )
}

function EstadoColaborador({ aplica, cumple }: { aplica: boolean; cumple: boolean }) {
  if (!aplica) return <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-bold text-slate-500">No aplica</span>
  return <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-bold', cumple ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700')}>{cumple ? 'Cumple' : 'Incompleto'}</span>
}