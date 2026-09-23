import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, FileDown } from 'lucide-react'
import { obtenerEvaluacion, resumirEvaluacion, type DetalleEvaluacion } from '../lib/data/indicadores'
import { descargarPdf } from '../lib/pdf'
import { etiquetaTipo, valorBinario, conciliacionTotal, conciliacionPorcentaje, type ValorConciliacion, type ValorCumple, type ValorChecklist } from '../lib/scoring'
import type { Item, Opcion } from '../lib/types'
import { Badge, Button, Puntaje, Spinner, cn } from '../components/ui'
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
      const labels = sel.map((id) => opciones.find((o) => o.id === id)?.etiqueta ?? id)
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
          {ps.map((p, i) => (
            <p key={i} className="text-sm text-slate-700">
              <span className="font-medium">{p.sku}</span>
              {p.nombre ? ` — ${p.nombre}` : ''} · Teórica: {p.teorica ?? '—'} · Física: {p.fisica ?? '—'} ({conciliacionPorcentaje(p) ?? '—'}%)
            </p>
          ))}
          {total != null ? <p className="text-sm font-bold text-primary-900">Total: {total}%</p> : null}
        </div>
      )
    }
    case 'FOTO':
      return <p className="text-sm text-slate-400">{extraerPaths(valor).length > 0 ? 'Ver evidencia fotográfica' : 'Sin evidencia'}</p>
    case 'COMENTARIO':
    case 'DESCRIPCION': {
      const t = typeof valor === 'string' ? valor.trim() : ''
      return t ? <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">{t}</p> : <p className="text-sm text-slate-400">Sin respuesta</p>
    }
    case 'CANTIDAD':
      return typeof valor === 'number' ? <p className="text-sm font-bold text-primary-900">{valor}</p> : <p className="text-sm text-slate-400">Sin respuesta</p>
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

  if (estado === 'cargando') {
    return (
      <div className="grid min-h-[60vh] place-items-center">
        <Spinner className="h-8 w-8" />
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

  const { evaluacion, respuestas, items, modulos, fotos } = detalle
  const { puntaje } = resumirEvaluacion(evaluacion, respuestas, items)
  const est = estadoBadge(puntaje)

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
      <header className="sticky top-0 z-30 bg-primary text-white shadow-md">
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
            {descargando ? <Spinner className="h-4 w-4" /> : <FileDown className="h-4 w-4" />}
            {descargando ? 'Generando…' : 'PDF'}
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-2xl space-y-4 px-4 py-4">
        {error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        ) : null}

        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
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
          {evaluacion.comentario_general ? (
            <div className="mt-3 rounded-xl bg-amber-50 px-3 py-2">
              <p className="text-xs font-bold text-amber-700">Comentario general</p>
              <p className="text-sm text-amber-900">{evaluacion.comentario_general}</p>
            </div>
          ) : null}
        </section>

        {modulos.map((m) => {
          const itemMod = items.filter((i) => i.modulo_id === m.id)
          const vals = respuestas
            .filter((r) => itemMod.some((i) => i.id === r.item_id))
            .map((r) => ({ item: itemMod.find((i) => i.id === r.item_id), valor: r.valor }))
            .filter((x): x is { item: Item; valor: unknown } => !!x.item)
          const bin = vals.map((v) => valorBinario(v.item, v.valor)).filter((x): x is boolean => x !== null)
          const punteo = bin.length ? Math.round((bin.filter(Boolean).length / bin.length) * 10000) / 100 : null
          return (
            <section key={m.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-4 py-3">
                <p className="font-bold text-primary-900">{m.nombre}</p>
                <p className="text-xs font-semibold text-slate-500">
                  {punteo != null ? `${punteo}%${bin.length ? ` (${bin.filter(Boolean).length}/${bin.length})` : ''}` : 'Sin puntuable'}
                </p>
              </div>
              <div className="divide-y divide-slate-100">
                {vals.map(({ item, valor }) => {
                  const fotosItem = fotos.filter((f) => f.item_id === item.id)
                  return (
                    <div key={item.id} className="space-y-2 px-4 py-3">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-semibold text-slate-700">{item.texto}</p>
                        <Badge color={0}>{etiquetaTipo(item.tipo)}</Badge>
                      </div>
                      <ValorRespuesta item={item} valor={valor} />
                      <Fotogaleria fotos={fotosItem} />
                    </div>
                  )
                })}
              </div>
            </section>
          )
        })}
      </main>
    </div>
  )
}