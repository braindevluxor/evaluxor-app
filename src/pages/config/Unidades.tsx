import { useState } from 'react'
import { Building2, Store } from 'lucide-react'
import { Button, cn } from '../../components/ui'
import { SucursalesPage } from './Sucursales'
import { DepartamentosPage } from './Departamentos'

export function UnidadesPage() {
  const [tab, setTab] = useState<'sucursales' | 'departamentos'>('sucursales')

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Unidades</h1>
        <div className="flex p-1 bg-slate-100 rounded-xl">
          <Button
            variant="ghost"
            className={cn('rounded-lg px-4 py-1.5 text-xs transition-all', tab === 'sucursales' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700')}
            onClick={() => setTab('sucursales')}
          >
            <Store className="mr-2 h-3.5 w-3.5" />
            Sucursales
          </Button>
          <Button
            variant="ghost"
            className={cn('rounded-lg px-4 py-1.5 text-xs transition-all', tab === 'departamentos' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700')}
            onClick={() => setTab('departamentos')}
          >
            <Building2 className="mr-2 h-3.5 w-3.5" />
            Departamentos
          </Button>
        </div>
      </div>

      <div className="transition-all">
        {tab === 'sucursales' ? <SucursalesPage /> : <DepartamentosPage />}
      </div>
    </div>
  )
}
