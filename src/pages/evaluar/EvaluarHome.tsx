import { Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useCatalog } from '../../context/CatalogContext'
import { useOffline } from '../../context/OfflineContext'
import { getDraft } from '../../lib/offline/db'
import { EmptyState, cn } from '../../components/ui'
import { useEffect, useState } from 'react'

export function EvaluarHome() {
  const { profile } = useAuth()
  const { sucursales, asignaciones } = useCatalog()
  const { pendientes } = useOffline()
  const [conDraft, setConDraft] = useState<Record<string, boolean>>({})

  const asignadas = asignaciones
    .filter((a) => a.activa)
    .map((a) => sucursales.find((s) => s.id === a.sucursal_id))
    .filter(Boolean) as { id: string; nombre: string; codigo: string; ciudad: string | null }[]

  useEffect(() => {
    void (async () => {
      const map: Record<string, boolean> = {}
      for (const a of asignaciones) {
        const d = await getDraft(a.sucursal_id)
        if (d) map[a.sucursal_id] = true
      }
      setConDraft(map)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asignaciones.length, pendientes])

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-primary-900">Hola, {profile?.nombre?.split(' ')[0] || 'evaluador'} 👋</h2>
        <p className="text-sm text-slate-500">Selecciona la sucursal que vas a evaluar.</p>
      </div>

      {!asignadas.length ? (
        <EmptyState
          title="No tienes sucursales asignadas"
          subtitle="El Líder debe asignarte sucursales para poder evaluar."
        />
      ) : (
        <div className="space-y-3">
          {asignadas.map((s) => (
            <Link
              key={s.id}
              to={`/evaluar/${s.id}`}
              className={cn(
                'block rounded-2xl border-2 bg-white p-4 shadow-sm transition-colors hover:border-primary',
                conDraft[s.id] ? 'border-amber-400' : 'border-slate-200'
              )}
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-bold text-primary-900">{s.nombre}</p>
                  <p className="text-xs text-slate-500">
                    {s.codigo}
                    {s.ciudad ? ` • ${s.ciudad}` : ''}
                  </p>
                </div>
                <span className="rounded-full bg-primary px-3 py-1 text-xs font-bold text-white">
                  {conDraft[s.id] ? 'Continuar ➤' : 'Evaluar'}
                </span>
              </div>
              {conDraft[s.id] ? (
                <p className="mt-2 text-[11px] font-medium text-amber-600">Tienes un borrador guardado en este dispositivo.</p>
              ) : null}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}