import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Fingerprint, FolderKanban, FolderPlus, RefreshCw, Store } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { Badge, Button, Input, SkeletonFilas, Spinner } from '../../components/ui'
import { supabase } from '../../lib/supabase'
import { crearProyecto, listarProyectos, type Proyecto } from '../../lib/marcajes'

interface SucursalMini {
  id: string
  nombre: string
}

export function ProyectosHome() {
  const { profile } = useAuth()
  const esLider = profile?.rol === 'LIDER'

  const [proyectos, setProyectos] = useState<Proyecto[] | null>(null)
  const [mensaje, setMensaje] = useState<string | null>(null)
  const [sucursales, setSucursales] = useState<SucursalMini[]>([])

  // Formulario "nuevo proyecto"
  const [nombre, setNombre] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [sucursalId, setSucursalId] = useState('')
  const [creando, setCreando] = useState(false)

  async function cargar() {
    const { proyectos: ps, mensaje: m } = await listarProyectos()
    setProyectos(ps)
    if (m) setMensaje(m)
  }

  useEffect(() => {
    void cargar()
    void (async () => {
      try {
        const { data, error } = await supabase.from('sucursales').select('id, nombre').order('nombre')
        if (!error) setSucursales((data ?? []) as SucursalMini[])
      } catch {
        // Sin conexión: el select simplemente queda vacío.
      }
    })()
  }, [])

  async function crear(e: FormEvent) {
    e.preventDefault()
    if (!nombre.trim()) return
    setCreando(true)
    const { mensaje: m } = await crearProyecto(nombre.trim(), descripcion.trim(), sucursalId || null, profile?.id ?? null)
    setCreando(false)
    if (m) {
      setMensaje(m)
      return
    }
    setNombre('')
    setDescripcion('')
    setSucursalId('')
    setMensaje(null)
    await cargar()
  }

  const biometrico = proyectos?.find((p) => p.tipo === 'BIOMETRICO')
  const genericos = (proyectos ?? []).filter((p) => p.tipo !== 'BIOMETRICO')
  const nombreSucursal = (id: string | null) => sucursales.find((s) => s.id === id)?.nombre

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-sm text-slate-500">
          Carpetas de trabajo de la organización. La primera es el proyecto <strong>Biométrico D100</strong>: los
          fichajes del lector Anviz conectado por USB en la sucursal.
        </p>
        {esLider ? (
          <Button variant="secondary" onClick={() => void cargar()}>
            <RefreshCw className="h-4 w-4" /> Actualizar
          </Button>
        ) : null}
      </div>

      {mensaje ? <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{mensaje}</p> : null}

      {!proyectos ? (
        <SkeletonFilas card n={3} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {/* El proyecto del biométrico siempre es la primera "carpeta". */}
          {biometrico ? (
            <Link
              to="/proyectos/biometrico"
              className="group rounded-2xl border border-slate-200 bg-white p-5 transition-colors hover:border-primary-300 hover:bg-primary-50/50"
            >
              <div className="flex items-start justify-between">
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-primary-50 text-primary">
                  <Fingerprint className="h-5 w-5" />
                </span>
                <Badge color={5}>Biométrico</Badge>
              </div>
              <h3 className="mt-3 font-bold text-slate-900 group-hover:text-primary-700">{biometrico.nombre}</h3>
              <p className="mt-1 line-clamp-2 text-sm text-slate-500">{biometrico.descripcion}</p>
              <p className="mt-3 text-xs font-semibold text-primary-700">Abrir marcajes →</p>
            </Link>
          ) : (
            <Link
              to="/proyectos/biometrico"
              className="group rounded-2xl border-2 border-dashed border-slate-200 bg-white/60 p-5 transition-colors hover:border-primary-300"
            >
              <div className="flex items-start justify-between">
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-primary-50 text-primary">
                  <Fingerprint className="h-5 w-5" />
                </span>
                <Badge color={5}>Biométrico</Badge>
              </div>
              <h3 className="mt-3 font-bold text-slate-900 group-hover:text-primary-700">Biométrico D100 (Anviz)</h3>
              <p className="mt-1 line-clamp-2 text-sm text-slate-500">
                Fichajes del lector Anviz D100. Entrá y el proyecto se crea automáticamente.
              </p>
              <p className="mt-3 text-xs font-semibold text-primary-700">Abrir marcajes →</p>
            </Link>
          )}

          {/* Carpetas genéricas. */}
          {genericos.map((p) => (
            <Link
              key={p.id}
              to={`/proyectos/${p.id}`}
              className="group rounded-2xl border border-slate-200 bg-white p-5 transition-colors hover:border-primary-300 hover:bg-primary-50/50"
            >
              <div className="flex items-start justify-between">
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-slate-100 text-slate-600">
                  <FolderKanban className="h-5 w-5" />
                </span>
                {p.sucursal_id ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">
                    <Store className="h-3 w-3" /> {nombreSucursal(p.sucursal_id) ?? 'Sucursal'}
                  </span>
                ) : null}
              </div>
              <h3 className="mt-3 font-bold text-slate-900 group-hover:text-primary-700">{p.nombre}</h3>
              <p className="mt-1 line-clamp-2 text-sm text-slate-500">{p.descripcion || 'Sin descripción.'}</p>
              <p className="mt-3 text-xs text-slate-400">{new Date(p.created_at).toLocaleDateString('es-ES')}</p>
            </Link>
          ))}

          {/* Crear carpeta (solo LIDER). */}
          {esLider ? (
            <form
              onSubmit={crear}
              className="flex flex-col gap-3 rounded-2xl border-2 border-dashed border-slate-200 bg-white/60 p-5"
            >
              <h3 className="flex items-center gap-2 font-bold text-slate-700">
                <FolderPlus className="h-4 w-4" /> Nuevo proyecto
              </h3>
              <Input
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                placeholder="Nombre del proyecto"
                maxLength={80}
              />
              <Input
                value={descripcion}
                onChange={(e) => setDescripcion(e.target.value)}
                placeholder="Descripción (opcional)"
                maxLength={200}
              />
              <select
                value={sucursalId}
                onChange={(e) => setSucursalId(e.target.value)}
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 focus:border-primary-400 focus:outline-none"
              >
                <option value="">Sin sucursal</option>
                {sucursales.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nombre}
                  </option>
                ))}
              </select>
              <Button type="submit" disabled={creando || !nombre.trim()}>
                {creando ? <Spinner size={16} /> : 'Crear carpeta'}
              </Button>
            </form>
          ) : null}
        </div>
      )}
    </div>
  )
}