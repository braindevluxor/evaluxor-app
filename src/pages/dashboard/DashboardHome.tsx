import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle } from 'lucide-react'
import { DashboardFiltersPortal } from '../../context/DashboardFiltersContext'
import { useAuth } from '../../context/AuthContext'
import { useCatalog } from '../../context/CatalogContext'
import {
  consultarEvaluaciones,
  detalleDeEvaluacion,
  incumplimientosEnRango,
  medidoresPorModulo,
  puntajePorSucursalModulo,
  rankingDepartamentos,
  rankingResponsables,
  rankingSucursales,
  renglonesDrilldown
} from '../../lib/data/indicadores'
import type { AlcanceDrilldown, ConjuntoDatos } from '../../lib/data/indicadores'
import { Card, Field, Input, Select, Skeleton, cn } from '../../components/ui'
import { subtituloMedidor } from '../../components/dashboard/subtituloMedidor'
import { IconoModulo } from '../../components/IconoModulo'
import { ModalDrilldown, DetalleEvalCabecera, DetalleRespuestasLista } from '../../components/dashboard/ModalDrilldown'
import { verTodo } from '../../lib/roles'
import { setKpisGlobal } from '../../lib/kpisGlobal'
import { pct as pctComa } from '../../lib/numeros'
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend, ReferenceLine,
  PieChart, Pie, Cell
} from 'recharts'
import { CLASE_CONTENEDOR_DASHBOARD, COLORES_MODULOS, HEX_PRIMARY, HEX_CUMPLE, HEX_RIESGO, colorFondoPuntaje, colorPuntajeClase, colorSerie } from '../../lib/diseno'

function haceMeses(n: number): string {
  const d = new Date()
  d.setMonth(d.getMonth() - n)
  return d.toISOString().slice(0, 10)
}

/**
 * Gráfico "Ponderación por unidad y módulo": una curva por módulo con la barra
 * translúcida del promedio de la unidad. El mismo componente dibuja sucursales
 * y departamentos; solo cambian las filas y a qué unidad apunta el clic.
 */
function GraficoPonderacion({
  titulo,
  descripcion,
  filas,
  modulos,
  nombrePromedio,
  lineaActiva,
  setLineaActiva,
  onClic,
  sinDatos,
  className
}: {
  titulo: string
  descripcion: string
  filas: { nombre: string; porModulo: Record<string, number | null> }[]
  modulos: { modulo_id: string; nombre: string }[]
  /** Nombre de la barra en la leyenda ('Promedio por sucursal' / '… por departamento'). */
  nombrePromedio: string
  lineaActiva: string | null
  setLineaActiva: (valor: string | null) => void
  onClic: (data: unknown) => void
  sinDatos: string
  /** Ancho de la columna en la grilla (p. ej. 'xl:col-span-2'). */
  className?: string
}) {
  const filasGrafico = filas.map((f) => {
    const valores = Object.values(f.porModulo).filter((v): v is number => v != null)
    return {
      unidad: f.nombre,
      ...f.porModulo,
      promedio: valores.length ? Math.round((valores.reduce((a, b) => a + b, 0) / valores.length) * 100) / 100 : null
    }
  })
  return (
    <Card className={cn('border-0!', CLASE_CONTENEDOR_DASHBOARD, className)}>
      <h3 className="mb-1 font-bold text-primary-900">{titulo}</h3>
      <p className="mb-3 text-xs text-slate-400">{descripcion}</p>
      {modulos.length && filas.length ? (
        <ResponsiveContainer width="100%" height={ALTO_GRAFICO}>
          <ComposedChart data={filasGrafico} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
            <XAxis dataKey="unidad" interval={0} angle={-38} textAnchor="end" height={90} tick={{ fontSize: 11, fill: '#475569' }} />
            <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
            <ReferenceLine y={80} stroke={HEX_CUMPLE} strokeDasharray="4 4" strokeOpacity={0.4} />
            <ReferenceLine y={60} stroke={HEX_RIESGO} strokeDasharray="4 4" strokeOpacity={0.4} />
            <Tooltip
              formatter={(v, nombre) => [pctComa(Number(v)), String(nombre)]}
              contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 13 }}
            />
            <Legend
              iconType="plainline"
              wrapperStyle={{ fontSize: 12 }}
              onMouseEnter={(d) => setLineaActiva(d.value === nombrePromedio ? null : (d.value ?? null))}
              onMouseLeave={() => setLineaActiva(null)}
            />
            {/* Barra translúcida: ponderación promedio de la unidad (detrás de las curvas) */}
            <Bar
              dataKey="promedio"
              name={nombrePromedio}
              fill={HEX_PRIMARY}
              fillOpacity={0.14}
              radius={[4, 4, 0, 0]}
              barSize={16}
              legendType="rect"
              onClick={onClic}
              style={{ cursor: 'pointer' }}
            />
            {modulos.map((m, i) => (
              <Line
                key={m.modulo_id}
                type="monotone"
                dataKey={m.nombre}
                stroke={COLORES_MODULOS[i % COLORES_MODULOS.length]}
                strokeWidth={lineaActiva === m.nombre ? 4 : 2}
                connectNulls
                dot={{ r: 3, strokeWidth: 1 }}
                activeDot={{ r: 5 }}
                opacity={lineaActiva && lineaActiva !== m.nombre ? 0.3 : 1}
                onClick={onClic}
                style={{ cursor: 'pointer' }}
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      ) : <p className="text-sm text-slate-400">{sinDatos}</p>}
    </Card>
  )
}

/**
 * Alto del gráfico de ponderación de la fila de arriba: baja de 380 a 300
 * para que la fila 1 + la de las tortas quepan en la ventana sin scrollear.
 */
const ALTO_GRAFICO = 300

/** Alto fijo de cada torta de la fila de abajo y de su leyenda al lado. */
const ALTO_TORTA = 260

/** Fila de la torta: la misma forma que traían las listas, para no tocar la capa de datos. */
type FilaTorta = {
  nombre: string
  puntaje: number | null
  completadas: number
  /** Clave única del nombre (los cargos pueden repetir forma de escribirse). */
  clave?: string
}

/** Tooltip de la porción: nombre, puntaje con su umbral y evaluaciones que lo respaldan. */
function TooltipTorta({ active, payload }: { active?: boolean; payload?: readonly { payload?: FilaTorta }[] }) {
  const f = payload?.[0]?.payload
  if (!active || !f) return null
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
      <p className="font-bold text-slate-800">{f.nombre}</p>
      <p className={cn('font-black tabular-nums', colorPuntajeClase(f.puntaje))}>
        {f.puntaje == null ? '—' : pctComa(f.puntaje)}
      </p>
      <p className="text-slate-400">{f.completadas} {f.completadas === 1 ? 'evaluación' : 'evaluaciones'}</p>
    </div>
  )
}

/**
 * Torta de promedios: reemplazó a la lista con barras (se pidió en 2026-01).
 * Cada porción es la participación de la unidad en el total —su puntaje sobre
 * la suma de todos— y su color la identifica; el puntaje real de la unidad
 * está en el tooltip de la porción y en la leyenda al lado. Esa leyenda además
 * es la forma accesible de recorrer el listado: una porción de recharts no se
 * puede enfocar con el teclado ni leer de corrido.
 */
function GraficoTorta({
  titulo,
  descripcion,
  icono,
  filas,
  etiqueta,
  sinDatos,
  onClic,
  className
}: {
  titulo: string
  descripcion: string
  /** Icono junto al título (la tarjeta de cargos trae el de alerta). */
  icono?: ReactNode
  filas: FilaTorta[]
  /** Plural para lo que quedó afuera por no tener puntaje: 'sucursales' / 'departamentos' / 'cargos'. */
  etiqueta: string
  sinDatos: string
  /** Sin clic queda sólo informativa: la tarjeta de cargos no tiene drilldown. */
  onClic?: (fila: FilaTorta) => void
  className?: string
}) {
  // Una torta no puede dibujar un ángulo sin puntaje: en vez de perder esas
  // unidades en silencio se cuentan en el rótulo de abajo.
  const conPuntaje = filas.filter((f): f is FilaTorta & { puntaje: number } => f.puntaje != null)
  const sinPuntaje = filas.length - conPuntaje.length
  return (
    <Card className={cn('border-0!', CLASE_CONTENEDOR_DASHBOARD, className)}>
      <div className="mb-3 flex items-center gap-2.5">
        {icono}
        <div className="min-w-0">
          <h3 className="font-bold text-primary-900">{titulo}</h3>
          <p className="text-xs text-slate-400">{descripcion}</p>
        </div>
      </div>
      {!filas.length ? (
        <p className="text-sm text-slate-400">{sinDatos}</p>
      ) : !conPuntaje.length ? (
        <p className="text-sm text-slate-400">Sin {etiqueta} con puntaje en el rango.</p>
      ) : (
        <>
          <div className="flex gap-3">
            <div className="w-[45%] shrink-0">
              <ResponsiveContainer width="100%" height={ALTO_TORTA}>
                <PieChart>
                  <Pie
                    data={conPuntaje}
                    dataKey="puntaje"
                    nameKey="nombre"
                    outerRadius="82%"
                    paddingAngle={0.5}
                    onClick={(sector) => {
                      const fila = (sector as { payload?: FilaTorta } | null)?.payload
                      if (fila) onClic?.(fila)
                    }}
                  >
                    {conPuntaje.map((f, i) => (
                      <Cell key={f.clave ?? f.nombre} fill={colorSerie(i)} />
                    ))}
                  </Pie>
                  <Tooltip content={<TooltipTorta />} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <ul
              className="min-w-0 flex-1 divide-y divide-slate-200 overflow-y-auto rounded-xl border border-slate-200"
              style={{ height: ALTO_TORTA }}
            >
              {conPuntaje.map((f, i) => (
                <li key={f.clave ?? f.nombre}>
                  {onClic ? (
                    <button
                      type="button"
                      onClick={() => onClic(f)}
                      title={`${f.nombre}: ${pctComa(f.puntaje)} · ${f.completadas} ${f.completadas === 1 ? 'evaluación' : 'evaluaciones'}`}
                      className="flex w-full items-center gap-2 px-2 py-1.5 text-left transition-colors hover:bg-primary-50/40"
                    >
                      <DatoTorta fila={f} color={colorSerie(i)} />
                    </button>
                  ) : (
                    <div className="flex w-full items-center gap-2 px-2 py-1.5">
                      <DatoTorta fila={f} color={colorSerie(i)} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
          {sinPuntaje ? (
            <p className="mt-2 text-[11px] text-slate-400">Sin puntaje en el rango: {sinPuntaje} {etiqueta}</p>
          ) : null}
        </>
      )}
    </Card>
  )
}

/** Renglón de la leyenda de una porción: color, nombre y su puntaje. */
function DatoTorta({ fila, color }: { fila: FilaTorta; color: string }) {
  return (
    <>
      <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: color }} />
      <span className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-800">{fila.nombre}</span>
      <span className={cn('shrink-0 text-xs font-black tabular-nums', colorPuntajeClase(fila.puntaje))}>
        {pctComa(fila.puntaje)}
      </span>
    </>
  )
}

/**
 * Cumplimiento por módulo en su forma mínima: sólo el porcentaje y el icono
 * que identifica al módulo, pintados en blanco sobre el color del puntaje (el
 * fondo de la tarjeta es verde, ámbar o rojo según la nota, y gris si nunca
 * se midió). El nombre y la cobertura no se pintan: van en el tooltip del
 * enlace que envuelve la tarjeta. Es el `title` nativo del HTML y no un
 * tooltip armado con CSS porque la grilla tiene `overflow-y-auto` (se lleva la
 * altura que queda de la ventana) y se lo comería igual.
 */
function TarjetaModulo({ promedio, icono }: { promedio: number | null; icono?: string }) {
  return (
    <div
      className="flex items-center justify-center gap-2.5 rounded-xl px-3 py-2.5"
      style={{ background: colorFondoPuntaje(promedio) }}
    >
      <span className="shrink-0 text-2xl font-black tabular-nums leading-none text-white">
        {promedio == null ? '—' : pctComa(promedio, 0)}
      </span>
      <IconoModulo nombre={icono} className="h-5 w-5 shrink-0 text-white" />
    </div>
  )
}

export function DashboardHome() {
  const { profile } = useAuth()
  const { sucursales, departamentos, modulos, sucursalModulos } = useCatalog()

  const scope = useMemo(() => {
    if (!profile) return null
    if (profile.rol === 'GERENTE_S' && profile.sucursal_id) return [profile.sucursal_id]
    if (verTodo(profile.rol)) return null
    return null
  }, [profile])

  const [desde, setDesde] = useState(haceMeses(6))
  const [hasta, setHasta] = useState('')
  const [sucursalSel, setSucursalSel] = useState('')
  const [moduloSel, setModuloSel] = useState('')
  const [lineaActiva, setLineaActiva] = useState<string | null>(null)
  const [datos, setDatos] = useState<ConjuntoDatos | null>(null)
  const [cargando, setCargando] = useState(true)

  const sucursalesVisibles = scope ? sucursales.filter((s) => scope.includes(s.id)) : sucursales
  // GERENTE_S (con `scope`) solo ve su sucursal: sin departamentos, como en Historial.
  // Se memoiza: el `[]` nuevo en cada render re-dispararía los useMemo que lo usan.
  const departamentosVisibles = useMemo(() => (scope ? [] : departamentos), [scope, departamentos])

  useEffect(() => {
    let activo = true
    setCargando(true)
    void (async () => {
      try {
        const d = await consultarEvaluaciones({
          sucursal_ids: sucursalSel ? [sucursalSel] : scope,
          desde: desde || undefined,
          hasta: hasta || undefined,
          modulo_id: moduloSel || undefined,
          // Los KPIs y los promedios dicen «completadas»: una evaluación que
          // sigue abierta no cuenta como tal. Las de departamento también
          // cuentan, porque este dashboard las lista por su propio promedio.
          soloCerradas: true
        })
        if (activo) setDatos(d)
      } catch {
        if (activo) setDatos({ evaluaciones: [], respuestas: [], items: [], modulos: [], fotos: [], sucursalOpciones: [], instancias: [] })
      } finally {
        if (activo) setCargando(false)
      }
    })()
    return () => { activo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desde, hasta, sucursalSel, moduloSel, scope?.join(',')])

  const sucursalesRanking = useMemo(
    () => (datos ? rankingSucursales(datos, sucursalesVisibles) : []),
    [datos, sucursalesVisibles]
  )
  const departamentosRanking = useMemo(
    () => (datos ? rankingDepartamentos(datos, departamentosVisibles) : []),
    [datos, departamentosVisibles]
  )
  const cargosRanking = useMemo(() => (datos ? rankingResponsables(datos, 20) : []), [datos])
  const matrizModulos = useMemo(
    () => (datos ? puntajePorSucursalModulo(datos, sucursalesVisibles) : null),
    [datos, sucursalesVisibles]
  )
  const modulosOrden = useMemo(() => {
    const base = datos?.modulos.map((m) => ({ modulo_id: m.id, nombre: m.nombre })) ?? []
    if (!lineaActiva) return base
    // El módulo "hovered" se dibuja al final para quedar encima de los demás (z-index dinámico).
    return [...base].sort((a, b) => (a.nombre === lineaActiva ? 1 : 0) - (b.nombre === lineaActiva ? 1 : 0))
  }, [datos, lineaActiva])

  // Drilldown (modal): alcance clickeado y sus evaluaciones filtradas.
  const [drill, setDrill] = useState<{ titulo: string; subtitulo?: string; alcance: AlcanceDrilldown; etiquetaScope?: string } | null>(null)
  const drillFilas = useMemo(
    () => (datos && drill ? renglonesDrilldown(datos, drill.alcance) : []),
    [datos, drill]
  )
  const idPorNombreSucursal = useMemo(() => {
    const m = new Map<string, string>()
    for (const s of sucursalesVisibles) m.set(s.nombre, s.id)
    return m
  }, [sucursalesVisibles])
  const idPorNombreDepartamento = useMemo(() => {
    const m = new Map<string, string>()
    for (const d of departamentosVisibles) m.set(d.nombre, d.id)
    return m
  }, [departamentosVisibles])

  const abrirDrill = (p: { titulo: string; subtitulo?: string; alcance: AlcanceDrilldown; etiquetaScope?: string }) => setDrill(p)

  /** Nombre de la fila clickeada en el gráfico de ponderación (payload de recharts). */
  const nombreClickeado = (data: unknown): string | null => {
    const d = data as { payload?: Record<string, unknown>; unidad?: unknown } | null | undefined
    const nombre = d?.payload?.unidad ?? d?.unidad
    return typeof nombre === 'string' ? nombre : null
  }

  const abrirDrillSucursal = (data: unknown) => {
    const nombre = nombreClickeado(data)
    if (!nombre) return
    const id = idPorNombreSucursal.get(nombre)
    if (id) abrirDrill({ titulo: nombre, subtitulo: 'Evaluaciones de esta sucursal en el rango seleccionado', alcance: { sucursal_id: id } })
  }

  const detalleDe = (id: string) => {
    const r = drillFilas.find((x) => x.id === id)
    return (
      <div className="space-y-3">
        {r ? (
          <DetalleEvalCabecera
            fecha={r.fecha}
            sucursal={r.sucursal}
            estado={r.estado}
            puntaje={r.puntaje}
            puntajeScope={r.puntajeScope}
            etiquetaScope={drill?.etiquetaScope}
            muestras={r.muestras}
          />
        ) : null}
        <DetalleRespuestasLista filas={datos ? detalleDeEvaluacion(datos, id, drill?.alcance ?? {}) : []} />
      </div>
    )
  }

  const incumplimientos = useMemo(() => (datos ? incumplimientosEnRango(datos) : 0), [datos])

  const kpis = useMemo(() => {
    if (!datos) return { global: null as number | null, completadas: 0, cobertura: 0, incumplimientos: 0 }
    const conPuntaje = datos.evaluaciones.filter((e) => e.puntuacion != null)
    const global = conPuntaje.length
      ? Math.round((conPuntaje.reduce((a, e) => a + (e.puntuacion ?? 0), 0) / conPuntaje.length) * 100) / 100
      : null
    const totalSuc = sucursalesVisibles.length || 1
    // Cobertura = cuántas sucursales del alcance tienen evaluación en el rango.
    // Las de departamento no son de ninguna sucursal: meter su `null` en el set
    // sumaría una "tienda" que no existe y subiría el porcentaje de mentira.
    const cubiertas = new Set(
      datos.evaluaciones.map((e) => e.sucursal_id).filter((s): s is string => !!s)
    ).size
    return {
      global,
      completadas: datos.evaluaciones.length,
      cobertura: Math.round((cubiertas / totalSuc) * 100),
      incumplimientos
    }
  }, [datos, incumplimientos, sucursalesVisibles.length])

  // Publica los KPIs a la barra global (ancho completo, debajo de la barra de navegación).
  useEffect(() => {
    setKpisGlobal(kpis)
  }, [kpis])

  // Un reloj por módulo activo: promedio de la última evaluación de cada
  // UNIDAD —sucursal o departamento— que midió ese módulo.
  const medidores = useMemo(() => {
    if (!datos) return []
    const listaModulos = modulos.filter((m) => m.activo && (!moduloSel || m.id === moduloSel))
    return medidoresPorModulo(datos, listaModulos, sucursalesVisibles, sucursalModulos, departamentosVisibles)
  }, [datos, modulos, moduloSel, sucursalesVisibles, sucursalModulos, departamentosVisibles])

  // Icono de cada módulo desde el catálogo: como la tarjeta ya no pinta el
  // nombre, el icono es lo único que dice de qué módulo se trata.
  const iconoPorModulo = useMemo(() => {
    const m = new Map<string, string | undefined>()
    for (const x of modulos) m.set(x.id, x.icono)
    return m
  }, [modulos])

  // El filtro por sucursal no aplica a departamentos: con la sucursal elegida
  // la lista quedaría vacía. Además define si la fila de abajo son tres
  // columnas o dos (si no, quedaba un hueco vacío al final de la grilla).
  const verDepartamentos = !sucursalSel && departamentosVisibles.length > 0

  // El rótulo debajo del reloj vive en `subtituloMedidor`, compartido con el
  // dashboard del módulo: eran dos textos distintos para la misma pieza.
  // "ver detalle" va acá y no adentro, porque es propio de esta pantalla.
  return (
    <div className="space-y-6">
      <DashboardFiltersPortal>
        <FiltrosBar
          desde={desde}
          setDesde={setDesde}
          hasta={hasta}
          setHasta={setHasta}
          sucursal={sucursalSel}
          setSucursal={setSucursalSel}
          modulo={moduloSel}
          setModulo={setModuloSel}
          sucursales={sucursalesVisibles}
          modulos={modulos}
          soloSucursal={!!scope}
        />
      </DashboardFiltersPortal>

      {cargando ? (
        <div className="space-y-6">
          <Card className={CLASE_CONTENEDOR_DASHBOARD}>
            <div className="mb-4 space-y-2">
              <Skeleton className="h-5 w-52" />
              <Skeleton className="h-3 w-72" />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex h-20 overflow-hidden rounded-xl border border-slate-200">
                  <Skeleton className="w-16 rounded-none sm:w-20" />
                  <Skeleton className="flex-1 rounded-none" />
                  <Skeleton className="w-16 rounded-none sm:w-20" />
                </div>
              ))}
            </div>
          </Card>
          <Card className={CLASE_CONTENEDOR_DASHBOARD}>
            <div className="mb-4 space-y-2">
              <Skeleton className="h-5 w-64" />
              <Skeleton className="h-3 w-80" />
            </div>
            <Skeleton className="h-80 w-full" />
          </Card>
        </div>
      ) : datos ? (
        // Dos filas: arriba los módulos con el gráfico de ponderación, abajo
        // las tres listas. Las columnas se reparten todo el ancho de la
        // ventana y cada lista scrollea dentro, para que la pantalla entre
        // completa y el scroll —si hace falta— sea de la lista y no de la página.
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            {/* 1. Cumplimiento por módulo: una tarjeta por módulo, sólo con el
                porcentaje y su icono; el detalle se lee en el tooltip. */}
            <Card className={cn('border-0!', CLASE_CONTENEDOR_DASHBOARD)}>
              <h3 className="mb-1 font-bold text-primary-900">Cumplimiento por módulo</h3>
              <p className="mb-3 text-xs text-slate-400">Promedio de la última evaluación de cada sucursal con el módulo activo y de cada departamento que lo midió, en el rango seleccionado · el nombre y la cobertura de cada módulo aparecen al pasar el cursor; el clic abre su dashboard</p>
              {medidores.length ? (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:max-h-[max(13rem,calc(100vh_-_46rem))] xl:overflow-y-auto">
                  {medidores.map((m) => {
                    // El detalle que ya no se pinta en la tarjeta vive en el
                    // tooltip del enlace, que a la vez es su nombre accesible.
                    const detalle = `${m.nombre} · ${subtituloMedidor(m)} · ver detalle`
                    return (
                      <Link
                        key={m.modulo_id}
                        to={`/dashboard/modulo/${m.modulo_id}`}
                        title={detalle}
                        aria-label={detalle}
                        className="rounded-xl transition-all hover:-translate-y-0.5 hover:bg-primary-50/60 hover:shadow-md hover:ring-2 hover:ring-primary/30"
                      >
                        <TarjetaModulo promedio={m.promedio} icono={iconoPorModulo.get(m.modulo_id)} />
                      </Link>
                    )
                  })}
                </div>
              ) : (
                <p className="text-sm text-slate-400">Sin módulos activos.</p>
              )}
            </Card>

            {/* 2. Ponderación por sucursal y módulo: ocupa las dos columnas que
                le quedan a la fila, porque su eje X necesita ancho. */}
            <GraficoPonderacion
              className="xl:col-span-2"
              titulo="Ponderación por sucursal y módulo"
              descripcion="Curvas por módulo con la barra translúcida del promedio por sucursal; pasa el cursor por la leyenda para elevar una curva y haz clic en una barra o punto para ver las evaluaciones de esa sucursal"
              filas={matrizModulos?.sucursales ?? []}
              modulos={modulosOrden}
              nombrePromedio="Promedio por sucursal"
              lineaActiva={lineaActiva}
              setLineaActiva={setLineaActiva}
              onClic={abrirDrillSucursal}
              sinDatos="Sin datos de módulos para mostrar en el rango."
            />
          </div>

          {/* Fila de tortas: con departamento son tres columnas; sin él (filtro
              por sucursal) se reparten en dos y no queda un hueco al final. */}
          <div className={cn('grid grid-cols-1 gap-4 md:grid-cols-2', verDepartamentos ? 'xl:grid-cols-3' : 'xl:grid-cols-2')}>
            {/* 3. Promedio por sucursal. */}
            <GraficoTorta
              titulo="Promedio por sucursal"
              descripcion="Puntaje de cumplimiento promedio de cada sucursal en el rango, de mayor a menor · el tamaño de la porción es su participación en el total; el cursor muestra el puntaje y las evaluaciones, y el clic abre las de esa sucursal"
              filas={sucursalesRanking.map((s) => ({ nombre: s.nombre, puntaje: s.puntaje, completadas: s.completadas }))}
              etiqueta="sucursales"
              sinDatos="Sin sucursales en el rango."
              onClic={(fila) => {
                const id = idPorNombreSucursal.get(fila.nombre)
                if (id) abrirDrill({ titulo: fila.nombre, subtitulo: 'Evaluaciones de esta sucursal en el rango seleccionado', alcance: { sucursal_id: id } })
              }}
            />

            {/* 4. Promedio por departamento. El filtro por sucursal no aplica a
                departamentos: con la sucursal elegida quedaría vacía. */}
            {verDepartamentos ? (
              <GraficoTorta
                titulo="Promedio por departamento"
                descripcion="Puntaje de cumplimiento promedio de cada departamento en el rango, de mayor a menor · el tamaño de la porción es su participación en el total; el cursor muestra el puntaje y las evaluaciones, y el clic abre las de ese departamento"
                filas={departamentosRanking.map((d) => ({ nombre: d.nombre, puntaje: d.puntaje, completadas: d.completadas }))}
                etiqueta="departamentos"
                sinDatos="Sin departamentos evaluados en el rango."
                onClic={(fila) => {
                  const id = idPorNombreDepartamento.get(fila.nombre)
                  if (id) abrirDrill({ titulo: fila.nombre, subtitulo: 'Evaluaciones de este departamento en el rango seleccionado', alcance: { departamento_id: id } })
                }}
              />
            ) : null}

            {/* 5. Los 20 cargos con peor porcentaje de resultado en el rango:
                la nota manda, no la cantidad de fallas. Se queda informativa:
                el drilldown no tiene alcance por cargo. */}
            <GraficoTorta
              icono={
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-amber-50 text-amber-600">
                  <AlertTriangle className="h-5 w-5" />
                </span>
              }
              titulo="20 cargos con menor porcentaje de resultado"
              descripcion="Top 20 por su porcentaje de resultado en el rango (lo logrado sobre lo que se le pudo medir, con el mismo reparto que la página de seguimiento por cargo) · el cursor muestra cuántas evaluaciones lo respaldan"
              filas={cargosRanking.map((c) => ({ clave: c.clave, nombre: c.cargo, puntaje: c.nota, completadas: c.evaluaciones }))}
              etiqueta="cargos"
              sinDatos="Sin cargos con evaluaciones en el rango."
            />
          </div>
        </div>
      ) : null}

      <ModalDrilldown
        open={drill != null}
        onCerrar={() => setDrill(null)}
        titulo={drill?.titulo ?? 'Detalle'}
        subtitulo={drill?.subtitulo}
        filas={drillFilas}
        renderDetalle={detalleDe}
        urlDe={(id) => `/evaluaciones/${id}`}
      />
    </div>
  )
}

function FiltrosBar(props: {
  desde: string
  setDesde: (v: string) => void
  hasta: string
  setHasta: (v: string) => void
  sucursal: string
  setSucursal: (v: string) => void
  modulo: string
  setModulo: (v: string) => void
  sucursales: { id: string; nombre: string }[]
  modulos: { id: string; nombre: string }[]
  soloSucursal: boolean
}) {
  return (
    <div className={cn('grid gap-3 rounded-2xl border border-slate-200 p-4 sm:grid-cols-2 lg:grid-cols-4', CLASE_CONTENEDOR_DASHBOARD)}>
      <Field label="Desde">
        <Input type="date" value={props.desde} onChange={(e) => props.setDesde(e.target.value)} />
      </Field>
      <Field label="Hasta">
        <Input type="date" value={props.hasta} onChange={(e) => props.setHasta(e.target.value)} />
      </Field>
      <Field label="Sucursal">
        <Select value={props.sucursal} onChange={(e) => props.setSucursal(e.target.value)} disabled={props.soloSucursal}>
          <option value="">Todas</option>
          {props.sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </Select>
      </Field>
      <Field label="Módulo">
        <Select value={props.modulo} onChange={(e) => props.setModulo(e.target.value)}>
          <option value="">Todos</option>
          {props.modulos.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
        </Select>
      </Field>
    </div>
  )
}