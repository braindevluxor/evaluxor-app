/**
 * Modal de drilldown para los dashboards: al hacer clic en un gráfico muestra
 * las evaluaciones que componen ese elemento (paso 1) y al elegir una, el
 * detalle de sus respuestas (paso 2), con enlace a la evaluación completa.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Camera, ChevronRight, FolderOpen, ExternalLink } from 'lucide-react'
import { Badge, Modal, Puntaje, cn } from '../ui'
import type { DetalleRespuestaEval, FilaDrilldownEval } from '../../lib/data/indicadores'
import { etiquetaTipo } from '../../lib/scoring'
import { num } from '../../lib/numeros'

const ETIQUETA_ESTADO: Record<string, string> = {
  PROGRAMADA: 'Programada',
  ACTIVA: 'Activa',
  CERRADA: 'Cerrada'
}
const COLOR_ESTADO: Record<string, number> = {
  PROGRAMADA: 4,
  ACTIVA: 3,
  CERRADA: 2
}

function fechaCorta(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function ModalDrilldown({
  open,
  onCerrar,
  titulo,
  subtitulo,
  filas,
  renderDetalle,
  urlDe
}: {
  open: boolean
  onCerrar: () => void
  titulo: string
  subtitulo?: string
  filas: FilaDrilldownEval[]
  renderDetalle: (id: string) => ReactNode
  urlDe: (id: string) => string
}) {
  const [sel, setSel] = useState<string | null>(null)
  useEffect(() => {
    if (!open) setSel(null)
  }, [open])

  return (
    <Modal
      open={open}
      onClose={() => {
        setSel(null)
        onCerrar()
      }}
      title={sel != null ? `${titulo} · Detalle de la evaluación` : titulo}
      wide
      footer={
        sel != null ? (
          <div className="flex justify-end">
            <Link
              to={urlDe(sel)}
              onClick={() => {
                setSel(null)
                onCerrar()
              }}
              className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-700"
            >
              <ExternalLink className="h-4 w-4" /> Ver evaluación completa
            </Link>
          </div>
        ) : undefined
      }
    >
      {sel != null ? (
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => setSel(null)}
            className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:border-primary-300 hover:text-primary"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Volver a la lista
          </button>
          {renderDetalle(sel)}
        </div>
      ) : (
        <div className="space-y-2">
          {subtitulo ? <p className="mb-3 text-xs text-slate-400">{subtitulo}</p> : null}
          {filas.length ? (
            filas.map((r) => {
              const puntaje = r.puntajeScope ?? r.puntaje
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setSel(r.id)}
                  className="flex w-full items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left transition-colors hover:border-primary-300 hover:bg-primary-50/40"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-800">{r.sucursal}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-slate-400">
                      <span>{fechaCorta(r.fecha)}</span>
                      <Badge color={COLOR_ESTADO[r.estado] ?? 0}>{ETIQUETA_ESTADO[r.estado] ?? r.estado}</Badge>
                      {r.puntaje != null && r.puntajeScope != null ? (
                        <span className="font-medium text-slate-500">Global {num(r.puntaje)}%</span>
                      ) : null}
                      {r.muestras ? <span>· {r.muestras} {r.muestras === 1 ? 'respuesta' : 'respuestas'}</span> : null}
                      {r.aperturador ? <span>· {r.aperturador}</span> : null}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <Puntaje value={puntaje} className="block" />
                    <span className="mt-0.5 block text-[10px] font-medium text-slate-400">Ver detalle</span>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
                </button>
              )
            })
          ) : (
            <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center text-sm text-slate-400">
              Sin evaluaciones en el rango seleccionado para este elemento.
            </p>
          )}
        </div>
      )}
    </Modal>
  )
}

/** Cabecera de la evaluación elegida (fecha, sucursal, estado, puntajes). */
export function DetalleEvalCabecera({
  fecha,
  sucursal,
  estado,
  puntaje,
  puntajeScope,
  etiquetaScope,
  muestras
}: {
  fecha: string
  sucursal: string
  estado: string
  puntaje: number | null
  puntajeScope?: number | null
  etiquetaScope?: string
  muestras?: number
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-bold text-primary-900">{sucursal}</p>
        <p className="text-xs text-slate-400">
          {new Date(`${fecha}T12:00:00`).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' })}
          {' · '}
          <Badge color={COLOR_ESTADO[estado] ?? 0}>{ETIQUETA_ESTADO[estado] ?? estado}</Badge>
          {muestras != null ? <span className="ml-1">· {muestras} {muestras === 1 ? 'respuesta' : 'respuestas'} puntuables</span> : null}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-3 text-right">
        {puntajeScope != null ? (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{etiquetaScope ?? 'En el alcance'}</p>
            <Puntaje value={puntajeScope} className="text-base" />
          </div>
        ) : null}
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Puntaje global</p>
          <Puntaje value={puntaje} className="text-base" />
        </div>
      </div>
    </div>
  )
}

/** Lista de respuestas de la evaluación (paso 2), con badge de cumplimiento y resumen del valor. */
export function DetalleRespuestasLista({ filas }: { filas: DetalleRespuestaEval[] }) {
  if (!filas.length) {
    return (
      <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-400">
        Sin respuestas que encuadren en este filtro.
      </p>
    )
  }
  return (
    <div className="space-y-2">
      {filas.map((f, i) => (
        <div key={`${f.item_id}-${f.instancia ?? ''}-${i}`} className="rounded-xl border border-slate-200 bg-white p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              {f.instancia ? (
                <p className="mb-0.5 inline-flex items-center gap-1 rounded-full bg-primary-50 px-2 py-0.5 text-[11px] font-bold text-primary-900">
                  <FolderOpen className="h-3 w-3" /> {f.instancia}
                </p>
              ) : null}
              <p className="text-sm font-semibold leading-snug text-slate-800">{f.texto}</p>
              <p className="mt-0.5 text-[11px] text-slate-400">
                {f.modulo ? `${f.modulo} · ` : ''}
                {etiquetaTipo(f.tipo)}
                {f.peso > 0 ? ` · Peso ${f.peso}%` : ''}
                {f.fotos ? ` · ${f.fotos} foto(s)` : ''}
              </p>
            </div>
            {f.cumple != null ? (
              <span
                className={cn(
                  'shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-bold',
                  f.cumple ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                )}
              >
                {f.cumple ? 'Cumple' : f.proporcion != null && f.proporcion < 1 ? 'Parcial' : 'No cumple'}
              </span>
            ) : f.proporcion != null ? (
              <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-bold text-amber-800">
                {Math.round(f.proporcion * 100)}%
              </span>
            ) : null}
          </div>
          {f.resumen ? <p className="mt-1.5 text-xs text-slate-600">{f.resumen}</p> : null}
          {f.fotos ? (
            <p className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-slate-400">
              <Camera className="h-3 w-3" /> Con evidencia fotográfica
            </p>
          ) : null}
        </div>
      ))}
    </div>
  )
}