import { Fragment, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Play } from 'lucide-react'
import { Marco, VistaInvalida } from './Invitado'
import { ModalImagen } from '../../components/ModalImagen'
import { leerCargosPublicos, type CargosPublicos } from '../../lib/data/compartirCargos'
import { esVideoPath } from '../../lib/fotos'
import { etiquetaTipo } from '../../lib/scoring'
import { formatearFechaHora } from '../../lib/tiempo'
import { supabase } from '../../lib/supabase'
import type { EvidenciaPunto } from '../../lib/evidencias'
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
 * Las FOTOS se firman al GENERAR el enlace, con la sesión del Líder (la misma
 * con la que el detalle de la evaluación las muestra) y quedan guardadas en el
 * reporte con un vencimiento largo: así la pantalla pública, que corre sin
 * sesión, sólo tiene que usar la URL. Sólo si el enlace no las trae —los
 * generados antes de este cambio— se firman acá con sesión anónima, que es el
 * respaldo.
 *
 * Firma una por ruta y no el bucket entero: sólo las que trae ESTE reporte.
 * Si una foto no se puede cargar, desaparece y el punto sigue leyéndose.
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

  // Respaldo: si el enlace NO trae las fotos firmadas (los enlaces generados
  // antes de firmar al compartir), se firman acá con sesión anónima. Con el
  // enlace actual esto no corre: las URLs vienen en el propio reporte.
  useEffect(() => {
    if (!paquete) return
    if (Object.keys(paquete.datos.fotosFirmadas ?? {}).length) return
    const rutas = Array.from(
      new Set(paquete.datos.cargos.flatMap((cargo) => cargo.pendientes.flatMap((p) => p.fotos)))
    )
    if (!rutas.length) return
    let vivo = true
    void supabase.storage
      .from('evidencias')
      .createSignedUrls(rutas, 3600)
      .then(({ data }) => {
        if (!vivo) return
        const porRuta: Record<string, string> = {}
        for (const firmada of data ?? []) {
          // `signedUrl` (absoluta) y no `signedURL` (relativa): ver el mismo
          // detalle en `compartirCargos.ts`.
          if (firmada.signedUrl && firmada.path) porRuta[firmada.path] = firmada.signedUrl
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
  // Las URLs guardadas por versiones anteriores venían RELATIVAS
  // (`/object/sign/…`): contra el origen de la APP el navegador pedía el
  // archivo al servidor de la app (que devuelve el HTML de la SPA) y la foto
  // salía vacía. Si la URL no trae host, se le antepone el de Storage.
  const aAbsoluta = (url: string) =>
    url.startsWith('/') ? `${import.meta.env.VITE_SUPABASE_URL}/storage/v1${url}` : url
  const urls: Record<string, string> = {}
  for (const [ruta, url] of Object.entries({ ...(datos.fotosFirmadas ?? {}), ...fotos })) {
    urls[ruta] = aAbsoluta(url)
  }

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
          <BloqueCargo key={`${cargo.cargo}-${i}`} cargo={cargo} fotos={urls} />
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

/**
 * Un ítem que falló: cada punto con SU observación y SUS fotos debajo.
 *
 * Van DENTRO de la fila del punto y no en una sección aparte al final: con
 * tres puntos anotados, la lista separada repetía el nombre del punto tres
 * veces y había que cruzar dos bloques para saber qué foto era de qué.
 */
function Pendiente({ pendiente, fotos }: { pendiente: PendienteCargo; fotos: Record<string, string> }) {
  /** La evidencia de un punto: se busca por nombre, que es como se imprime la fila. */
  const evidenciaDe = (check: string) => pendiente.evidencias.find((e) => e.punto === check)
  /** Las fotos de una evidencia que se pudieron firmar al abrir el enlace. */
  const firmadasDe = (evidencia: EvidenciaPunto | undefined): string[] =>
    (evidencia?.fotos ?? []).filter((ruta) => fotos[ruta])
  /** La foto abierta a pantalla completa: la misma clave que usa el detalle. */
  const [abierta, setAbierta] = useState<string | null>(null)
  /**
   * Miniaturas como en el detalle: cuadritos chicos que abren al tocar.
   *
   * No se pega la foto grande en la fila: con treinta fotos eso convertiría la
   * bitácora en un carrete, y lo que hace falta es poder RECORRER los
   * pendientes y abrir sólo la que interesa.
   */
  const grilla = (rutas: string[]) => (
    <div className="mt-1.5 grid grid-cols-4 gap-1.5 sm:grid-cols-6">
      {rutas.map((ruta) => (
        <button
          key={ruta}
          type="button"
          onClick={() => setAbierta(ruta)}
          aria-label={esVideoPath(ruta) ? 'Reproducir video' : 'Ampliar evidencia'}
          className="relative block min-w-0"
        >
          {/* El video se pinta como `<video>` (no como `<img>`): así trae su
              primer cuadro de póster. El tipo se colige de la extensión del
              path: una URL firmada no trae el contentType. */}
          {esVideoPath(ruta) ? (
            <>
              <video
                src={fotos[ruta]}
                preload="metadata"
                muted
                playsInline
                className="aspect-square w-full rounded-md border border-slate-200 object-cover transition-transform hover:scale-110"
              />
              <span aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center">
                <span className="grid h-7 w-7 place-items-center rounded-full bg-slate-900/60 text-white">
                  <Play className="h-3.5 w-3.5" />
                </span>
              </span>
            </>
          ) : (
            <img
              src={fotos[ruta]}
              alt="Evidencia"
              loading="lazy"
              // Una foto que no carga (URL vencida, archivo borrado) no debe
              // dejar un cuadro vacío en medio de la bitácora: desaparece y el
              // punto sigue leyéndose con su observación.
              onError={(e) => {
                e.currentTarget.style.display = 'none'
              }}
              className="aspect-square w-full rounded-md border border-slate-200 object-cover transition-transform hover:scale-110"
            />
          )}
        </button>
      ))}
    </div>
  )

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
              {pendiente.checks.map((check, i) => {
                const evidencia = evidenciaDe(check)
                const observacion = evidencia?.comentario.trim() ?? ''
                const delPunto = firmadasDe(evidencia)
                return (
                  <Fragment key={`${check}-${i}`}>
                    <tr className="border-t border-slate-100 align-top">
                      <td className="py-1.5 pr-2 font-medium text-slate-700">{check}</td>
                      <td className="py-1.5 pr-2 font-bold text-red-600">NO APROBADO</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums text-slate-700">
                        {pendiente.puntos[i] == null ? '—' : formatearNumero(pendiente.puntos[i])}
                      </td>
                      <td className="py-1.5">
                        <ChipHistorial h={pendiente.historial[check]} />
                      </td>
                    </tr>
                    {/* La observación y las fotos del punto, pegadas a su
                        fila: sin esto había que cruzar la tabla con una lista
                        de abajo que repetía el nombre del punto. */}
                    {observacion || delPunto.length ? (
                      <tr>
                        <td colSpan={4} className="pb-2.5 pl-3 align-top">
                          {observacion ? (
                            <p className="text-xs leading-relaxed text-slate-600">{observacion}</p>
                          ) : null}
                          {delPunto.length ? grilla(delPunto) : null}
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                )
              })}
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
        <>
          <p className="mt-2 text-xs font-medium text-slate-600">
            Ítem completo ({etiquetaTipo(pendiente.tipo)}) · {formatearNumero(pendiente.perdidos)} puntos no
            cumplidos
          </p>
          {/* Cada evidencia del ítem con SU observación y SUS fotos juntas:
              acá el punto es el ítem entero, así que no hay nombre que
              repetir. */}
          {pendiente.evidencias.map((evidencia, i) => {
            const observacion = evidencia.comentario.trim()
            const delPunto = firmadasDe(evidencia)
            if (!observacion && !delPunto.length) return null
            return (
              <div key={`${evidencia.checkId ?? 'item'}-${i}`} className="mt-2 rounded-lg bg-white px-2.5 py-2">
                {observacion ? <p className="text-xs leading-relaxed text-slate-600">{observacion}</p> : null}
                {delPunto.length ? grilla(delPunto) : null}
              </div>
            )
          })}
        </>
      )}
      {/* El mismo visor del detalle: rueda para zoom, arrastre y65vh. Es un
          componente puro —sin sesión ni Supabase— por eso puede vivir en una
          pantalla de invitado; lo único que se dejó afuera es el botón de
          «dibujar sobre la foto», que es una edición y acá no se edita nada. */}
      <ModalImagen
        src={abierta ? (fotos[abierta] ?? null) : null}
        esVideo={!!abierta && esVideoPath(abierta)}
        alt="Evidencia"
        onClose={() => setAbierta(null)}
      />
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
