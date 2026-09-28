import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Layers } from 'lucide-react'
import { DashboardFiltersPortal } from '../../context/DashboardFiltersContext'
import { useAuth } from '../../context/AuthContext'
import { useCatalog } from '../../context/CatalogContext'
import {
  consultarEvaluaciones,
  detalleDeEvaluacion,
  medidoresPorModulo,
  sucursalesConModuloEvaluado,
  resumenItemsModulo,
  barrasModulo,
  renglonesDrilldown,
  type AlcanceDrilldown,
  type BarraModulo,
  type ConjuntoDatos,
  type ResumenItemModulo
} from '../../lib/data/indicadores'
import { Card, EmptyState, Field, Input, Select, Skeleton } from '../../components/ui'
import { GraficoItem } from '../../components/dashboard/GraficoItem'
import { MedidorModulo } from '../../components/dashboard/MedidorModulo'
import { ModalDrilldown, DetalleEvalCabecera, DetalleRespuestasLista } from '../../components/dashboard/ModalDrilldown'
import { etiquetaTipo, pesoItem } from '../../lib/scoring'
import { setKpisGlobal, type EstadoKpis } from '../../lib/kpisGlobal'
import { cn } from '../../components/ui'
import { BarChart, Bar, Cell, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, ReferenceLine, LabelList } from 'recharts'
import { num, pct as pctComa } from '../../lib/numeros'
import type { Item } from '../../lib/types'

function haceMeses(n: number): string {
  const d = new Date()
  d.setMonth(d.getMonth() - n)
  return d.toISOString().slice(0, 10)
}

const ETIQUETA = 'text-[10px] font-bold uppercase tracking-wider text-slate-500'

const COLOR_TIPO: Record<string, string> = {
  CUMPLE_NO_CUMPLE: 'bg-emerald-50 text-emerald-700',
  CHECKLIST: 'bg-sky-50 text-sky-700',
  CONCILIACION: 'bg-violet-50 text-violet-700',
  LISTA_COLABORADORES: 'bg-amber-50 text-amber-700',
  UNIDAD_CHECKLIST: 'bg-fuchsia-50 text-fuchsia-700',
  CONTENEDOR: 'bg-slate-100 text-slate-600'
}

/** Color de la barra según el umbral oficial (verde ≥80, ámbar 60-79, rojo <60). */
function colorDePuntaje(p: number | null): string {
  if (p == null) return '#cbd5e1'
  return p >= 80 ? '#16a34a' : p >= 60 ? '#d97706' : '#dc2626'
}

const COLORES_BARRA = ['#16a34a', '#d97706', '#dc2626', '#cbd5e1']

export function ModuloDashboard() {
  const { moduloId = '' } = useParams()
  const { profile } = useAuth()
  const { sucursales, modulos, items, sucursalModulos } = useCatalog()

  const scope = useMemo(() => {
    if (!profile) return null
    if (profile.rol === 'GERENTE_S' && profile.sucursal_id) return [profile.sucursal_id]
    return null
  }, [profile])

  const modulo = modulos.find((m) => m.id === moduloId) ?? null
  const moduloNombre = modulo?.nombre ?? 'Módulo'

  const [desde, setDesde] = useState(haceMeses(6))
  const [hasta, setHasta] = useState('')
  const [sucursalSel, setSucursalSel] = useState('')
  const [datos, setDatos] = useState<ConjuntoDatos | null>(null)
  const [cargando, setCargando] = useState(true)

  const sucursalesVisibles = scope ? sucursales.filter((s) => scope.includes(s.id)) : sucursales

  useEffect(() => {
    let activo = true
    setCargando(true)
    void (async () => {
      try {
        const d = await consultarEvaluaciones({
          sucursal_ids: sucursalSel ? [sucursalSel] : scope,
          desde: desde || undefined,
          hasta: hasta || undefined,
          modulo_id: moduloId || undefined
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
  }, [desde, hasta, sucursalSel, scope?.join(','), moduloId])

  const catalogoItems = useMemo(
    () => items.filter((i) => i.modulo_id === moduloId && i.activo),
    [items, moduloId]
  )

  const resumen = useMemo(
    () => (datos ? resumenItemsModulo(datos, moduloId, catalogoItems) : []),
    [datos, moduloId, catalogoItems]
  )

  const resumenDe = useMemo(() => {
    const m = new Map<string, ResumenItemModulo>()
    for (const r of resumen) m.set(r.item.id, r)
    return m
  }, [resumen])

  const contenedores = useMemo(() => catalogoItems.filter((i) => i.tipo === 'CONTENEDOR'), [catalogoItems])
  const contenedorIds = useMemo(() => new Set(contenedores.map((c) => c.id)), [contenedores])

  const sueltos = useMemo(
    () =>
      catalogoItems
        .filter((i) => i.tipo !== 'CONTENEDOR' && !(i.padre_id && contenedorIds.has(i.padre_id)))
        .sort((a, b) => a.orden - b.orden),
    [catalogoItems, contenedorIds]
  )

  const hijosDe = (padreId: string): Item[] =>
    catalogoItems.filter((i) => i.padre_id === padreId).sort((a, b) => a.orden - b.orden)

  const medidor = useMemo(() => {
    if (!datos || !modulo) return null
    return medidoresPorModulo(datos, [modulo], sucursalesVisibles, sucursalModulos)[0] ?? null
  }, [datos, modulo, sucursalesVisibles, sucursalModulos])

  // El módulo de vehículos se agrupa por placa (instancia) en lugar de por sucursal.
  const porPlaca = catalogoItems.some((i) => i.tipo === 'CONTENEDOR' && i.api_id === 'vehiculos')
  const barras = useMemo(
    () => (datos ? barrasModulo(datos, moduloId, sucursalesVisibles, porPlaca) : null),
    [datos, moduloId, sucursalesVisibles, porPlaca]
  )

  // Drilldown (modal): alcance clickeado y sus evaluaciones filtradas.
  const [drill, setDrill] = useState<{ titulo: string; subtitulo?: string; alcance: AlcanceDrilldown } | null>(null)
  const drillFilas = useMemo(
    () => (datos && drill ? renglonesDrilldown(datos, drill.alcance) : []),
    [datos, drill]
  )
  const detalleDe = (id: string) => {
    const r = drillFilas.find((x) => x.id === id)
    const etiquetaScope = drill?.alcance.item_id ? 'Nivel del ítem' : drill?.alcance.modulo_id ? 'Módulo' : undefined
    return (
      <div className="space-y-3">
        {r ? (
          <DetalleEvalCabecera
            fecha={r.fecha}
            sucursal={r.sucursal}
            estado={r.estado}
            puntaje={r.puntaje}
            puntajeScope={r.puntajeScope}
            etiquetaScope={etiquetaScope}
            muestras={r.muestras}
          />
        ) : null}
        <DetalleRespuestasLista filas={datos ? detalleDeEvaluacion(datos, id, drill?.alcance ?? {}) : []} />
      </div>
    )
  }

  const abrirBarra = (data: unknown) => {
    const d = data as { payload?: Record<string, unknown> } | null | undefined
    const clave = d?.payload?.clave
    const etiqueta = d?.payload?.etiqueta
    if (typeof clave !== 'string' || !barras) return
    const nombre = typeof etiqueta === 'string' ? etiqueta : clave
    if (barras.grupo === 'placa') {
      setDrill({
        titulo: nombre,
        subtitulo: 'Evaluaciones del rango con respuestas de esta placa',
        alcance: { modulo_id: moduloId, instancia_etiqueta: clave }
      })
    } else {
      setDrill({
        titulo: nombre,
        subtitulo: 'Evaluaciones de esta sucursal con respuestas del módulo, en el rango',
        alcance: { modulo_id: moduloId, sucursal_id: clave }
      })
    }
  }

  const totalMuestras = resumen.reduce((a, r) => a + r.muestras, 0)
  // Sucursales evaluadas: solo cuentan las que tienen el módulo habilitado y cuya
  // evaluación tiene respuestas de ítems del módulo (sin respuestas no cuenta).
  const sucursalesEval = datos ? sucursalesConModuloEvaluado(datos, moduloId, sucursalModulos) : 0

  // La franja azul (BarraKpis) muestra las tarjetas del módulo en lugar de los KPIs globales.
  const kpis = useMemo<EstadoKpis | null>(() => ({
    global: null,
    completadas: datos?.evaluaciones.length ?? 0,
    cobertura: 0,
    incumplimientos: 0,
    items: [
      { etiqueta: 'Evaluaciones en el rango', valor: datos ? datos.evaluaciones.length : null, icono: 'calendario' },
      { etiqueta: 'Sucursales evaluadas', valor: datos ? sucursalesEval : null, icono: 'store' },
      { etiqueta: 'Ítems del módulo', valor: catalogoItems.filter((i) => i.tipo !== 'CONTENEDOR').length, icono: 'lista' },
      { etiqueta: 'Respuestas puntuables', valor: datos ? totalMuestras : null, icono: 'badge' }
    ]
  }), [datos, sucursalesEval, catalogoItems, totalMuestras])

  useEffect(() => {
    setKpisGlobal(kpis)
    return () => setKpisGlobal(null)
  }, [kpis])

  return (
    <div className="space-y-6">
      <DashboardFiltersPortal>
        <FiltrosModulo
          desde={desde}
          setDesde={setDesde}
          hasta={hasta}
          setHasta={setHasta}
          sucursal={sucursalSel}
          setSucursal={setSucursalSel}
          sucursales={sucursalesVisibles}
          soloSucursal={!!scope}
        />
      </DashboardFiltersPortal>

      <Card className="border-0!">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <Link
              to="/dashboard"
              className="mb-2 inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:border-primary-300 hover:text-primary"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Volver a indicadores
            </Link>
            <p className={ETIQUETA}>Dashboard del módulo</p>
            <h1 className="mt-0.5 text-xl font-extrabold leading-tight text-primary-900">{moduloNombre}</h1>
            <p className="mt-1 max-w-xl text-sm text-slate-500">
              {modulo?.descripcion || 'Ítems del módulo con el gráfico más idóneo según su tipo de ítem.'}
            </p>
            <p className="mt-2 text-[11px] text-slate-400">
              Acota el período o la sucursal con «Filtros»; cada ítem muestra el gráfico que mejor le corresponde (donut,
              promedio por umbral, conciliación o colaboradores/unidades).
            </p>
          </div>
          <div className="shrink-0">
            {cargando ? (
              <Skeleton className="h-40 w-40 rounded-2xl" />
            ) : medidor ? (
              <div className="w-[150px]">
                <MedidorModulo
                  nombre={moduloNombre}
                  valor={medidor.promedio}
                  sub={
                    medidor.sucursales
                      ? `${medidor.sucursales} de ${medidor.sucursales + medidor.sinDatos} sucursales`
                      : medidor.sinDatos
                        ? `${medidor.sinDatos} sucursales sin evaluación`
                        : 'Sin sucursales en el rango'
                  }
                />
              </div>
            ) : (
              <div className="grid h-40 w-40 place-items-center rounded-2xl border border-slate-200 bg-slate-50 p-3 text-center">
                <div>
                  <p className="text-2xl font-black text-slate-300">—</p>
                  <p className="mt-0.5 text-[11px] text-slate-400">Sin evaluaciones en el rango</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </Card>

      <Card className="border-0!">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-bold text-primary-900">
              {barras?.grupo === 'placa' ? 'Promedio del módulo por placa' : 'Promedio del módulo por sucursal'}
            </h3>
            <p className="text-xs text-slate-400">
              {barras?.grupo === 'placa'
                ? 'Puntaje ponderado de cada vehículo (placa) con sus respuestas en el rango seleccionado'
                : 'Puntaje ponderado de cada sucursal con respuestas del módulo en el rango seleccionado'}
            </p>
          </div>
          <div className="flex items-center gap-3 text-[10px] font-semibold text-slate-500">
            <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-green-600" /> ≥80</span>
            <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-amber-600" /> 60–79</span>
            <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-red-600" /> &lt;60</span>
            <span className="inline-flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-full bg-slate-300" /> sin datos</span>
          </div>
        </div>
        {cargando ? (
          <Skeleton className="h-80 w-full" />
        ) : barras && barras.barras.length ? (
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={barras.barras.map((b) => ({ ...b, puntajeTexto: b.puntaje == null ? null : num(b.puntaje) }))} margin={{ top: 26, right: 16, bottom: 8, left: 8 }}>
              <defs>
                {COLORES_BARRA.map((c) => (
                  <linearGradient key={c} id={`grad-bar-${c.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={c} stopOpacity={0.95} />
                    <stop offset="100%" stopColor={c} stopOpacity={0.55} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="etiqueta" interval={0} angle={-38} textAnchor="end" height={90} tick={{ fontSize: 11, fill: '#475569' }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
              <ReferenceLine y={80} stroke="#16a34a" strokeDasharray="4 4" strokeOpacity={0.4} />
              <ReferenceLine y={60} stroke="#d97706" strokeDasharray="4 4" strokeOpacity={0.4} />
              <Tooltip
                formatter={(v) => [v == null ? '—' : pctComa(Number(v)), 'Puntaje']}
                labelFormatter={(etiqueta) => {
                  const b = (barras.barras as BarraModulo[]).find((x) => x.etiqueta === etiqueta)
                  return `${etiqueta}${b && b.muestras ? ` · ${b.muestras} ${b.muestras === 1 ? 'evaluación' : 'evaluaciones'}` : ''}`
                }}
                contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 13 }}
                cursor={{ fill: 'rgba(40,49,95,0.06)' }}
              />
              <Bar
                dataKey="puntaje"
                name="Puntaje"
                radius={[6, 6, 0, 0]}
                maxBarSize={64}
                background={{ fill: '#f1f5f9', radius: 6 }}
                onClick={abrirBarra}
                activeBar={{ fillOpacity: 0.7 }}
              >
                {barras.barras.map((b) => (
                  <Cell key={b.clave} fill={`url(#grad-bar-${colorDePuntaje(b.puntaje).replace('#', '')})`} />
                ))}
                <LabelList dataKey="puntajeTexto" position="top" fill="#334155" fontSize={11} fontWeight={700} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-sm text-slate-400">
            {barras?.grupo === 'placa'
              ? 'Sin vehículos (placas) evaluados en el rango seleccionado.'
              : 'Sin sucursales con datos del módulo en el rango seleccionado.'}
          </p>
        )}
      </Card>

      {cargando ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-48 rounded-xl" />)}
        </div>
      ) : catalogoItems.length ? (
        <>
          {sueltos.length ? (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {sueltos.map((item) => {
                const r = resumenDe.get(item.id)
                return r
                  ? <TarjetaItem
                      key={item.id}
                      resumen={r}
                      onClick={() => setDrill({ titulo: item.texto, subtitulo: 'Evaluaciones del rango donde este ítem fue respondido', alcance: { modulo_id: moduloId, item_id: item.id } })}
                    />
                  : <TarjetaItemSinDatos key={item.id} item={item} />
              })}
            </div>
          ) : null}

          {contenedores.map((c) => (
            <Seccion
              key={c.id}
              contenedor={c}
              resumenes={hijosDe(c.id).map((h) => resumenDe.get(h.id)).filter((x): x is ResumenItemModulo => !!x)}
              onAbrirItem={(item) => setDrill({ titulo: item.texto, subtitulo: 'Evaluaciones del rango donde este ítem fue respondido', alcance: { modulo_id: moduloId, item_id: item.id } })}
            />
          ))}
        </>
      ) : (
        <EmptyState
          title="Módulo sin ítems activos"
          subtitle="Este módulo no tiene ítems configurados, o fueron desactivados. Configúralo en la sección de ítems."
        />
      )}

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

function TarjetaItem({ resumen, onClick }: { resumen: ResumenItemModulo; onClick: () => void }) {
  const r = resumen
  return (
    <button
      type="button"
      onClick={onClick}
      title="Ver las evaluaciones donde este ítem fue respondido"
      className="flex flex-col rounded-xl border border-slate-200 bg-white p-4 text-left transition-all hover:-translate-y-0.5 hover:border-primary-300 hover:shadow-md"
    >
      <div className="mb-2 flex items-start justify-between gap-3">
        <p className="min-w-0 flex-1 text-sm font-semibold leading-snug text-slate-800">{r.item.texto}</p>
        <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide', COLOR_TIPO[r.item.tipo] ?? 'bg-slate-100 text-slate-600')}>
          {etiquetaTipo(r.item.tipo)}
        </span>
      </div>
      <div className="mb-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-400">
        <span>Peso {r.peso > 0 ? `${r.peso}%` : 'sin peso'}</span>
        <span>{r.respondidas} respuestas</span>
        {r.muestras ? <span>{r.muestras} puntuables</span> : null}
        <span className="font-semibold text-primary-600">Ver detalle →</span>
      </div>
      <div className="mt-auto">
        <GraficoItem resumen={r} />
      </div>
    </button>
  )
}

function TarjetaItemSinDatos({ item }: { item: Item }) {
  return (
    <div className="flex flex-col rounded-xl border border-dashed border-slate-300 bg-slate-50/50 p-4">
      <div className="mb-2 flex items-start justify-between gap-3">
        <p className="min-w-0 flex-1 text-sm font-semibold leading-snug text-slate-600">{item.texto}</p>
        <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide', COLOR_TIPO[item.tipo] ?? 'bg-slate-100 text-slate-600')}>
          {etiquetaTipo(item.tipo)}
        </span>
      </div>
      <p className="text-[11px] text-slate-400">
        Peso {pesoItem(item) > 0 ? `${pesoItem(item)}%` : 'sin peso'} · Sin respuestas en el rango
      </p>
    </div>
  )
}

function Seccion({ contenedor, resumenes, onAbrirItem }: {
  contenedor: Item
  resumenes: ResumenItemModulo[]
  onAbrirItem: (item: Item) => void
}) {
  return (
    <Card className="border-0!">
      <div className="mb-3 flex items-center gap-2.5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary-50 text-primary">
          <Layers className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-bold text-primary-900">{contenedor.texto}</p>
          <p className="text-[11px] text-slate-400">
            Sección (grupo) · Peso {pesoItem(contenedor) > 0 ? `${pesoItem(contenedor)}%` : 'sin peso'} · {resumenes.length} ítems
          </p>
        </div>
      </div>
      {resumenes.length ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {resumenes.map((r) => <TarjetaItem key={r.item.id} resumen={r} onClick={() => onAbrirItem(r.item)} />)}
        </div>
      ) : (
        <p className="text-sm text-slate-400">La sección no tiene ítems activos en este módulo.</p>
      )}
    </Card>
  )
}

function FiltrosModulo(props: {
  desde: string
  setDesde: (v: string) => void
  hasta: string
  setHasta: (v: string) => void
  sucursal: string
  setSucursal: (v: string) => void
  sucursales: { id: string; nombre: string }[]
  soloSucursal: boolean
}) {
  return (
    <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-3">
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
    </div>
  )
}