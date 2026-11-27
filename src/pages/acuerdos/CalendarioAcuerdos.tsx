import { useMemo, useState } from 'react'
import { Button, Field, Input, Modal, Spinner } from '../../components/ui'
import { colorDe, diasDelMes, enMora, fechasDeCobro, hoyISO, usd, vigente } from '../../lib/acuerdos'
import { urlFirmada, type AcuerdoConRelacion, type CobroConAcuerdo } from '../../lib/data/acuerdos'
import { avisar } from '../../lib/aviso'
import { ChevronLeft, ChevronRight, CheckCircle2, FileText, Plus } from 'lucide-react'

const MESES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre'
]

type Item = {
  fecha: string
  acuerdo: AcuerdoConRelacion
  cobro: CobroConAcuerdo | null
}

/**
 * EL CALENDARIO DE COBROS
 * -----------------------
 * Recorrido visual de las fechas en que se cobra cada acuerdo: las que ya
 * se cobraron quedan verdes con su comprobante, las VENCIDAS sin cobrar se
 * pintan de ROJO (mora — se calcula con `enMora`, no se guarda) y las
 * futuras quedan neutras.
 *
 * Las fechas salen de `fecha_inicio + frecuencia` (`fechasDeCobros`), así
 * que el calendario no necesita que nadie genere renglones: sólo lo cobrado
 * está en la base. El AUD_EX es el único que registra cobros y sube el
 * comprobante (PDF o imagen), y el Líder sólo mira.
 */
export function CalendarioAcuerdos({
  acuerdos,
  cobros,
  puedeCobrar,
  onRegistrar,
  onDeshacer
}: {
  acuerdos: AcuerdoConRelacion[]
  cobros: CobroConAcuerdo[]
  puedeCobrar: boolean
  onRegistrar: (entrada: {
    acuerdo_id: string
    fecha: string
    monto: number
    archivo?: File
  }) => Promise<void>
  onDeshacer: (id: string) => Promise<void>
}) {
  const hoy = hoyISO()
  const [mes, setMes] = useState(() => {
    const d = new Date()
    return { anio: d.getFullYear(), mes: d.getMonth() }
  })
  const [dia, setDia] = useState(hoy)
  const [registrando, setRegistrando] = useState<Item | null>(null)
  const [monto, setMonto] = useState('')
  const [archivo, setArchivo] = useState<File | null>(null)
  const [guardando, setGuardando] = useState(false)

  /** Todos los cobros del módulo, por fecha. */
  const cobrosPorFecha = useMemo(() => {
    const mapa = new Map<string, CobroConAcuerdo>()
    for (const c of cobros) mapa.set(`${c.acuerdo_id}|${c.fecha}`, c)
    return mapa
  }, [cobros])

  /** Cada día del mes con sus cobros: los VIGENTES generan sus fechas. */
  const porDia = useMemo(() => {
    const mapa = new Map<string, Item[]>()
    for (const a of acuerdos) {
      if (!vigente(a, hoy)) continue
      for (const fecha of fechasDeCobro(a.fecha_inicio, a.fecha_fin, a.frecuencia)) {
        const cobro = cobrosPorFecha.get(`${a.id}|${fecha}`) ?? null
        const lista = mapa.get(fecha) ?? []
        lista.push({ fecha, acuerdo: a, cobro })
        mapa.set(fecha, lista)
      }
    }
    return mapa
  }, [acuerdos, cobrosPorFecha, hoy])

  const dias = useMemo(() => diasDelMes(mes.anio, mes.mes), [mes])

  /** Los renglones del DÍA elegido. */
  const delDia = porDia.get(dia) ?? []

  /** Recaudado (lo cobrado) y pendiente (las fechas sin cobrar). */
  const { cobrado, pendiente, vencidas } = useMemo(() => {
    let c = 0
    let p = 0
    let v = 0
    for (const [, items] of porDia) {
      for (const it of items) {
        if (it.cobro) c += Number(it.cobro.monto) || 0
        else {
          p += Number(it.acuerdo.monto_usd) || 0
          if (enMora(it.fecha, false, hoy)) v += 1
        }
      }
    }
    return { cobrado: c, pendiente: p, vencidas: v }
  }, [porDia, hoy])

  const cambiarMes = (paso: number) => {
    setMes((m) => {
      const nuevo = new Date(m.anio, m.mes + paso, 1)
      return { anio: nuevo.getFullYear(), mes: nuevo.getMonth() }
    })
  }

  const registrar = async () => {
    if (!registrando) return
    setGuardando(true)
    try {
      await onRegistrar({
        acuerdo_id: registrando.acuerdo.id,
        fecha: registrando.fecha,
        monto: Number(monto.replace(/\./g, '').replace(',', '.')) || registrando.acuerdo.monto_usd,
        archivo: archivo ?? undefined
      })
      setRegistrando(null)
      setArchivo(null)
      setMonto('')
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'No se pudo registrar el cobro.', 'error')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <section className="space-y-4">
      {/* Resumen: lo recaudado y lo pendiente, en dólares. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <span className="block text-xs font-semibold text-slate-500">Dinero recaudado</span>
          <p className="mt-1 text-2xl font-extrabold text-emerald-600">{usd(cobrado)} USD</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <span className="block text-xs font-semibold text-slate-500">Cuentas pendientes por cobrar</span>
          <p className="mt-1 text-2xl font-extrabold text-slate-900">{usd(pendiente)} USD</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <span className="block text-xs font-semibold text-slate-500">En mora (vencidas sin cobrar)</span>
          <p className={`mt-1 text-2xl font-extrabold ${vencidas ? 'text-red-600' : 'text-slate-400'}`}>
            {vencidas} {vencidas === 1 ? 'fecha' : 'fechas'}
          </p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Mes en curso. */}
        <div className="lg:col-span-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <button
              type="button"
              onClick={() => cambiarMes(-1)}
              aria-label="Mes anterior"
              className="grid h-9 w-9 place-items-center rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 cursor-pointer"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <h3 className="text-sm font-extrabold text-primary-900">
              {MESES[mes.mes]} {mes.anio}
            </h3>
            <button
              type="button"
              onClick={() => cambiarMes(1)}
              aria-label="Mes siguiente"
              className="grid h-9 w-9 place-items-center rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 cursor-pointer"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-bold uppercase text-slate-400">
            {['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((d, i) => (
              <span key={`${d}-${i}`}>{d}</span>
            ))}
          </div>

          <div className="mt-1 grid grid-cols-7 gap-1">
            {dias.map((fecha, i) => {
              if (!fecha) return <span key={`vacio-${i}`} />
              const items = porDia.get(fecha) ?? []
              const hayMora = items.some((it) => !it.cobro && enMora(it.fecha, false, hoy))
              const todoCobrado = items.length > 0 && items.every((it) => !!it.cobro)
              const seleccionado = fecha === dia
              return (
                <button
                  key={fecha}
                  type="button"
                  onClick={() => setDia(fecha)}
                  aria-label={`Día ${fecha}`}
                  className={`min-h-[64px] rounded-xl border p-1 text-left transition-colors cursor-pointer ${
                    seleccionado
                      ? 'border-primary bg-primary-50'
                      : hayMora
                        ? 'border-red-300 bg-red-50 hover:bg-red-100'
                        : todoCobrado
                          ? 'border-emerald-200 bg-emerald-50 hover:bg-emerald-100'
                          : 'border-slate-200 bg-white hover:bg-slate-50'
                  }`}
                >
                  <span className="block text-xs font-bold text-slate-700">{Number(fecha.slice(8))}</span>
                  {items.slice(0, 2).map((it) => (
                    <span
                      key={it.acuerdo.id}
                      className="mt-0.5 flex items-center gap-1 truncate text-[10px] font-semibold text-slate-600"
                    >
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: colorDe(it.acuerdo.proveedor?.color) }}
                        aria-hidden
                      />
                      <span className="truncate">{it.acuerdo.proveedor?.nombre ?? '—'}</span>
                    </span>
                  ))}
                  {items.length > 2 ? (
                    <span className="block text-[10px] font-bold text-slate-400">+{items.length - 2}</span>
                  ) : null}
                </button>
              )
            })}
          </div>

          <p className="mt-3 flex flex-wrap gap-3 text-[11px] text-slate-500">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" /> cobrado
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-red-400" /> en mora (vencido sin cobrar)
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-slate-300" /> por venir
            </span>
          </p>
        </div>

        {/* El día elegido: qué se cobra y qué se hizo. */}
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="text-sm font-extrabold text-primary-900">{fechaLarga(dia)}</h3>
          {delDia.length === 0 ? (
            <p className="mt-3 text-xs text-slate-500">Sin cobros programados para este día.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {delDia.map((it) => {
                const mora = !it.cobro && enMora(it.fecha, false, hoy)
                return (
                  <li key={it.acuerdo.id} className="rounded-xl border border-slate-200 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-2 text-xs font-bold text-slate-800">
                        <span
                          className="h-3 w-3 shrink-0 rounded-full"
                          style={{ backgroundColor: colorDe(it.acuerdo.proveedor?.color) }}
                          aria-hidden
                        />
                        <span className="truncate">{it.acuerdo.proveedor?.nombre ?? '—'}</span>
                      </span>
                      <span className="shrink-0 text-xs font-bold tabular-nums text-slate-900">
                        {usd(it.cobro?.monto ?? it.acuerdo.monto_usd)}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-slate-500">
                      {it.acuerdo.frecuencia} · {it.acuerdo.tipo_pago} ·{' '}
                      {it.acuerdo.espacio?.codigo ?? '—'}
                    </p>

                    {it.cobro ? (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700">
                          <CheckCircle2 className="h-3 w-3" /> Cobrado {it.cobro.pagado_en?.slice(8)}/{it.cobro.pagado_en?.slice(5, 7)}
                        </span>
                        {it.cobro.comprobante ? (
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                const u = await urlFirmada(it.cobro!.comprobante!)
                                window.open(u, '_blank', 'noopener')
                              } catch (e) {
                                avisar(e instanceof Error ? e.message : 'No se pudo abrir el comprobante.', 'error')
                              }
                            }}
                            className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-700 hover:bg-slate-200 cursor-pointer"
                          >
                            <FileText className="h-3 w-3" /> Ver comprobante
                          </button>
                        ) : (
                          <span className="text-[11px] text-slate-400">Sin comprobante</span>
                        )}
                        {puedeCobrar ? (
                          <button
                            type="button"
                            onClick={() => void onDeshacer(it.cobro!.id)}
                            className="text-[11px] font-bold text-red-600 hover:underline cursor-pointer"
                          >
                            Deshacer
                          </button>
                        ) : null}
                      </div>
                    ) : (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {mora ? (
                          <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-700">
                            En mora
                          </span>
                        ) : (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">
                            Pendiente
                          </span>
                        )}
                        {puedeCobrar ? (
                          <button
                            type="button"
                            onClick={() => {
                              setRegistrando(it)
                              setMonto(String(it.acuerdo.monto_usd).replace('.', ','))
                              setArchivo(null)
                            }}
                            className="inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-0.5 text-[11px] font-bold text-white hover:bg-primary-700 cursor-pointer"
                          >
                            <Plus className="h-3 w-3" /> Registrar cobro
                          </button>
                        ) : null}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>

      {/* Registrar un cobro: monto + comprobante (PDF o imagen). */}
      <Modal
        open={!!registrando}
        onClose={() => {
          setRegistrando(null)
          setArchivo(null)
        }}
        title="Registrar cobro"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRegistrando(null)} disabled={guardando}>
              Cancelar
            </Button>
            <Button onClick={() => void registrar()} disabled={guardando}>
              {guardando ? <Spinner size={16} /> : null}
              Registrar cobro
            </Button>
          </div>
        }
      >
        {registrando ? (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              <span className="font-bold text-slate-800">{registrando.acuerdo.proveedor?.nombre ?? '—'}</span>{' '}
              · {fechaLarga(registrando.fecha)} · {registrando.acuerdo.espacio?.codigo ?? '—'}
            </p>
            <Field label="Monto cobrado (USD)">
              <Input
                inputMode="decimal"
                value={monto}
                onChange={(e) => setMonto(e.target.value)}
                required
              />
            </Field>
            <Field label="Comprobante (PDF o imagen)" hint="Opcional: se puede subir después desde el día en el calendario.">
              <input
                type="file"
                accept="application/pdf,image/png,image/jpeg,image/webp,image/gif"
                onChange={(e) => setArchivo(e.target.files?.[0] ?? null)}
                className="block w-full text-xs text-slate-600 file:mr-3 file:rounded-xl file:border file:border-slate-200 file:bg-white file:px-3 file:py-1.5 file:text-xs file:font-bold file:text-slate-700 hover:file:bg-slate-50"
              />
            </Field>
          </div>
        ) : null}
      </Modal>
    </section>
  )
}

/** `lunes 27 de noviembre de 2026`, en minúsculas. */
function fechaLarga(iso: string): string {
  const [a, m, d] = iso.split('-').map(Number)
  const fecha = new Date(a, (m ?? 1) - 1, d ?? 1)
  return fecha.toLocaleDateString('es-VE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  })
}
