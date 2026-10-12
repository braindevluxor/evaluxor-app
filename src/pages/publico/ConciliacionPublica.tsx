import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Lock, RefreshCw, TriangleAlert } from 'lucide-react'
import { cn } from '../../components/ui'
import {
  obtenerConciliacionPublica,
  type ConciliacionPublica
} from '../../lib/data/compartir'
import { desdeAhora, formatearFechaHora } from '../../lib/tiempo'
import {
  agruparPorDepartamento,
  esMatchConciliacion,
  esSinHablador,
  estadoConciliacion,
  formatearMontoPerdida,
  formatearPrecioBase,
  productosParaConciliar,
  resumenPerdidaConciliacion,
  totalConciliacion,
  type ContraDatoConciliacion,
  type ProductoConciliacion,
  type ValorConciliacion
} from '../../lib/scoring'
import type { Item } from '../../lib/types'

/**
 * Pantalla de invitado: la conciliación de una evaluación, sin sesión.
 *
 * Lo que NO tiene, a propósito:
 *
 * · Ningún control de edición, creación ni borrado. No es que estén
 *   deshabilitados: no se importan. El rol `anon` ni siquiera tiene permiso de
 *   tabla sobre la evaluación — todo lo que acá aparece viene de una sola
 *   función (`ver_conciliacion_compartida`) que sólo devuelve lectura.
 * · Fotos, incidencias, colaboradores, planos ni el resto de los ítems. El
 *   bucket de evidencia es privado y firmar URLs para sesión anónima sería
 *   abrirlo entero a cambio de un link.
 * · El nombre del evaluador: viene el id en la fila, no el perfil.
 *
 * "En vivo": refresco cada 15 s mientras la evaluación está ACTIVA, igual que
 * hace `EvaluacionDetalle`. No hay Realtime porque `postgres_changes` exige
 * políticas `to anon` sobre la tabla de respuestas, que es exactamente la
 * apertura que no queremos hacer; con polling el único agujero sigue siendo
 * una función.
 */
export function ConciliacionPublica() {
  const { token } = useParams<{ token: string }>()
  const [datos, setDatos] = useState<ConciliacionPublica | null>(null)
  const [cargando, setCargando] = useState(true)
  const [falla, setFalla] = useState<string | null>(null)
  const [ultimo, setUltimo] = useState<string | null>(null)
  // El estado vive también en una ref: el intervalo no debe re-renderizar ni
  // reiniciarse cada 15 s, sólo mirar si todavía tiene sentido refrescar.
  const estadoRef = useRef<string | null>(null)

  useEffect(() => {
    if (!token) return
    let vivo = true

    const leer = async () => {
      try {
        const paquete = await obtenerConciliacionPublica(token)
        if (!vivo) return
        if (!paquete) {
          setDatos(null)
          estadoRef.current = 'inexistente'
        } else {
          setDatos(paquete)
          estadoRef.current = paquete.evaluacion.estado
          setUltimo(new Date().toISOString())
        }
        setFalla(null)
      } catch (e) {
        if (!vivo) return
        // Un error de red no es "el enlace ya no existe": son dos cosas
        // distintas y decirle "enlace inválido" por un corte sería mentir.
        setFalla(e instanceof Error ? e.message : 'No se pudo leer la conciliación')
      } finally {
        if (vivo) setCargando(false)
      }
    }

    void leer()
    const reloj = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return
      if (estadoRef.current === 'CERRADA' || estadoRef.current === 'inexistente') return
      void leer()
    }, 15_000)

    return () => {
      vivo = false
      window.clearInterval(reloj)
    }
  }, [token])

  if (!token) return <VistaInvalida titulo="Enlace incompleto" />

  if (cargando && !datos) {
    return (
      <Marco>
        <div className="mx-auto max-w-3xl px-4 py-16 text-center">
          <p className="text-sm font-semibold text-slate-500">Cargando la conciliación…</p>
        </div>
      </Marco>
    )
  }

  if (falla && !datos) return <VistaInvalida titulo="No se pudo abrir el enlace" detalle={falla} />

  if (!datos) {
    return (
      <VistaInvalida
        titulo="Este enlace no está activo"
        detalle="El enlace fue apagado o nunca existió. Pedile a quien lo compartió que genere uno nuevo."
      />
    )
  }

  return <VistaConciliacion datos={datos} ultimo={ultimo} falla={falla} />
}

/** Encabezado, tarjeta de la unidad y las conciliaciones de la evaluación. */
export function VistaConciliacion({
  datos,
  ultimo,
  falla
}: {
  datos: ConciliacionPublica
  ultimo: string | null
  falla: string | null
}) {
  const ev = datos.evaluacion
  const unidad = ev.sucursal?.nombre ?? ev.departamento?.nombre ?? 'Unidad'
  const items = datos.items.filter((i) => i.tipo === 'CONCILIACION')
  const padre = new Map(datos.items.map((i) => [i.id, i]))
  const modulo = new Map(datos.modulos.map((m) => [m.id, m]))

  return (
    <Marco>
      <main className="mx-auto w-full max-w-4xl px-4 pb-24 pt-6 sm:px-6">
        <section className="rounded-2xl bg-slate-50 p-5">
          <div className="flex flex-wrap items-center gap-2">
            {ev.estado === 'ACTIVA' ? (
              <span className="rounded-full bg-green-100 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-green-700">
                En vivo
              </span>
            ) : null}
            <span className="rounded-full bg-slate-200 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-slate-600">
              {ev.estado === 'ACTIVA' ? 'Abierta' : ev.estado === 'CERRADA' ? 'Cerrada' : 'Programada'}
            </span>
          </div>
          <h1 className="mt-3 text-2xl font-extrabold leading-tight text-slate-900">{unidad}</h1>
          <p className="mt-1 text-sm font-medium text-slate-500">
            Conciliación · {fechaLarga(ev.fecha)}
            {ev.puntuacion != null ? ` · Puntaje ${ev.puntuacion}%` : ''}
          </p>

          <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-3">
            <Dato etiqueta="Actualizado" valor={ultimo ? desdeAhora(ultimo) : 'recién'} />
            <Dato etiqueta="Lectura" valor={formatearFechaHora(ultimo)} />
          </dl>

          {falla ? (
            <p className="mt-4 flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              {falla} · se reintenta solo
            </p>
          ) : null}
        </section>

        {items.length === 0 ? (
          <p className="mt-8 text-center text-sm font-medium text-slate-400">
            Esta evaluación todavía no tiene conciliación cargada.
          </p>
        ) : (
          <div className="mt-6 space-y-6">
            {items.map((item) => {
              const respuesta = datos.respuestas.find((r) => r.item_id === item.id)
              const valor = (respuesta?.valor ?? null) as ValorConciliacion | null
              const seccion = item.padre_id ? padre.get(item.padre_id) : undefined
              return (
                <TarjetaConciliacion
                  key={item.id}
                  item={item}
                  valor={valor}
                  seccion={seccion}
                  modulo={modulo.get(item.modulo_id)?.nombre ?? null}
                />
              )
            })}
          </div>
        )}

        <p className="mt-10 text-center text-xs font-medium leading-relaxed text-slate-400">
          Vista de invitado · sólo lectura. Las fotos de evidencia, las incidencias y el resto de
          los ítems no se muestran en el enlace público.
        </p>
      </main>
    </Marco>
  )
}

/** Una conciliación: encabezado, KPIs, pérdida acumulada y la tabla por pasillo. */
function TarjetaConciliacion({
  item,
  valor,
  seccion,
  modulo
}: {
  item: Item
  valor: ValorConciliacion | null
  seccion: Item | undefined
  modulo: string | null
}) {
  const contraDato: ContraDatoConciliacion = item.contra_dato ?? 'SOH'
  const esPrecio = contraDato === 'FINAL_BASE'
  const ps = productosParaConciliar(valor?.productos, contraDato)
  const total = totalConciliacion(valor)
  const conciliadas = ps.filter(esMatchConciliacion).length

  if (!ps.length) {
    return (
      <section className="rounded-2xl bg-slate-50 p-5">
        <Cabecera item={item} seccion={seccion} modulo={modulo} />
        <p className="mt-3 text-sm font-medium text-slate-400">Sin productos</p>
      </section>
    )
  }

  const grupos = agruparPorDepartamento(ps, contraDato)

  return (
    <section className="rounded-2xl bg-slate-50 p-5">
      <Cabecera item={item} seccion={seccion} modulo={modulo} />

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Kpi etiqueta="SKU agregados" valor={String(ps.length)} color="text-slate-900" />
        <Kpi etiqueta="Match" valor={String(conciliadas)} color="text-green-600" />
        <Kpi etiqueta="No Match" valor={String(ps.length - conciliadas)} color={ps.length - conciliadas > 0 ? 'text-red-600' : 'text-slate-400'} />
        <Kpi
          etiqueta="Total conciliación"
          valor={total != null ? `${total}%` : '—'}
          color={total != null ? (total === 100 ? 'text-green-600' : 'text-red-600') : 'text-slate-400'}
        />
      </div>

      {contraDato === 'SOH' ? <Perdida productos={ps} /> : null}

      <div className="mt-4 overflow-x-auto">
        <table className="w-full table-fixed text-xs sm:text-sm">
          <thead>
            <tr className="bg-slate-100 text-left text-[11px] uppercase tracking-wide text-slate-500">
              <th scope="col" className="w-[26%] break-words px-2 py-2 font-bold">SKU</th>
              <th scope="col" className="w-[30%] break-words px-2 py-2 font-bold">Producto</th>
              <th scope="col" className="w-[14%] break-words px-2 py-2 text-right font-bold">
                {esPrecio ? 'Sistema' : 'Teórica'}
              </th>
              <th scope="col" className="w-[14%] break-words px-2 py-2 text-right font-bold">
                {esPrecio ? 'Hablador' : 'Física'}
              </th>
              <th scope="col" className="w-[16%] break-words px-2 py-2 text-right font-bold">Estado</th>
            </tr>
          </thead>
          <tbody>
            {grupos.map((grupo) => (
              <GrupoTabla
                key={grupo.departamento ?? 'sin-departamento'}
                nombre={grupo.departamento}
                productos={grupo.productos}
                esPrecio={esPrecio}
                contraDato={contraDato}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/**
 * El rótulo del pasillo y sus filas en un solo recorrido: el conteo se hace
 * caminando la góndola, así que cada fila tiene que decir en qué pasillo está.
 * Sin líneas: el pasillo se separa con fondo, no con contorno.
 */
function GrupoTabla({
  nombre,
  productos,
  esPrecio,
  contraDato
}: {
  nombre: string | null
  productos: ProductoConciliacion[]
  esPrecio: boolean
  contraDato: ContraDatoConciliacion
}) {
  const perdida = resumenPerdidaConciliacion(productos, contraDato).monto
  return (
    <>
      <tr className="bg-slate-200/70">
        <th scope="colgroup" colSpan={5} className="px-2 py-1.5 text-left text-[11px] font-bold uppercase tracking-wide text-slate-600">
          {nombre ?? 'Sin departamento'}
          {perdida > 0 ? (
            <span className="ml-2 font-semibold normal-case tracking-normal text-red-600">
              pérdida {formatearMontoPerdida(perdida)}
            </span>
          ) : null}
        </th>
      </tr>
      {productos.map((p, i) => {
        const hablador = esSinHablador(p)
        const estado = estadoConciliacion(p)
        const chip = hablador
          ? { texto: 'Sin hablador', clase: 'bg-amber-100 text-amber-800' }
          : estado === 'concilia'
            ? { texto: 'Match', clase: 'bg-green-100 text-green-800' }
            : estado === 'falta'
              ? { texto: 'Falta', clase: 'bg-red-100 text-red-800' }
              : estado === 'sobra'
                ? { texto: 'Sobra', clase: 'bg-amber-100 text-amber-800' }
                : { texto: 'Sin datos', clase: 'bg-slate-200 text-slate-600' }
        return (
          <tr key={`${p.sku}-${i}`} className={i % 2 === 1 ? 'bg-white' : 'bg-white/60'}>
            <td className="break-all px-2 py-1.5 font-medium tabular-nums text-slate-700">{p.sku}</td>
            <td className="break-words px-2 py-1.5 text-slate-600">{p.nombre ?? '—'}</td>
            <td className="px-2 py-1.5 text-right tabular-nums text-slate-600">
              {cantidad(p.teorica, esPrecio)}
            </td>
            <td className="px-2 py-1.5 text-right tabular-nums text-slate-600">
              {cantidad(p.fisica, esPrecio)}
            </td>
            <td className="px-2 py-1.5 text-right">
              <span className={cn('inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide', chip.clase)}>
                {chip.texto}
              </span>
            </td>
          </tr>
        )
      })}
    </>
  )
}

/** La plata perdida, con la misma banda de tres tonos que ve el evaluador en la app. */
function Perdida({ productos }: { productos: ProductoConciliacion[] }) {
  const resumen = resumenPerdidaConciliacion(productos, 'SOH')
  const absoluta = resumen.monto + resumen.montoSobrantes
  const sinPrecio = resumen.faltantesSinPrecio + resumen.sobrantesSinPrecio
  const descuadrados = resumen.faltantesConPrecio + resumen.sobrantesConPrecio + sinPrecio

  const hayPerdida = absoluta > 0
  const sinValorar = !hayPerdida && sinPrecio > 0
  const fondo = hayPerdida ? 'bg-red-50' : sinValorar ? 'bg-amber-50' : 'bg-green-50'
  const rotulo = hayPerdida ? 'text-red-500' : sinValorar ? 'text-amber-600' : 'text-green-600'
  const monto = hayPerdida ? 'text-red-700' : sinValorar ? 'text-amber-700' : 'text-green-700'
  const apunte = hayPerdida ? 'text-red-400' : sinValorar ? 'text-amber-500' : 'text-green-600'

  return (
    <div className={cn('mt-3 rounded-xl px-4 py-3', fondo)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
        <p className={cn('text-[11px] font-bold uppercase tracking-wide', rotulo)}>Pérdida acumulada</p>
        <p className={cn('text-[11px] font-semibold', apunte)}>
          {hayPerdida
            ? `${descuadrados} de ${productos.length} SKU descuadrados`
            : sinValorar
              ? `${sinPrecio} SKU sin precio base`
              : 'Todo concilia'}
        </p>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-5 gap-y-1">
        <p className="text-xs font-medium text-slate-500">
          Real <strong className={cn('text-base font-extrabold tabular-nums', monto)}>{formatearMontoPerdida(resumen.monto)}</strong>
        </p>
        <p className="text-xs font-medium text-slate-500">
          Absoluta <strong className={cn('text-base font-extrabold tabular-nums', monto)}>{formatearMontoPerdida(absoluta)}</strong>
        </p>
      </div>
    </div>
  )
}

function Cabecera({ item, seccion, modulo }: { item: Item; seccion: Item | undefined; modulo: string | null }) {
  return (
    <div>
      {modulo || seccion ? (
        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
          {[modulo, seccion?.texto].filter(Boolean).join(' · ')}
        </p>
      ) : null}
      <h2 className="mt-1 text-base font-extrabold leading-snug text-slate-900">{item.texto}</h2>
    </div>
  )
}

function Kpi({ etiqueta, valor, color }: { etiqueta: string; valor: string; color: string }) {
  return (
    <div className="rounded-xl bg-white px-3 py-2.5 text-center">
      <p className={cn('text-lg font-extrabold tabular-nums', color)}>{valor}</p>
      <p className="mt-0.5 break-words text-[11px] font-medium leading-tight text-slate-500">{etiqueta}</p>
    </div>
  )
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div>
      <dt className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{etiqueta}</dt>
      <dd className="text-sm font-semibold text-slate-700">{valor}</dd>
    </div>
  )
}

function cantidad(n: number | null, esPrecio: boolean): string {
  if (n == null) return '—'
  return esPrecio ? formatearPrecioBase(n) : String(n)
}

function fechaLarga(fecha: string): string {
  const d = new Date(`${fecha}T00:00:00`)
  if (Number.isNaN(d.getTime())) return fecha
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' })
}

/** Marco propio: sin sidebar, sin barra inferior, sin sesión. */
function Marco({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-white font-sans text-slate-900">
      <header className="sticky top-0 z-10 bg-white/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <img src="/completo.webp" alt="EvaLuxor" className="h-8 w-auto" />
          <span className="flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">
            <Lock className="h-3.5 w-3.5" aria-hidden="true" />
            Modo invitado
          </span>
        </div>
      </header>
      {children}
    </div>
  )
}

function VistaInvalida({ titulo, detalle }: { titulo: string; detalle?: string }) {
  return (
    <Marco>
      <main className="mx-auto flex max-w-md flex-col items-center px-6 py-20 text-center">
        <img src="/isotipo.webp" alt="" className="h-14 w-auto" />
        <h1 className="mt-6 text-xl font-extrabold text-slate-900">{titulo}</h1>
        {detalle ? <p className="mt-2 text-sm font-medium leading-relaxed text-slate-500">{detalle}</p> : null}
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-primary-700"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Reintentar
          </button>
          <Link to="/" className="rounded-full bg-slate-100 px-5 py-2.5 text-sm font-bold text-slate-600">
            Ir a EvaLuxor
          </Link>
        </div>
      </main>
    </Marco>
  )
}
