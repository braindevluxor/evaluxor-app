import { useEffect, useState, type ChangeEvent } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Database, Fingerprint, RefreshCw, Server, Store, Upload } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { Badge, Button, Input, SkeletonFilas, Spinner } from '../../components/ui'
import { supabase } from '../../lib/supabase'
import { listarColaboradores } from '../../lib/data/colaboradores'
import {
  asegurarProyectoBiometrico,
  actualizarNombres,
  coloresTipo,
  definirSucursalProyecto,
  etiquetaTipo,
  guardarMarcajes,
  guardarUrlPuente,
  leerMarcajesPuente,
  listaMarcajes,
  normalizarDni,
  urlPuenteGuardada,
  verificarDispositivo,
  type DispositivoInfo,
  type InfoTrabajador,
  type Marcaje,
  type Proyecto,
  type TipoMarcaje
} from '../../lib/marcajes'

interface SucursalInfo {
  id: string
  nombre: string
  branch_id: string | null
  shop_id: string | null
}

function formatoFechaLocal(d: Date): string {
  const anio = d.getFullYear()
  const mes = String(d.getMonth() + 1).padStart(2, '0')
  const dia = String(d.getDate()).padStart(2, '0')
  return `${anio}-${mes}-${dia}`
}

function diasAtras(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return formatoFechaLocal(d)
}

export function BiometricoProyecto() {
  const { profile } = useAuth()
  const esLider = profile?.rol === 'LIDER'

  const [proyecto, setProyecto] = useState<Proyecto | null | undefined>(undefined)
  const [aviso, setAviso] = useState<string | null>(null)
  const [sucursales, setSucursales] = useState<SucursalInfo[]>([])

  // Puente local (app de escritorio que lee el D100 por USB).
  const [urlPuente, setUrlPuente] = useState(urlPuenteGuardada())
  const [dispositivo, setDispositivo] = useState<DispositivoInfo | null>(null)
  const [comprobando, setComprobando] = useState(false)
  const [sincronizando, setSincronizando] = useState(false)
  const [syncMensaje, setSyncMensaje] = useState<string | null>(null)

  // Marcajes.
  const [marcajes, setMarcajes] = useState<Marcaje[] | null>(null)
  const [listaMensaje, setListaMensaje] = useState<string | null>(null)
  const [desde, setDesde] = useState(diasAtras(90))
  const [hasta, setHasta] = useState(diasAtras(0))
  const [dni, setDni] = useState('')
  const [tipo, setTipo] = useState<TipoMarcaje | 'TODOS'>('TODOS')

  useEffect(() => {
    void (async () => {
      const { proyecto: p, mensaje: m } = await asegurarProyectoBiometrico(profile?.id ?? null)
      setProyecto(p)
      if (m) setAviso(m)
    })()
    void (async () => {
      try {
        const { data, error } = await supabase.from('sucursales').select('id, nombre, branch_id, shop_id').order('nombre')
        if (!error) setSucursales((data ?? []) as SucursalInfo[])
      } catch {
        // Sin conexión: el select simplemente queda vacío.
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!proyecto) return
    let activo = true
    void (async () => {
      const { marcajes: ms, mensaje: m } = await listaMarcajes(proyecto.id, {
        desde,
        hasta,
        dni: dni || null,
        tipo
      })
      if (!activo) return
      setMarcajes(ms)
      setListaMensaje(m)
    })()
    return () => {
      activo = false
    }
  }, [proyecto, desde, hasta, dni, tipo])

  async function comprobar() {
    setComprobando(true)
    const info = await verificarDispositivo(urlPuente)
    setDispositivo(info)
    setComprobando(false)
  }

  function guardarPuente() {
    guardarUrlPuente(urlPuente)
    setDispositivo(null)
    void comprobar()
  }

  async function sincronizar() {
    if (!proyecto) return
    setSincronizando(true)
    setSyncMensaje(null)
    try {
      const info = await verificarDispositivo(urlPuente)
      setDispositivo(info)

      const desdeSync = new Date()
      desdeSync.setDate(desdeSync.getDate() - 90)
      const hastaSync = new Date()
      hastaSync.setDate(hastaSync.getDate() + 1)

      const { marcajes: marcajesPuente, mensaje: mPuente } = await leerMarcajesPuente(
        desdeSync.toISOString(),
        hastaSync.toISOString(),
        urlPuente
      )
      if (mPuente) {
        setSyncMensaje(`Puente: ${mPuente}`)
        return
      }
      if (!marcajesPuente.length) {
        setSyncMensaje('El puente no devolvió marcajes en los últimos 90 días. Verificá que el D100 esté conectado.')
        return
      }

      const { insertados, mensaje: mGuardar } = await guardarMarcajes(proyecto.id, marcajesPuente, profile?.id ?? null)

      // Si la carpeta tiene sucursal asignada, resolvemos los nombres de los colaboradores.
      let identificados = 0
      if (!mGuardar) {
        const sucursal = sucursales.find((s) => s.id === proyecto.sucursal_id)
        const branchId = sucursal?.branch_id ?? sucursal?.shop_id ?? null
        if (branchId) {
          const { colaboradores } = await listarColaboradores(branchId)
          const porDni = new Map<string, InfoTrabajador>()
          for (const c of colaboradores) {
            const d = normalizarDni(c.dni)
            if (!d) continue
            const nombre = [c.name, c.lastname].filter(Boolean).join(' ').trim() || d
            porDni.set(d, { nombre, rol: c.role_name ?? '' })
          }
          if (porDni.size) {
            await actualizarNombres(proyecto.id, porDni)
            identificados = porDni.size
          }
        }
      }

      const resumen = mGuardar
        ? mGuardar
        : insertados > 0
          ? `Sincronización completada: ${insertados} marcajes nuevos.`
          : 'Sin marcajes nuevos: todo lo del dispositivo ya estaba cargado.'
      setSyncMensaje(identificados ? `${resumen} · ${identificados} trabajadores identificados.` : resumen)
    } finally {
      setSincronizando(false)
    }
  }

  async function cambiarSucursal(e: ChangeEvent<HTMLSelectElement>) {
    if (!proyecto) return
    const val = e.target.value || null
    const { ok, mensaje: m } = await definirSucursalProyecto(proyecto.id, val)
    if (ok) setProyecto({ ...proyecto, sucursal_id: val })
    else if (m) setAviso(m)
  }

  if (proyecto === undefined) {
    return <SkeletonFilas card n={3} />
  }

  if (!proyecto) {
    return (
      <div className="space-y-4">
        <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {aviso ?? 'No se pudo preparar el proyecto del biométrico.'}
        </p>
        <Link to="/proyectos" className="inline-flex items-center gap-1 text-sm font-semibold text-primary">
          <ArrowLeft className="h-4 w-4" /> Volver a proyectos
        </Link>
      </div>
    )
  }

  const sucursal = sucursales.find((s) => s.id === proyecto.sucursal_id)
  const conectado = dispositivo?.conectado === true

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <Link to="/proyectos" className="inline-flex items-center gap-1 text-sm font-semibold text-primary">
            <ArrowLeft className="h-4 w-4" /> Proyectos
          </Link>
          <h2 className="mt-1 flex items-center gap-2 text-lg font-extrabold text-primary-900">
            <Fingerprint className="h-5 w-5" /> {proyecto.nombre}
          </h2>
          <p className="text-sm text-slate-500">{proyecto.descripcion}</p>
        </div>
        <Badge color={proyecto.sucursal_id ? 3 : 0} className="shrink-0">
          <Store className="h-3 w-3" /> {sucursal?.nombre ?? 'Sin sucursal asignada'}
        </Badge>
      </div>

      {aviso ? <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{aviso}</p> : null}

      <div className="grid gap-6 lg:grid-cols-5">
        {/* Panel del dispositivo ------------------------------------------- */}
        <section className="space-y-4 lg:col-span-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <h3 className="flex items-center gap-2 font-bold text-slate-900">
              <Server className="h-4 w-4 text-primary" /> Dispositivo biométrico
            </h3>

            <div className="mt-3 flex items-center gap-2">
              <Badge color={conectado ? 2 : 4}>{conectado ? 'Conectado' : 'Desconectado'}</Badge>
              {dispositivo?.modelo ? <span className="text-sm font-semibold text-slate-700">{dispositivo.modelo}</span> : null}
              {dispositivo?.serial ? <span className="text-xs text-slate-400">{dispositivo.serial}</span> : null}
            </div>

            {dispositivo?.mensaje ? (
              <p className="mt-2 text-xs text-slate-500">{dispositivo.mensaje}</p>
            ) : (
              <p className="mt-2 text-xs text-slate-400">
                El D100 se lee desde una app puente de escritorio. Usá «Comprobar» para consultar su estado.
              </p>
            )}

            <label className="mt-4 block text-xs font-semibold text-slate-500">URL del puente (localhost)</label>
            <div className="mt-1 flex gap-2">
              <Input
                value={urlPuente}
                onChange={(e) => setUrlPuente(e.target.value)}
                placeholder="http://127.0.0.1:8787"
                disabled={!esLider}
              />
              {esLider ? (
                <Button variant="secondary" onClick={guardarPuente} disabled={comprobando}>
                  {comprobando ? <Spinner size={16} /> : `Guardar`}
                </Button>
              ) : null}
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => void comprobar()} disabled={comprobando}>
                {comprobando ? <Spinner size={16} /> : <RefreshCw className="h-4 w-4" />} Comprobar
              </Button>
              {esLider ? (
                <Button onClick={() => void sincronizar()} disabled={sincronizando}>
                  {sincronizando ? <Spinner size={16} light /> : <Upload className="h-4 w-4" />} Sincronizar marcajes
                </Button>
              ) : null}
            </div>

            {!esLider ? (
              <p className="mt-3 text-xs text-slate-400">Solo el LIDER puede conectar el dispositivo o sincronizar.</p>
            ) : null}

            {syncMensaje ? (
              <p
                className={
                  syncMensaje.startsWith('Puente:') || syncMensaje.includes('Error')
                    ? 'mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700'
                    : 'mt-3 rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-700'
                }
              >
                {syncMensaje}
              </p>
            ) : null}

            {esLider ? (
              <div className="mt-5 border-t border-slate-100 pt-4">
                <label className="block text-xs font-semibold text-slate-500">Sucursal del dispositivo</label>
                <select
                  value={proyecto.sucursal_id ?? ''}
                  onChange={(e) => void cambiarSucursal(e)}
                  className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 focus:border-primary-400 focus:outline-none"
                >
                  <option value="">Sin sucursal (solo DNI)</option>
                  {sucursales.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.nombre}
                    </option>
                  ))}
                </select>
                <p className="mt-2 text-xs text-slate-400">
                  Con sucursal asignada, los marcajes se relacionan con el listado de colaboradores para mostrar nombre y
                  rol.
                </p>
              </div>
            ) : null}
          </div>
        </section>

        {/* Listado de marcajes --------------------------------------------- */}
        <section className="space-y-4 lg:col-span-3">
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="flex items-center gap-2 font-bold text-slate-900">
                <Database className="h-4 w-4 text-primary" /> Marcajes (fichajes)
              </h3>
              {marcajes ? <span className="text-sm font-semibold text-slate-500">{marcajes.length} registros</span> : null}
            </div>

            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <label className="block">
                <span className="text-xs font-semibold text-slate-500">Desde</span>
                <Input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
              </label>
              <label className="block">
                <span className="text-xs font-semibold text-slate-500">Hasta</span>
                <Input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
              </label>
              <label className="block">
                <span className="text-xs font-semibold text-slate-500">DNI</span>
                <Input value={dni} onChange={(e) => setDni(e.target.value)} placeholder="Buscar por DNI" />
              </label>
              <label className="block">
                <span className="text-xs font-semibold text-slate-500">Tipo</span>
                <select
                  value={tipo}
                  onChange={(e) => setTipo(e.target.value as TipoMarcaje | 'TODOS')}
                  className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 focus:border-primary-400 focus:outline-none"
                >
                  <option value="TODOS">Todos</option>
                  <option value="ENTRADA">Entrada</option>
                  <option value="SALIDA">Salida</option>
                  <option value="OTRO">Sin clasificar</option>
                </select>
              </label>
            </div>

            {listaMensaje ? <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{listaMensaje}</p> : null}

            {marcajes === null ? (
              <div className="mt-4"><SkeletonFilas n={4} /></div>
            ) : marcajes.length === 0 ? (
              <div className="mt-6 rounded-xl border border-dashed border-slate-200 py-10 text-center">
                <Database className="mx-auto h-8 w-8 text-slate-300" strokeWidth={1.5} />
                <p className="mt-2 text-sm font-semibold text-slate-600">Sin marcajes en este rango</p>
                <p className="text-xs text-slate-400">
                  Conectá el puente y sincronizá el D100, o ajustá los filtros.
                </p>
              </div>
            ) : (
              <div className="mt-4 overflow-x-auto rounded-xl border border-slate-100">
                <table className="w-full min-w-120 text-left text-sm">
                  <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-2.5">Fecha y hora</th>
                      <th className="px-4 py-2.5">Trabajador</th>
                      <th className="px-4 py-2.5">DNI</th>
                      <th className="px-4 py-2.5">Tipo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {marcajes.map((m) => (
                      <tr key={m.id} className="hover:bg-slate-50/60">
                        <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-slate-700">
                          {new Date(m.marcado_en).toLocaleString('es-ES', {
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </td>
                        <td className="px-4 py-2.5 font-medium text-slate-800">
                          {m.trabajador_nombre === m.trabajador_dni ? 'Sin identificar' : m.trabajador_nombre}
                          {m.rol ? <span className="block text-xs font-normal text-slate-400">{m.rol}</span> : null}
                        </td>
                        <td className="px-4 py-2.5 tabular-nums text-slate-600">{m.trabajador_dni}</td>
                        <td className="px-4 py-2.5">
                          <Badge color={coloresTipo(m.tipo)}>{etiquetaTipo(m.tipo)}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}