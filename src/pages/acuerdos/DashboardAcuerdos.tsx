import { useMemo } from 'react'
import { EmptyState } from '../../components/ui'
import { COLORES_PROVEEDOR, nombreMes, porcentaje, usd, vigente } from '../../lib/acuerdos'
import type {
  AcuerdoConRelacion,
  CobroConAcuerdo,
  Espacio,
  SucursalAcuerdo,
  TipoEspacio
} from '../../lib/data/acuerdos'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'
import { MedidorMes, type AnilloMedidor } from './MedidorMes'

/**
 * EL DASHBOARD DE ACUERDOS
 * ------------------------
 * Cuatro lecturas:
 *
 *  1. FILA DE INDICADORES: cifras de hoy (piso rentado, rentas vigentes,
 *     por cobrar y ya recaudado).
 *  2. POR SUCURSAL (barras verticales) y POR TIPO DE ESPACIO (torta):
 *     estado ACTUAL del piso.
 *  3. NEGOCIADO vs RECAUDADO DEL MES: lo que se firmó y lo que entró en el
 *     mes elegido en el filtro de la barra superior.
 *  4. FACTURA vs NOTA DE CRÉDITO: cómo se pagan esas negociaciones del mes.
 *
 * El FILTO de mes (`mes`) afecta sólo a las lecturas 3 y 4 — las 1 y 2 son
 * instantáneas de hoy, y por eso lo dicen en su subtítulo. Los acuerdos se
 * cargan con `created_at` (cuando se firmaron) y los cobros con `fecha`,
 * que es lo que da «del mes».
 */
export function DashboardAcuerdos({
  sucursales,
  espacios,
  acuerdos,
  cobros,
  tipos,
  mes
}: {
  sucursales: SucursalAcuerdo[]
  espacios: Espacio[]
  acuerdos: AcuerdoConRelacion[]
  cobros: CobroConAcuerdo[]
  tipos: TipoEspacio[]
  /** Mes elegido en el filtro, como `YYYY-MM`. */
  mes: string
}) {
  const vigentes = useMemo(() => acuerdos.filter((a) => vigente(a)), [acuerdos])

  /** Lo NEGOCIADO en el mes: acuerdos cargados ese mes (`created_at`). */
  const negociosMes = useMemo(
    () => acuerdos.filter((a) => (a.created_at ?? '').slice(0, 7) === mes),
    [acuerdos, mes]
  )

  /** Lo RECAUDADO en el mes: cobros con `fecha` en el mes. */
  const cobrosMes = useMemo(() => cobros.filter((c) => (c.fecha ?? '').slice(0, 7) === mes), [cobros, mes])

  /** Por sucursal: espacios totales, rentados y disponibles HOY. */
  const porSucursal = useMemo(
    () =>
      sucursales.map((s) => {
        const deLaSucursal = espacios.filter((e) => e.sucursal_id === s.id)
        const rentados = deLaSucursal.filter((e) => vigentes.some((a) => a.espacio_id === e.id)).length
        return {
          sucursal: s.nombre,
          total: deLaSucursal.length,
          rentados,
          disponibles: deLaSucursal.length - rentados,
          pct: porcentaje(rentados, deLaSucursal.length)
        }
      }),
    [sucursales, espacios, vigentes]
  )

  /**
   * POR TIPO DE ESPACIO (la torta): cuántos de los espacios RENTADOS son
   * cada tipo — góndolas, cabezales, checkout… Es lo que dice a qué tipo
   * de superficie se está alquilando hoy.
   */
  const porTipo = useMemo(() => {
    const mapa = new Map<string, number>()
    for (const a of vigentes) {
      if (!a.espacio) continue
      const nombre = tipos.find((t) => t.id === a.espacio!.tipo_id)?.nombre ?? 'Espacio'
      mapa.set(nombre, (mapa.get(nombre) ?? 0) + 1)
    }
    const lista = [...mapa.entries()]
      .map(([nombre, cantidad]) => ({ nombre, cantidad }))
      .sort((a, b) => b.cantidad - a.cantidad)
    const total = lista.reduce((s, t) => s + t.cantidad, 0)
    return lista.map((t) => ({
      ...t,
      // La etiqueta lleva el %: es la que muestran la torta, su leyenda y
      // el tooltip, así no hay que calcularlo en tres lugares.
      etiqueta: `${t.nombre} · ${porcentaje(t.cantidad, total)}%`
    }))
  }, [vigentes, tipos])

  /**
   * DEL MES: lo negociado y lo recaudado. Los DOS en dólares, porque un
   * gráfico no puede comparar cantidades con plata — el conteo de
   * negociaciones y de cobros viaja en el subtítulo.
   */
  const comparativaMes = useMemo(() => {
    const negociado = negociosMes.reduce((s, a) => s + (Number(a.monto_usd) || 0), 0)
    const recaudado = cobrosMes.reduce((s, c) => s + (Number(c.monto) || 0), 0)
    return {
      negociado,
      recaudado,
      negocios: negociosMes.length,
      cobros: cobrosMes.length
    }
  }, [negociosMes, cobrosMes])

  /** Lo recaudado (todo, sin filtro) y lo que falta por cobrar (vigente). */
  const recaudado = cobros.reduce((s, c) => s + (Number(c.monto) || 0), 0)
  const porCobrar = vigentes.reduce((s, a) => s + (Number(a.monto_usd) || 0), 0)

  /**
   * LOS CUATRO ANILLOS del medidor. Cada uno con SU BASE, porque los   * porcentajes no son comparables entre sí:
   *
   *  · NEGOCIADO  → sobre el total de contratos vigentes (qué parte del
   *                 carrito activo se firmó este mes).
   *  · RECAUDADO  → sobre lo negociado en el mes. Si este mes se cobró
   *                 más de lo que se firmó (plata de contratos viejos)
   *                 da más de 100 %: el arco se techoa, el número no.
   *  · FACTURAS y NOTAS DE CRÉDITO → sobre lo negociado en el mes: son
   *                 las dos partes de cómo se paga, así que entre los dos
   *                 suman (casi) el 100 %.
   */
  const anillosMes = useMemo<AnilloMedidor[]>(() => {    const negociado = comparativaMes.negociado
    let facturas = 0
    let notas = 0
    for (const a of negociosMes) {
      const monto = Number(a.monto_usd) || 0
      if (/factura/i.test(a.tipo_pago ?? '')) facturas += monto
      else if (/nota/i.test(a.tipo_pago ?? '')) notas += monto
    }
    return [
      {
        id: 'negociado',
        etiqueta: 'Negociado',
        valor: negociado,
        base: porCobrar,
        baseTexto: 'del total de contratos vigentes',
        color: '#0b2545'
      },
      {
        id: 'recaudado',
        etiqueta: 'Recaudado',
        valor: comparativaMes.recaudado,
        base: negociado,
        baseTexto: 'de lo negociado en el mes',
        color: '#16a34a'
      },
      {
        id: 'facturas',
        etiqueta: 'Facturas',
        valor: facturas,
        base: negociado,
        baseTexto: 'del negociado en el mes',
        color: '#0369a1'
      },
      {
        id: 'notas',
        etiqueta: 'Notas de crédito',
        valor: notas,
        base: negociado,
        baseTexto: 'del negociado en el mes',
        color: '#7c3aed'
      }
    ]
  }, [comparativaMes, negociosMes, porCobrar])

  const rentadosTotal = porSucursal.reduce((s, f) => s + f.rentados, 0)
  const espaciosTotal = porSucursal.reduce((s, f) => s + f.total, 0)

  if (!espaciosTotal) {
    return (
      <EmptyState
        title="Sin espacios cargados"
        subtitle="Cargá el plano de una sucursal y sus espacios para ver el porcentaje rentado."
      />
    )
  }

  return (
    <section className="space-y-4">
      {/* FILA DE INDICADORES — cifras de HOY, no del mes del filtro. */}
      <div className="mb-1 flex items-center gap-2">
        <span className="rounded-full bg-slate-200 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-slate-600">
          Hoy
        </span>
        <span className="text-[11px] text-slate-500">
          El filtro de mes afecta sólo a los dos gráficos de abajo.
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <span className="block text-xs font-semibold text-slate-500">Piso rentado</span>
          <p className="mt-1 text-2xl font-extrabold text-primary-700">
            {porcentaje(rentadosTotal, espaciosTotal)}%
          </p>
          <p className="text-[11px] text-slate-500">
            {rentadosTotal} de {espaciosTotal} espacios
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <span className="block text-xs font-semibold text-slate-500">Rentas vigentes</span>
          <p className="mt-1 text-2xl font-extrabold text-slate-900">{vigentes.length}</p>
          <p className="text-[11px] text-slate-500">acuerdos con vigencia hoy</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <span className="block text-xs font-semibold text-slate-500">Por cobrar (vigente)</span>
          <p className="mt-1 text-2xl font-extrabold text-amber-600">{usd(porCobrar)}</p>
          <p className="text-[11px] text-slate-500">USD en contratos activos</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <span className="block text-xs font-semibold text-slate-500">Ya recaudado</span>
          <p className="mt-1 text-2xl font-extrabold text-emerald-600">{usd(recaudado)}</p>
          <p className="text-[11px] text-slate-500">USD con cobro registrado</p>
        </div>
      </div>

      {/* POR SUCURSAL (barras verticales) + POR TIPO DE ESPACIO (torta). */}
      <div className="grid gap-4 lg:grid-cols-12">
        <div className="lg:col-span-7 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-baseline justify-between">
            <h3 className="text-base font-bold text-slate-900">Rentado por sucursal</h3>
            <span className="text-xs text-slate-500">estado actual del piso</span>
          </div>
          {porSucursal.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">Sin sucursales cargadas.</p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              {/* Barras VERTICALES apiladas: abajo lo rentado (azul) y
                  arriba lo disponible (gris), así la altura total de la
                  barra es el piso de esa sucursal. */}
              <BarChart data={porSucursal} margin={{ top: 8, right: 8, left: -18, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis
                  dataKey="sucursal"
                  tick={{ fontSize: 10, fontWeight: 600, fill: '#475569' }}
                  axisLine={false}
                  tickLine={false}
                  interval={0}
                  angle={-24}
                  textAnchor="end"
                  height={72}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 10, fill: '#94a3b8' }}
                  axisLine={false}
                  tickLine={false}
                  width={44}
                />
                <Tooltip
                  cursor={{ fill: '#facc1522' }}
                  contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }}
                  formatter={(valor, nombre) => [`${valor} espacios`, nombre]}
                  labelFormatter={(sucursal) => {
                    const f = porSucursal.find((s) => s.sucursal === sucursal)
                    return f ? `${f.sucursal} · ${f.rentados}/${f.total} · ${f.pct}%` : String(sucursal)
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 4 }} />
                <Bar dataKey="rentados" name="Rentados" stackId="piso" fill="#0b2545" />
                <Bar
                  dataKey="disponibles"
                  name="Disponibles"
                  stackId="piso"
                  fill="#e2e8f0"
                  radius={[6, 6, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* POR TIPO DE ESPACIO: la torta de los rentados. */}
        <div className="lg:col-span-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-3 flex items-baseline justify-between">
            <h3 className="text-base font-bold text-slate-900">Rentado por tipo</h3>
            <span className="text-xs text-slate-500">hoy · {rentadosTotal} espacios</span>
          </div>
          {porTipo.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">Sin espacios rentados.</p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={porTipo}
                  dataKey="cantidad"
                  nameKey="etiqueta"
                  innerRadius={52}
                  outerRadius={88}
                  paddingAngle={2}
                  stroke="#ffffff"
                  strokeWidth={2}
                >
                  {porTipo.map((t, i) => (
                    <Cell key={t.nombre} fill={COLORES_PROVEEDOR[i % COLORES_PROVEEDOR.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }}
                  formatter={(valor, nombre) => [`${valor} ${valor === 1 ? 'espacio' : 'espacios'}`, nombre]}
                />
                <Legend wrapperStyle={{ fontSize: 11, paddingTop: 4 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* DEL MES: el MEDIDOR CURVO con los cuatro anillos — negociado,
          recaudado, facturas y notas de crédito. Reemplaza a los dos
          gráficos que había acá: los cuatro números ya viven en los
          anillos, con su % y su monto. */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-bold text-slate-900">Negociado, recaudado y cómo se paga</h3>
          <span className="rounded-full bg-primary-50 px-2.5 py-0.5 text-xs font-bold text-primary-800">
            {nombreMes(mes)}
          </span>
        </div>
        <p className="text-xs text-slate-500">
          Cada anillo es un porcentaje sobre su base — la leyenda de la derecha dice cuál es — y el
          monto en USD.{' '}
          <span className="font-semibold text-slate-700">
            {comparativaMes.negocios} {comparativaMes.negocios === 1 ? 'negociación' : 'negociaciones'}
          </span>{' '}
          ·{' '}
          <span className="font-semibold text-slate-700">
            {comparativaMes.cobros} {comparativaMes.cobros === 1 ? 'cobro' : 'cobros'}
          </span>
        </p>

        {comparativaMes.negociado === 0 && comparativaMes.recaudado === 0 ? (
          <p className="py-10 text-center text-sm text-slate-500">
            Sin movimientos en {nombreMes(mes)}.
          </p>
        ) : (
          <div className="mt-4">
            <MedidorMes etiqueta={nombreMes(mes)} anillos={anillosMes} />
          </div>
        )}
      </div>
    </section>
  )
}
