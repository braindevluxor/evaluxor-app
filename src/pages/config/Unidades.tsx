import { useState } from 'react'
import { Building2, Store } from 'lucide-react'
import { Button, cn } from '../../components/ui'
import { PortalCabecera } from '../../components/PortalCabecera'
import { SucursalesPage } from './Sucursales'
import { DepartamentosPage } from './Departamentos'

export function UnidadesPage() {
  const [tab, setTab] = useState<'sucursales' | 'departamentos'>('sucursales')

  return (
    <div className="space-y-6">
      {/* El selector de pestañas vive en la barra superior, junto al botón
          «+ Nueva» de la pestaña activa (que se cuelga de la misma barra desde
          su página). El título «Unidades» ya lo trae la cabecera de la
          consola, así que la vista arranca directo con las tablas. */}
      <PortalCabecera>
        <div role="group" aria-label="Tipo de unidad" className="flex p-1 bg-slate-100 rounded-xl">
          <Button
            variant="ghost"
            aria-pressed={tab === 'sucursales'}
            title="Sucursales"
            className={cn('rounded-lg px-4 py-1.5 text-xs transition-all', tab === 'sucursales' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700')}
            onClick={() => setTab('sucursales')}
          >
            <Store className="h-3.5 w-3.5 sm:mr-2" />
            {/* Sólo icono en el teléfono: la barra ya lleva el menú, el título
                y ahora dos controles más. */}
            <span className="hidden sm:inline">Sucursales</span>
          </Button>
          <Button
            variant="ghost"
            aria-pressed={tab === 'departamentos'}
            title="Departamentos"
            className={cn('rounded-lg px-4 py-1.5 text-xs transition-all', tab === 'departamentos' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700')}
            onClick={() => setTab('departamentos')}
          >
            <Building2 className="h-3.5 w-3.5 sm:mr-2" />
            <span className="hidden sm:inline">Departamentos</span>
          </Button>
        </div>
      </PortalCabecera>

      <div className="transition-all">
        {tab === 'sucursales' ? <SucursalesPage /> : <DepartamentosPage />}
      </div>
    </div>
  )
}
