import { useEffect, useState } from 'react'
import { ArrowLeft, BarChart3 } from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'
import { avisar } from '../lib/aviso'
import { visitasMenu, type VisitaPorHora } from '../lib/data/menuSucursal'
import { Modal } from './ui'
import { PortalCabecera } from './PortalCabecera'

/** Fecha local en clave 'YYYY-MM-DD': el formato que espera la RPC. */
function isoDe(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Los ÚLTIMOS 7 DÍAS, de más viejo a hoy — el orden en que se lee una
 * curva de izquierda a derecha. Las dos primeras tienen nombre propio
 * («Hoy», «Ayer») y el resto, fecha corta.
 */
function ultimos7Dias(): { clave: string; etiqueta: string }[] {
  const hoy = new Date()
  const dias: { clave: string; etiqueta: string }[] = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - i)
    dias.push({
      clave: isoDe(d),
      etiqueta:
        i === 0
          ? 'Hoy'
          : i === 1
            ? 'Ayer'
            : d.toLocaleDateString('es-VE', { day: 'numeric', month: 'short' })
    })
  }
  return dias
}

/** El tooltip de los dos gráficos, en la misma voz de toda la pantalla. */
function TooltipVisitas({ active, payload, label }: { active?: boolean; payload?: { value?: number | string }[]; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-md">
      <p className="font-black text-[#0a1e5e]">{label}</p>
      <p className="mt-0.5 font-bold text-slate-600">
        {String(payload[0]?.value ?? 0)} {Number(payload[0]?.value) === 1 ? 'apertura' : 'aperturas'}
      </p>
    </div>
  )
}

/**
 * LAS VISITAS AL MENÚ
 * -------------------
 * El reporte de aperturas de la carta pública. Ya NO es una grilla de 24
 * celdas por día pegada abajo del editor: es un MODAL con
 *
 *   1. LA CURVA: una línea con un punto por día (los últimos 7, de más
 *      viejo a hoy) — lo que el encargado mira primero: si la carta se
 *      está abriendo o no.
 *   2. EL DETALLE POR HORA: al hacer clic en un día (en la curva o en su
 *      chip), las 24 horas de ESE día en barras —con las horas futuras de
 *      hoy atenuadas, que todavía no pasaron—.
 *
 * El BOTÓN que abre el modal se cuelga de la barra de la consola
 * (`PortalCabecera`), junto al selector de sucursal y a «Ver menú público»
 * —el cuerpo de la pantalla queda sólo para el menú—.
 *
 * Lee con sesión por `visitasMenu` (la RPC `ver_visitas_menu`), que sólo
 * devuelve lo del encargado de esa sucursal o del Líder; sólo LEE, así que
 * no hay nada que guardar. La carga es perezosa: el RPC corre al abrir el
 * modal, no al cargar la pantalla.
 */
export function VisitasMenu({ sucursalId }: { sucursalId: string }) {
  const [abierto, setAbierto] = useState(false)
  /** `null` = todavía no se pidió (o se cambió de sucursal). */
  const [visitas, setVisitas] = useState<VisitaPorHora[] | null>(null)
  /** El día elegido para ver sus horas, o `null` para ver la curva. */
  const [dia, setDia] = useState<string | null>(null)

  // Al cambiar de sucursal se cae lo de la anterior: ni la curva ni el día
  // elegido pueden quedar mezclados entre tiendas.
  useEffect(() => {
    setVisitas(null)
    setDia(null)
  }, [sucursalId])

  // El pedido, al ABRIR el modal y una sola vez por sucursal: la pantalla
  // no gasta la llamada si el encargado nunca abre el reporte.
  useEffect(() => {
    if (!abierto || !sucursalId || visitas !== null) return
    let vivo = true
    const hoy = new Date()
    const desde = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - 6)
    visitasMenu(sucursalId, isoDe(desde), isoDe(hoy))
      .then((v) => {
        if (vivo) setVisitas(v)
      })
      .catch((e) => {
        if (!vivo) return
        setVisitas([])
        avisar(e instanceof Error ? e.message : 'No se pudieron cargar las visitas.', 'error')
      })
    return () => {
      vivo = false
    }
  }, [abierto, sucursalId, visitas])

  const dias = ultimos7Dias()
  /** Una fila por día con su total: lo que grafica la curva. */
  const curva = dias.map((d) => ({
    ...d,
    total: (visitas ?? [])
      .filter((v) => v.fecha === d.clave)
      .reduce((s, v) => s + v.visitas, 0)
  }))
  /** `fecha-hora` → aperturas, para no recorrer la lista 24 veces. */
  const porMomento = new Map((visitas ?? []).map((v) => [`${v.fecha}-${v.hora}`, v.visitas]))

  const infoDia = dias.find((d) => d.clave === dia) ?? null
  const esHoy = dia === isoDe(new Date())
  const horaAhora = new Date().getHours()
  const horas = Array.from({ length: 24 }, (_, h) => ({
    hora: String(h).padStart(2, '0'),
    visitas: porMomento.get(`${dia}-${h}`) ?? 0,
    // Las horas de HOY que todavía no pasaron no se grafican igual: no
    // son cero, son "todavía no" — el mismo criterio que la grilla vieja.
    futuro: esHoy && h > horaAhora
  }))
  const totalDia = horas.reduce((s, x) => s + x.visitas, 0)
  const total7 = curva.reduce((s, d) => s + d.total, 0)

  // El clic en la curva abre el día del punto más cercano. Los CHIPS de
  // abajo hacen lo mismo y son los que además sirven con teclado. El
  // primer parámetro viene tipado de recharts y sólo se lo lee a mano.
  const alClicCurva = (datos: unknown) => {
    const punto = (datos as { activePayload?: { payload?: { clave?: string } }[] } | null)
      ?.activePayload?.[0]?.payload
    if (punto?.clave) setDia(punto.clave)
  }

  return (
    <>
      {/* El botón vive en la BARRA de la consola (PortalCabecera), con el
          mismo estilo que «Ver menú público»: sólo icono en el teléfono,
          donde la barra ya va llena. El cuerpo de la pantalla queda sólo
          para el menú. */}
      <PortalCabecera>
        <button
          type="button"
          onClick={() => setAbierto(true)}
          title="Ver las aperturas de la carta: la curva de los 7 días y el detalle por hora"
          className="inline-flex min-h-[34px] items-center gap-1.5 rounded-full border border-primary-200 bg-primary-50 px-3 py-1.5 text-xs font-semibold text-primary-700 transition-colors hover:bg-primary-100"
        >
          <BarChart3 className="h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline">Ver visitas</span>
        </button>
      </PortalCabecera>

      <Modal
        open={abierto}
        onClose={() => {
          setAbierto(false)
          setDia(null)
        }}
        title={infoDia ? `Visitas · ${infoDia.etiqueta}` : 'Visitas al menú'}
        wide
      >
        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
          {infoDia
            ? 'Detalle por hora'
            : `Últimos 7 días · hora de Venezuela · ${total7} ${
                total7 === 1 ? 'apertura' : 'aperturas'
              }`}
        </p>

        {visitas === null ? (
          <p className="mt-6 text-sm text-slate-500">Cargando visitas…</p>
        ) : infoDia ? (
          <div className="mt-4">
            <button
              type="button"
              onClick={() => setDia(null)}
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 transition-colors hover:bg-slate-50"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              Volver a la curva
            </button>

            <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-xs font-black uppercase tracking-wider text-[#0a1e5e]">
                {infoDia.etiqueta}
              </span>
              <span
                className={
                  totalDia > 0
                    ? 'rounded-full bg-[#facc15] px-2.5 py-0.5 text-[11px] font-black text-[#0a1e5e]'
                    : 'text-[11px] font-bold text-slate-400'
                }
              >
                {totalDia} {totalDia === 1 ? 'apertura' : 'aperturas'}
              </span>
            </div>

            <div className="mt-3">
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={horas} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis
                    dataKey="hora"
                    interval={1}
                    tick={{ fontSize: 9, fill: '#94a3b8' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 10, fill: '#94a3b8' }}
                    axisLine={false}
                    tickLine={false}
                    width={34}
                  />
                  <Tooltip
                    cursor={{ fill: '#facc15', fillOpacity: 0.15 }}
                    labelFormatter={(l) => `${l}:00`}
                    content={<TooltipVisitas />}
                  />
                  <Bar dataKey="visitas" name="Aperturas" radius={[4, 4, 0, 0]}>
                    {horas.map((x, i) => (
                      <Cell key={i} fill={x.futuro ? '#e2e8f0' : '#facc15'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {totalDia === 0 ? (
              <p className="mt-2 text-center text-xs text-slate-400">
                Ese día nadie abrió la carta.
              </p>
            ) : null}
          </div>
        ) : (
          <div className="mt-3">
            <ResponsiveContainer width="100%" height={240}>
              <LineChart
                data={curva}
                onClick={alClicCurva}
                margin={{ top: 8, right: 12, left: -22, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis
                  dataKey="etiqueta"
                  tick={{ fontSize: 11, fontWeight: 700, fill: '#475569' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 10, fill: '#94a3b8' }}
                  axisLine={false}
                  tickLine={false}
                  width={34}
                />
                <Tooltip
                  cursor={{ stroke: '#facc15', strokeWidth: 2 }}
                  content={<TooltipVisitas />}
                />
                <Line
                  type="monotone"
                  dataKey="total"
                  name="Aperturas"
                  stroke="#0a1e5e"
                  strokeWidth={3}
                  dot={{ r: 5, fill: '#facc15', stroke: '#0a1e5e', strokeWidth: 2 }}
                  activeDot={{ r: 7 }}
                />
              </LineChart>
            </ResponsiveContainer>

            {/* Los días como navegación: el mismo dato que la curva, en
                botones — con teclado se llega igual que con el clic en la
                curva. */}
            <div className="mt-4 flex flex-wrap gap-2">
              {curva.map((d) => (
                <button
                  key={d.clave}
                  type="button"
                  onClick={() => setDia(d.clave)}
                  title={`Ver las horas del ${d.etiqueta}`}
                  className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-left transition-colors hover:border-[#facc15] hover:bg-white"
                >
                  <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                    {d.etiqueta}
                  </span>
                  <span className="text-sm font-black tabular-nums text-[#0a1e5e]">{d.total}</span>
                </button>
              ))}
            </div>

            <p className="mt-3 text-[11px] text-slate-400">
              Tocá un día —o un punto de la curva— para ver sus 24 horas.
            </p>
          </div>
        )}
      </Modal>
    </>
  )
}
