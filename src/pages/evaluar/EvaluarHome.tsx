import { Link } from 'react-router-dom'
import { CalendarClock, ChevronRight, Trash2 } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useCatalog } from '../../context/CatalogContext'
import { useOffline } from '../../context/OfflineContext'
import { deleteDraft, getDraft } from '../../lib/offline/db'
import { listarEvaluacionesActivas } from '../../lib/data/indicadores'
import { Confirmar, EmptyState, cn } from '../../components/ui'
import { MobileLayout } from '../../components/layouts/MobileLayout'
import { useEffect, useState } from 'react'

export function EvaluarHome() {
  const { profile } = useAuth()
  const { sucursales, departamentos } = useCatalog()
  const { pendientes } = useOffline()
  const [conDraft, setConDraft] = useState<Record<string, boolean>>({})
  // Fecha de la evaluación activa por UNIDAD (id de sucursal o de departamento:
  // son de tablas distintas, así que conviven en el mismo mapa sin chocar).
  const [activas, setActivas] = useState<Record<string, string>>({})
  const [confirmarBorrador, setConfirmarBorrador] = useState<{ id: string; nombre: string } | null>(null)
  const [borrando, setBorrando] = useState(false)

  useEffect(() => {
    void (async () => {
      const map: Record<string, boolean> = {}
      for (const s of sucursales) {
        const d = await getDraft(s.id)
        if (d && d.evaluador_id === profile?.id) map[s.id] = true
      }
      for (const dep of departamentos) {
        const d = await getDraft(dep.id)
        if (d && d.evaluador_id === profile?.id) map[dep.id] = true
      }
      setConDraft(map)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sucursales.length, departamentos.length, pendientes, profile?.id])

  useEffect(() => {
    void (async () => {
      const evals = await listarEvaluacionesActivas().catch(() => [])
      const map: Record<string, string> = {}
      for (const e of evals) {
        const unidad = e.departamento_id ?? e.sucursal_id
        if (unidad && !map[unidad]) map[unidad] = e.fecha
      }
      setActivas(map)
    })()
  }, [pendientes])

  const fechaBonita = (fecha: string) =>
    new Date(`${fecha}T12:00:00`).toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' })
  const sucursalesAbiertas = sucursales.filter((sucursal) => !!activas[sucursal.id])
  const departamentosAbiertos = departamentos.filter((departamento) => !!activas[departamento.id])

  const borrarBorrador = async () => {
    if (!confirmarBorrador || borrando) return
    setBorrando(true)
    try {
      await deleteDraft(confirmarBorrador.id)
      setConDraft((actual) => ({ ...actual, [confirmarBorrador.id]: false }))
      setConfirmarBorrador(null)
    } finally {
      setBorrando(false)
    }
  }

  return (
    <MobileLayout titulo="Evaluar" subtitulo="Selecciona la unidad">
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-bold text-primary-900">Hola, {profile?.nombre?.split(' ')[0] || 'evaluador'}</h2>
          <p className="text-sm text-slate-500">Selecciona la sucursal o el departamento con evaluación abierta por el Líder.</p>
        </div>

        {Object.keys(activas).length === 0 && sucursales.length === 0 && departamentos.length === 0 ? (
          <EmptyState
            title="No hay sucursales activas"
            subtitle="El Líder debe crear sucursales para poder evaluar."
          />
        ) : Object.keys(activas).length === 0 ? (
          <EmptyState
            title="No hay evaluaciones abiertas"
            subtitle="El Líder debe abrir una evaluación para que la unidad aparezca aquí."
          />
        ) : !sucursalesAbiertas.length && !departamentosAbiertos.length ? (
          <EmptyState
            title="No hay evaluaciones abiertas"
            subtitle="El Líder debe abrir una evaluación para que la unidad aparezca aquí."
          />
        ) : (
          <div className="space-y-3">
            {sucursalesAbiertas.map((s) => {
              const activa = activas[s.id]
              const draft = conDraft[s.id]
              return (
                <div
                  key={s.id}
                  className={cn(
                    'rounded-2xl border-2 bg-white p-4 shadow-sm',
                    draft ? 'border-amber-400' : activa ? 'border-slate-200' : 'border-slate-200 opacity-70'
                  )}
                >
                  <Link to={`/evaluar/${s.id}`} className="block rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-300">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-bold text-primary-900">{s.nombre}</p>
                        <p className="text-xs text-slate-500">
                          {s.shop_id ? `Tienda Nº ${s.shop_id}` : 'Sin nº de tienda'}
                        </p>
                        <p className={cn('mt-1 inline-flex items-center gap-1 text-[11px] font-bold', activa ? 'text-green-600' : 'text-slate-400')}>
                          <CalendarClock className="h-3.5 w-3.5" />
                          {activa ? `Evaluación abierta · ${fechaBonita(activa)}` : 'Sin evaluación abierta'}
                        </p>
                      </div>
                      {activa ? (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary px-3 py-1 text-xs font-bold text-white">
                          {draft ? <>Continuar <ChevronRight className="h-3.5 w-3.5" /></> : 'Evaluar'}
                        </span>
                      ) : null}
                    </div>
                  </Link>
                  {draft ? (
                    <div className="mt-2 flex items-center justify-between gap-2 border-t border-amber-100 pt-2">
                      <p className="text-[11px] font-medium text-amber-700">Borrador guardado en este dispositivo.</p>
                      <button
                        type="button"
                        onClick={() => setConfirmarBorrador({ id: s.id, nombre: s.nombre })}
                        className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg px-2 text-xs font-bold text-red-700 hover:bg-red-50"
                        title={`Borrar el borrador local de ${s.nombre}`}
                      >
                        <Trash2 className="h-4 w-4" />
                        Borrar borrador
                      </button>
                    </div>
                  ) : null}
                </div>
              )
            })}
            {departamentosAbiertos.map((d) => {
              const activa = activas[d.id]
              const draft = conDraft[d.id]
              return (
                <div
                  key={d.id}
                  className={cn(
                    'rounded-2xl border-2 bg-white p-4 shadow-sm',
                    draft ? 'border-amber-400' : activa ? 'border-slate-200' : 'border-slate-200 opacity-70'
                  )}
                >
                  <Link to={`/evaluar/departamento/${d.id}`} className="block rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-300">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-bold text-primary-900">
                          {d.nombre}
                          {/* La etiqueta es la que distingue la tarjeta de una
                              sucursal: ambas comparten la misma lista. */}
                          <span className="ml-2 inline-flex items-center rounded-full bg-primary-100 px-2 py-0.5 align-middle text-[10px] font-bold uppercase tracking-wide text-primary-700">
                            Departamento
                          </span>
                        </p>
                        <p className="text-xs text-slate-500">Departamento centralizado</p>
                        <p className={cn('mt-1 inline-flex items-center gap-1 text-[11px] font-bold', activa ? 'text-green-600' : 'text-slate-400')}>
                          <CalendarClock className="h-3.5 w-3.5" />
                          {activa ? `Evaluación abierta · ${fechaBonita(activa)}` : 'Sin evaluación abierta'}
                        </p>
                      </div>
                      {activa ? (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary px-3 py-1 text-xs font-bold text-white">
                          {draft ? <>Continuar <ChevronRight className="h-3.5 w-3.5" /></> : 'Evaluar'}
                        </span>
                      ) : null}
                    </div>
                  </Link>
                  {draft ? (
                    <div className="mt-2 flex items-center justify-between gap-2 border-t border-amber-100 pt-2">
                      <p className="text-[11px] font-medium text-amber-700">Borrador guardado en este dispositivo.</p>
                      <button
                        type="button"
                        onClick={() => setConfirmarBorrador({ id: d.id, nombre: d.nombre })}
                        className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg px-2 text-xs font-bold text-red-700 hover:bg-red-50"
                        title={`Borrar el borrador local de ${d.nombre}`}
                      >
                        <Trash2 className="h-4 w-4" />
                        Borrar borrador
                      </button>
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}
      </div>
      <Confirmar
        open={!!confirmarBorrador}
        texto={confirmarBorrador
          ? `Se borrará el borrador local de ${confirmarBorrador.nombre} en este dispositivo. Las respuestas no sincronizadas se perderán; las que ya están en la nube podrán volver a cargarse al abrir la evaluación.`
          : ''}
        textoConfirmar={borrando ? 'Borrando…' : 'Borrar borrador'}
        onConfirm={() => void borrarBorrador()}
        onCancel={() => setConfirmarBorrador(null)}
      />
    </MobileLayout>
  )
}