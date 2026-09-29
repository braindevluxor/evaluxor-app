import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, FolderKanban, Store } from 'lucide-react'
import { Badge, SkeletonFilas } from '../../components/ui'
import { supabase } from '../../lib/supabase'
import type { Proyecto } from '../../lib/marcajes'

interface SucursalMini {
  id: string
  nombre: string
}

export function ProyectoDetalle() {
  const { id } = useParams<{ id: string }>()
  const [proyecto, setProyecto] = useState<Proyecto | null | undefined>(undefined)
  const [mensaje, setMensaje] = useState<string | null>(null)
  const [sucursal, setSucursal] = useState<SucursalMini | null>(null)

  useEffect(() => {
    if (!id) {
      setProyecto(null)
      setMensaje('Proyecto no encontrado.')
      return
    }
    void (async () => {
      const { data, error } = await supabase
        .from('proyectos')
        .select('*')
        .eq('id', id)
        .maybeSingle()
      if (error || !data) {
        setProyecto(null)
        setMensaje(error ? `No se pudo cargar el proyecto: ${error.message}` : 'Proyecto no encontrado.')
        return
      }
      const p = data as Proyecto
      setProyecto(p)
      if (p.sucursal_id) {
        const { data: s } = await supabase.from('sucursales').select('id, nombre').eq('id', p.sucursal_id).maybeSingle()
        if (s) setSucursal(s as SucursalMini)
      }
    })()
  }, [id])

  if (proyecto === undefined) return <SkeletonFilas card n={2} />

  if (!proyecto) {
    return (
      <div className="space-y-4">
        <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{mensaje}</p>
        <Link to="/proyectos" className="inline-flex items-center gap-1 text-sm font-semibold text-primary">
          <ArrowLeft className="h-4 w-4" /> Volver a proyectos
        </Link>
      </div>
    )
  }

  return (
    <div className="max-w-2xl">
      <Link to="/proyectos" className="inline-flex items-center gap-1 text-sm font-semibold text-primary">
        <ArrowLeft className="h-4 w-4" /> Proyectos
      </Link>

      <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-6">
        <div className="flex items-start justify-between gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-600">
            <FolderKanban className="h-6 w-6" />
          </span>
          {sucursal ? (
            <Badge color={3}>
              <Store className="h-3 w-3" /> {sucursal.nombre}
            </Badge>
          ) : null}
        </div>
        <h2 className="mt-4 text-xl font-extrabold text-primary-900">{proyecto.nombre}</h2>
        <p className="mt-2 text-sm text-slate-500">{proyecto.descripcion || 'Sin descripción.'}</p>
        <dl className="mt-6 grid gap-3 border-t border-slate-100 pt-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">Creado</dt>
            <dd className="mt-0.5 font-medium text-slate-700">
              {new Date(proyecto.created_at).toLocaleDateString('es-ES', {
                day: '2-digit',
                month: 'long',
                year: 'numeric'
              })}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">Tipo</dt>
            <dd className="mt-0.5 font-medium text-slate-700">
              {proyecto.tipo === 'BIOMETRICO' ? 'Biométrico' : 'Genérico'}
            </dd>
          </div>
        </dl>
      </div>
    </div>
  )
}