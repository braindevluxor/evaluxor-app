import { useMemo, useState } from 'react'
import { Badge, EmptyState, Select } from '../../components/ui'
import { colorDe, fechasDeCobro, porcentaje, usd, vigente } from '../../lib/acuerdos'
import type {
  AcuerdoConRelacion,
  CobroConAcuerdo,
  SucursalAcuerdo
} from '../../lib/data/acuerdos'

/**
 * EL HISTORIAL DE RENTAS
 * ----------------------
 * TODOS los acuerdos que existieron —vigentes, vencidos y dados de baja—
 * con su cumplimiento: cuántas de sus fechas de cobro quedaron registradas
 * y qué porcentaje lleva. Con filtros por sucursal, proveedor y estado para
 * revisar el funcionamiento de los acuerdos sin leer la lista entera.
 *
 * Es el reverso del calendario: ahí se mira el día, acá se mira el espacio
 * a lo largo del tiempo.
 */
export function HistorialAcuerdos({
  acuerdos,
  cobros,
  sucursales,
  tipoDe
}: {
  acuerdos: AcuerdoConRelacion[]
  cobros: CobroConAcuerdo[]
  sucursales: SucursalAcuerdo[]
  tipoDe: (id: string) => string
}) {
  const [sucursal, setSucursal] = useState('')
  const [proveedor, setProveedor] = useState('')
  const [estado, setEstado] = useState('Todos')

  const cobrosDe = useMemo(() => {
    const mapa = new Map<string, number>()
    for (const c of cobros) mapa.set(c.acuerdo_id, (mapa.get(c.acuerdo_id) ?? 0) + 1)
    return mapa
  }, [cobros])

  const proveedores = useMemo(() => {
    const mapa = new Map<string, string>()
    for (const a of acuerdos) if (a.proveedor) mapa.set(a.proveedor.id, a.proveedor.nombre)
    return [...mapa.entries()].sort((a, b) => a[1].localeCompare(b[1], 'es'))
  }, [acuerdos])

  const filas = useMemo(() => {
    return acuerdos.filter((a) => {
      if (sucursal && a.espacio?.sucursal_id !== sucursal) return false
      if (proveedor && a.proveedor_id !== proveedor) return false
      const est = !a.activo ? 'Baja' : vigente(a) ? 'Vigente' : 'Vencido'
      if (estado !== 'Todos' && est !== estado) return false
      return true
    })
  }, [acuerdos, sucursal, proveedor, estado])

  const cumplimiento = (a: AcuerdoConRelacion) => {
    const fechas = fechasDeCobro(a.fecha_inicio, a.fecha_fin, a.frecuencia)
    const cobradas = cobrosDe.get(a.id) ?? 0
    return { cobradas, total: fechas.length, pct: porcentaje(cobradas, fechas.length) }
  }

  if (!acuerdos.length) {
    return (
      <EmptyState
        title="Sin acuerdos en el historial"
        subtitle="Cuando se cree el primer acuerdo, su historial de rentas aparecerá acá."
      />
    )
  }

  return (
    <section className="space-y-4">
      {/* Filtros: sucursal, proveedor y estado del acuerdo. */}
      <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-3">
        <div>
          <label htmlFor="hist-sucursal" className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-400">
            Sucursal
          </label>
          <Select id="hist-sucursal" value={sucursal} onChange={(e) => setSucursal(e.target.value)}>
            <option value="">Todas</option>
            {sucursales.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nombre}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label htmlFor="hist-proveedor" className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-400">
            Proveedor
          </label>
          <Select id="hist-proveedor" value={proveedor} onChange={(e) => setProveedor(e.target.value)}>
            <option value="">Todos</option>
            {proveedores.map(([id, nombre]) => (
              <option key={id} value={id}>
                {nombre}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label htmlFor="hist-estado" className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-400">
            Estado
          </label>
          <Select id="hist-estado" value={estado} onChange={(e) => setEstado(e.target.value)}>
            {['Todos', 'Vigente', 'Vencido', 'Baja'].map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs font-bold uppercase tracking-wide text-slate-400">
              <th className="px-4 py-3">Espacio</th>
              <th className="px-4 py-3">Sucursal</th>
              <th className="px-4 py-3">Proveedor</th>
              <th className="px-4 py-3">Vigencia</th>
              <th className="px-4 py-3 text-right">Monto</th>
              <th className="px-4 py-3">Cumplimiento</th>
              <th className="px-4 py-3">Estado</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((a) => {
              const cum = cumplimiento(a)
              const est = !a.activo ? 'Baja' : vigente(a) ? 'Vigente' : 'Vencido'
              const suc = sucursales.find((s) => s.id === a.espacio?.sucursal_id)?.nombre ?? '—'
              return (
                <tr key={a.id} className="border-t border-slate-100">
                  <td className="px-4 py-3">
                    <span className="font-mono text-xs font-bold text-primary">{a.espacio?.codigo ?? '—'}</span>
                    <span className="block text-xs text-slate-500">
                      {a.espacio ? tipoDe(a.espacio.tipo_id) : ''}
                      {a.espacio?.detalle ? ` · ${a.espacio.detalle}` : ''}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">{suc}</td>
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-2 font-semibold text-slate-800">
                      <span
                        className="h-3 w-3 shrink-0 rounded-full"
                        style={{ backgroundColor: colorDe(a.proveedor?.color) }}
                        aria-hidden
                      />
                      {a.proveedor?.nombre ?? '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    {a.fecha_inicio} → {a.fecha_fin}
                  </td>
                  <td className="px-4 py-3 text-right font-bold tabular-nums text-slate-900">
                    {usd(a.monto_usd)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`text-xs font-bold tabular-nums ${
                        cum.pct === 100 ? 'text-emerald-600' : cum.cobradas ? 'text-amber-600' : 'text-red-600'
                      }`}
                      title={`${cum.cobradas} de ${cum.total} fechas cobradas`}
                    >
                      {cum.cobradas}/{cum.total} · {cum.pct}%
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <Badge color={est === 'Vigente' ? 2 : est === 'Vencido' ? 4 : 0}>{est}</Badge>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {!filas.length ? (
        <EmptyState title="Nada con esos filtros" subtitle="Probá sacar alguno para ver más acuerdos." />
      ) : null}
    </section>
  )
}
