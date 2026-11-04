import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Marco, VistaInvalida } from './Invitado'
import { leerCargosPublicos, type CargosPublicos } from '../../lib/data/compartirCargos'
import { esVideoPath } from '../../lib/fotos'
import { etiquetaTipo } from '../../lib/scoring'
import { formatearFechaHora } from '../../lib/tiempo'
import { supabase } from '../../lib/supabase'
import type { HistorialPunto, PendienteCargo } from '../../lib/pdf/reporteCargos'

/**
 * Pantalla de invitado: las FALLAS POR CARGO de una evaluación, sin sesión.
 *
 * Es la bitácora de atención del trabajador: el mismo contenido que baja el
 * Líder en PDF desde «Por cargo», para leer en el teléfono sin cuenta. Lo que
 * se muestra, bloque por bloque: el cargo con su nota, cada ítem que falló,
 * los puntos concretos con sus puntos y su HISTORIAL de reincidencias, las
 * observaciones que quedaron pegadas a cada punto y sus fotos.
 *
 * Lo que NO tiene, a propósito:
 *
 * · Ningún control de edición, creación ni borrado: todo lo que acá aparece
 *   viene de una sola función (`ver_cargos_compartidos`) que sólo devuelve
 *   lectura, y el rol `anon` ni siquiera tiene permiso de tabla.
 * · El resto de la evaluación: respuestas, quién contestó qué, incidencias,
 *   colaboradores ni los ítems que no están en los pendientes elegidos.
 *
 * **Es una foto, no una lectura viva**: el enlace guarda el reporte
 * congelado al generarlo (por eso puede incluir las reincidencias, que se
 * deciden contra el histórico de la unidad). No hay refresco: si apagan el
 * enlace, la próxima apertura —o un reload— deja de servir.
 *
 * Las FOTOS se firman ACÁ, una sola vez al abrir: el bucket es privado y el
 * enlace sólo puede firmar las rutas que trae su propio reporte —no el
 * bucket entero—. Son URLs con vencimiento corto, igual que en el resto de la
 * app; si no se pudieron firmar, el documento se lee igual sin ellas.
 */
export function CargosPublicos() {
  const { token } = useParams<{ token: string }>()
  const [paquete, setPaquete] = useState<CargosPublicos | null>(null)
  const [cargando, setCargando] = useState(true)
  const [falla, setFalla] = useState<string | null>(null)
  const [fotos, setFotos] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!token) return
    let vivo = true
    void leerCargosPublicos(token)
      .then((leido) => {
        if (!vivo) return
        setPaquete(leido)
        setFalla(null)
      })
      .catch((e) => {
        if (!vivo) return
        // Un error de red no es "el enlace ya no existe": son dos cosas
        // distintas y decirle "enlace inválido" por un corte sería mentir.
        setFalla(e instanceof Error ? e.message : 'No se pudo leer el enlace')
      })
      .finally(() => {
        if (vivo) setCargando(false)
      })
    return () => {
      vivo = false
    }
  }, [token])

  // Las fotos del reporte, firmadas para ESTE enlace. Sin ellas el documento
  // se lee igual: una foto que no se pudo firmar no es motivo para no mostrar
  // los pendientes.
  useEffect(() => {
    if (!paquete) return
    const rutas = Array.from(
      new Set(paquete.datos.cargos.flatMap((cargo) => cargo.pendientes.flatMap((p) => p.fotos)))
    ).filter((ruta) => !esVideoPath(ruta))
    if (!rutas.length) return
    let vivo = true
    void supabase.storage
      .from('evidencias')
      .createSignedUrls(rutas, 3600)
      .then(({ data }) => {
        if (!vivo) return
        const porRuta: Record<string, string> = {}
        for (const firmada of data ?? []) {
          if (firmada.signedURL && firmada.path) porRuta[firmada.path] = firmada.signedURL
        }
        setFotos(porRuta)
      })
      .catch(() => undefined)
    return () => {
      vivo = false
    }
  }, [paquete])

  if (!token) return <VistaInvalida titulo="Enlace incompleto" />

  if (cargando && !paquete) {
    return (
      <Marco>
        <div className="mx-auto max-w-3xl px-4 py-16 text-center">
          <p className="text-sm font-semibold text-slate-500">Cargando los pendientes…</p>
        </div>
      </Marco>
    )
  }

  if (falla && !paquete) return <VistaInvalida titulo="No se pudo abrir el enlace" detalle={falla} />

  if (!paquete) {
    return (
      <VistaInvalida
        titulo="Este enlace no está activo"
        detalle="El enlace fue apagado o nunca existió. Pedile a quien lo compartió que genere uno nuevo."
      />
    )
  }

  return <VistaCargos paquete={paquete} fotos={fotos} />
}

/** Encabezado de la bitácora y, debajo, un bloque por cargo. */
function VistaCargos({ paquete, fotos }: { paquete: CargosPublicos; fotos: Record<string, string> }) {
  const ev = paquete.evaluacion
  if (!ev) return <VistaInvalida titulo="Este enlace no está activo" />

  const datos = paquete.datos
  const unidad = datos.unidad || ev.sucursal?.nombre || ev.departamento?.nombre || 'Unidad'
  const conPendientes = datos.cargos.filter((c) => c.pendientes.length).length

  return (
    <Marco>
      <main className="mx-auto w-full max-w-4xl px-4 pb-24 pt-6 sm:px-6">
        <section className="rounded-2xl bg-slate-50 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-primary-100 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-primary-700">
              Bitácora de atención
            </span>
            <span className="rounded-full bg-slate-200 px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-slate-600">
              Sólo lectura
            </span>
          </div>
          <h1 className="mt-3 text-xl font-extrabold text-slate-900">{unidad}</h1>
          <p className="mt-1 text-sm font-medium text-slate-600">
            {fechaLarga(datos.fecha)} · Puntaje general{' '}
            {datos.puntajeGeneral == null ? 'sin puntaje' : `${redondear2(datos.puntajeGeneral)}%`}
          </p>
          <p className="mt-2 text-sm text-slate-500">
            {conPendientes === 0
              ? 'Ningún cargo del reporte tiene pendientes en esta evaluación.'
              : `${conPendientes} de ${datos.cargos.length} ${datos.cargos.length === 1 ? 'cargo' : 'cargos'} con pendientes. Cada punto trae sus reincidencias y sus fotos.`}
          </p>
          {paquete.generado ? (
            <p className="mt-1 text-xs text-slate-400">Generado el {formatearFechaHora(paquete.generado)}</p>
          ) : null}
        </section>

        {datos.cargos.map((cargo, i) => (
          <BloqueCargo key={`${cargo.cargo}-${i}`} cargo={cargo} fotos={fotos} />
        ))}

        <p className="mt-6 text-center text-xs text-slate-400">
          Enlace de sólo lectura. No se pueden editar, crear ni borrar evaluaciones desde acá.
        </p>
      </main>
    </Marco>
  )
}

/** Un cargo con su nota y todos sus pendientes. */
function BloqueCargo({
  cargo,
  fotos
}: {
  cargo: CargosPublicos['datos']['cargos'][number]
  fotos: Record<string, string>
}) {
  return (
    <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-extrabold text-primary-900">{cargo.cargo}</h2>
        <span className="text-sm font-bold tabular-nums text-slate-600">
          {cargo.porciento == null ? 'Sin nota' : `${redondear2(cargo.porciento)}%`}
        </span>
      </div>
      <p className="mt-0.5 text-xs text-slate-500">
        {cargo.pendientes.length} {cargo.pendientes.length === 1 ? 'ítem' : 'ítems'} con pendientes ·{' '}
        {formatearNumero(cargo.perdidos)} puntos no cumplidos
      </p>

      {cargo.pendientes.length ? (
        cargo.pendientes.map((pendiente, i) => (
          <Pendiente key={`${pendiente.item}-${i}`} pendiente={pendiente} fotos={fotos} />
        ))
      ) : (
        <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">
          Este cargo no tiene ítems con pendientes en esta evaluación.
        </p>
      )}
    </section>
  )
}

/** Un ítem que falló: sus puntos con el historial, sus observaciones y sus fotos. */
function Pendiente({ pendiente, fotos }: { pendiente: PendienteCargo; fotos: Record<string, string> }) {
  const observaciones = pendiente.evidencias.filter((e) => e.comentario)
  const bloques = pendiente.evidencias.filter((e) => e.fotos.some((ruta) => fotos[ruta]))
  // El rótulo del punto sólo cuando hay más de uno: con uno solo la tabla de
  // arriba ya lo nombró (mismo criterio que el PDF).
  const conRotulo = new Set(bloques.map((b) => b.punto).filter(Boolean)).size > 1

  return (
    <article className="mt-3 rounded-xl border border-slate-100 bg-slate-50/70 p-3">
      <h3 className="text-sm font-bold text-slate-800">{pendiente.item}</h3>
      <p className="text-xs text-slate-500">
        {pendiente.modulo ?? 'Sin módulo'} · {etiquetaTipo(pendiente.tipo)}
      </p>

      {pendiente.checks.length ? (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-slate-400">
                <th className="py-1 pr-2">Punto</th>
                <th className="py-1 pr-2">Estado</th>
                <th className="py-1 pr-2 text-right">Puntos</th>
                <th className="py-1">Historial</th>
              </tr>
            </thead>
            <tbody>
              {pendiente.checks.map((check, i) => (
                <tr key={`${check}-${i}`} className="border-t border-slate-100 align-top">
                  <td className="py-1.5 pr-2 font-medium text-slate-700">{check}</td>
                  <td className="py-1.5 pr-2 font-bold text-red-600">NO APROBADO</td>
                  <td className="py-1.5 pr-2 text-right tabular-nums text-slate-700">
                    {pendiente.puntos[i] == null ? '—' : formatearNumero(pendiente.puntos[i])}
                  </td>
                  <td className="py-1.5">
                    <ChipHistorial h={pendiente.historial[check]} />
                  </td>
                </tr>
              ))}
              <tr className="border-t border-slate-200 font-bold text-slate-700">
                <td className="py-1.5 pr-2" colSpan={2}>
                  TOTAL del ítem
                </td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{formatearNumero(pendiente.perdidos)}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-2 text-xs font-medium text-slate-600">
          Ítem completo ({etiquetaTipo(pendiente.tipo)}) · {formatearNumero(pendiente.perdidos)} puntos no
          cumplidos
        </p>
      )}

      {observaciones.length ? (
        <ul className="mt-2 space-y-1">
          {observaciones.map((evidencia, i) => (
            <li key={`${evidencia.punto}-${i}`} className="rounded-lg bg-white px-2.5 py-1.5 text-xs text-slate-600">
              <span className="font-semibold text-slate-700">{evidencia.punto || 'Ítem'}: </span>
              {evidencia.comentario}
            </li>
          ))}
        </ul>
      ) : null}

      {bloques.length ? (
        <div className="mt-3 space-y-3">
          {bloques.map((bloque, i) => (
            <div key={`${bloque.punto}-${i}`}>
              {conRotulo ? (
                <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">{bloque.punto}</p>
              ) : null}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {bloque.fotos
                  .filter((ruta) => fotos[ruta])
                  .map((ruta) => (
                    <img
                      key={ruta}
                      src={fotos[ruta]}
                      alt=""
                      loading="lazy"
                      className="w-full rounded-lg border border-slate-200 object-cover"
                    />
                  ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </article>
  )
}

/**
 * El historial de un punto: la reincidencia es la que importa mirar, pero
 * «reincidente» sin decir cuántas veces cayó es un juicio sin contexto, así
 * que el número viaja en el `title`.
 */
function ChipHistorial({ h }: { h?: HistorialPunto }) {
  if (!h) return null
  const titulo = `${h.faltas} ${h.faltas === 1 ? 'falta' : 'faltas'} en el histórico de este cargo${
    h.reincidencias ? `, ${h.reincidencias} de ellas seguidas` : ''
  }`
  if (h.esReincidente) {
    return (
      <span
        title={titulo}
        className="inline-flex whitespace-nowrap rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700"
      >
        Reincidencia
      </span>
    )
  }
  if (h.faltas > 1) {
    return (
      <span
        title={titulo}
        className="inline-flex whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700"
      >
        {h.faltas} faltas
      </span>
    )
  }
  return (
    <span
      title={titulo}
      className="inline-flex whitespace-nowrap rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-500"
    >
      Primera falta
    </span>
  )
}

function formatearNumero(n: number): string {
  if (!Number.isFinite(n)) return '—'
  return Number.isInteger(n) ? `${n}` : `${redondear2(n)}`
}

function redondear2(n: number): number {
  return Math.round(n * 100) / 100
}

function fechaLarga(fecha: string): string {
  const d = new Date(`${fecha}T00:00:00`)
  if (Number.isNaN(d.getTime())) return fecha
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' })
}
