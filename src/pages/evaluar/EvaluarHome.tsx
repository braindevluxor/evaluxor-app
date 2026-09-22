import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useCatalog } from '../../context/CatalogContext'
import { useOffline } from '../../context/OfflineContext'
import { getDraft } from '../../lib/offline/db'
import { EmptyState, cn } from '../../components/ui'
import { MobileLayout } from '../../components/layouts/MobileLayout'
import { useEffect, useState } from 'react'

export function EvaluarHome() {
  const { profile } = useAuth()
  const { sucursales } = useCatalog()
  const { pendientes } = useOffline()
  const [conDraft, setConDraft] = useState<Record<string, boolean>>({})

  useEffect(() => {
    void (async () => {
      const map: Record<string, boolean> = {}
      for (const s of sucursales) {
        const d = await getDraft(s.id)
        if (d) map[s.id] = true
      }
      setConDraft(map)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sucursales.length, pendientes])

  return (
    <MobileLayout titulo="Evaluar" subtitulo="Selecciona la sucursal">
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-bold text-primary-900">Hola, {profile?.nombre?.split(' ')[0] || 'evaluador'}</h2>
          <p className="text-sm text-slate-500">Selecciona la sucursal que vas a evaluar.</p>
        </div>

        {!sucursales.length ? (
          <EmptyState
            title="No hay sucursales activas"
            subtitle="El Líder debe crear sucursales para poder evaluar."
          />
        ) : (
          <div className="space-y-3">
            {sucursales.map((s) => (
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
                      {s.shop_id ? `Tienda Nº ${s.shop_id}` : 'Sin nº de tienda'}
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-xs font-bold text-white">
                    {conDraft[s.id] ? <>Continuar <ChevronRight className="h-3.5 w-3.5" /></> : 'Evaluar'}
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
    </MobileLayout>
  )
}