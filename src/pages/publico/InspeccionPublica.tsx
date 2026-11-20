import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Play } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { esVideoPath } from '../../lib/fotos'
import { ModalImagen } from '../../components/ModalImagen'
import { Marco, VistaInvalida } from './Invitado'
import {
  leerInspeccionPublica,
  type DetalleInspeccion,
  type InspeccionPublica
} from '../../lib/data/compartirInspeccion'

/**
 * EL DETALLE PÚBLICO DE UNA INSPECCIÓN (lo que muestra el QR del PDF)
 * --------------------------------------------------------------------
 * El documento impreso deja las fotos afuera a propósito y lleva un QR que
 * apunta a ESTE enlace: acá está el detalle entero —la tabla de puntos con
 * sus comentarios y el material visual, fotos y videos— sin cuenta y desde
 * cualquier teléfono.
 *
 * Es el hermano de `/compartir/cargos/:token`, con el mismo molde: el
 * detalle viaja CONGELADO en `datos`, las fotos como RUTAS, y si el enlace
 * no trae algunas firmadas se firman acá con sesión anónima (una sesión
 * anónima sí puede firmar en Storage). Ver `compartirInspeccion.ts`.
 */
export function InspeccionPublica() {
  const { token } = useParams<{ token: string }>()
  const [paquete, setPaquete] = useState<InspeccionPublica | null>(null)
  const [cargando, setCargando] = useState(true)
  const [falla, setFalla] = useState<string | null>(null)
  const [fotos, setFotos] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!token) return
    let vivo = true
    void leerInspeccionPublica(token)
      .then((leido) => {
        if (!vivo) return
        setPaquete(leido)
        setFalla(null)
      })
      .catch((e) => {
        if (!vivo) return
        // Un corte de red no es "el enlace ya no existe": son dos cosas
        // distintas y decirle «enlace inválido» por un corte sería mentir.
        setFalla(e instanceof Error ? e.message : 'No se pudo leer el enlace')
      })
      .finally(() => {
        if (vivo) setCargando(false)
      })
    return () => {
      vivo = false
    }
  }, [token])

  // Respaldo: las rutas que el enlace NO trae firmadas (una foto subida
  // después de generar el link, o una firma que falló) se firman acá.
  useEffect(() => {
    const datos = paquete?.datos
    if (!datos) return
    const guardadas = datos.fotosFirmadas ?? {}
    const faltantes = Array.from(new Set(datos.evidencias.flatMap((e) => e.rutas))).filter(
      (ruta) => !guardadas[ruta]
    )
    if (!faltantes.length) return
    let vivo = true
    void supabase.storage
      .from('evidencias')
      .createSignedUrls(faltantes, 3600)
      .then(({ data }) => {
        if (!vivo) return
        const porRuta: Record<string, string> = {}
        for (const firma of data ?? []) {
          // `signedUrl` (absoluta) y no `signedURL` (relativa): ver el mismo
          // detalle en `compartirInspeccion.ts`.
          if (firma.signedUrl && firma.path) porRuta[firma.path] = firma.signedUrl
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
          <p className="text-sm font-semibold text-slate-500">Cargando la inspección…</p>
        </div>
      </Marco>
    )
  }

  if (falla && !paquete) return <VistaInvalida titulo="No se pudo abrir el enlace" detalle={falla} />

  if (!paquete || !paquete.datos) {
    return (
      <VistaInvalida
        titulo="Este enlace no está activo"
        detalle="El enlace fue apagado o nunca existió. Pedile a quien lo compartió que genere uno nuevo."
      />
    )
  }

  return <VistaInspeccion datos={paquete.datos} guardadas={paquete.datos.fotosFirmadas ?? {}} respaldadas={fotos} />
}

/** El encabezado con sus datos y, debajo, la tabla y las evidencias. */
function VistaInspeccion({
  datos,
  guardadas,
  respaldadas
}: {
  datos: DetalleInspeccion
  guardadas: Record<string, string>
  respaldadas: Record<string, string>
}) {
  /** La URL de una ruta: la que trajo el enlace y la que se firmó acá. */
  const urlDe = (ruta: string): string | null => guardadas[ruta] ?? respaldadas[ruta] ?? null
  /** La foto abierta a pantalla completa. */
  const [abierta, setAbierta] = useState<string | null>(null)

  const vehiculo = [
    ['Placa', datos.vehiculo.placa],
    ['Marca', datos.vehiculo.marca],
    ['Modelo', datos.vehiculo.modelo],
    ['Color', datos.vehiculo.color],
    ['Año', datos.vehiculo.anio],
    ['Kilometraje', datos.vehiculo.kilometraje],
    ['Sistema de combustible', datos.vehiculo.combustible]
  ].filter(([, valor]) => valor)

  const persona = [
    ['Cédula / RIF', datos.persona.cedula],
    ['Nombre', datos.persona.nombre],
    ['Apellido', datos.persona.apellido],
    ['Teléfono', datos.persona.telefono]
  ].filter(([, valor]) => valor)

  return (
    <Marco>
      <div className="mx-auto max-w-3xl px-4 py-8">
        {/* Encabezado */}
        <header className="border-b border-slate-200 pb-4">
          <p className="text-xs font-bold uppercase tracking-wide text-teal-700">
            Inspección de vehículo
          </p>
          <h1 className="mt-1 text-2xl font-extrabold text-slate-900">{datos.titulo}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {fechaLarga(datos.fecha)}
            {datos.evaluador ? ` · Evaluador: ${datos.evaluador}` : ''}
          </p>
        </header>

        {/* Ficha del vehículo y de la persona */}
        <section className="mt-6 grid gap-4 sm:grid-cols-2">
          {vehiculo.length ? (
            <article className="rounded-xl border border-slate-200 bg-white p-4">
              <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Vehículo</h2>
              <dl className="mt-2 space-y-1.5">
                {vehiculo.map(([etiqueta, valor]) => (
                  <div key={etiqueta} className="flex justify-between gap-3 text-sm">
                    <dt className="text-slate-500">{etiqueta}</dt>
                    <dd className="font-semibold text-slate-800">{valor}</dd>
                  </div>
                ))}
              </dl>
            </article>
          ) : null}
          {persona.length || datos.persona.firma ? (
            <article className="rounded-xl border border-slate-200 bg-white p-4">
              <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Propietario</h2>
              <dl className="mt-2 space-y-1.5">
                {persona.map(([etiqueta, valor]) => (
                  <div key={etiqueta} className="flex justify-between gap-3 text-sm">
                    <dt className="text-slate-500">{etiqueta}</dt>
                    <dd className="font-semibold text-slate-800">{valor}</dd>
                  </div>
                ))}
              </dl>
              {datos.persona.firma ? (
                <div className="mt-3">
                  <p className="text-xs font-semibold text-slate-400">Firma</p>
                  <img
                    src={datos.persona.firma}
                    alt="Firma del propietario"
                    className="mt-1 max-h-20 w-auto rounded border border-slate-100 bg-white object-contain"
                  />
                </div>
              ) : null}
            </article>
          ) : null}
        </section>

        {/* La tabla de puntos, con sus comentarios */}
        {datos.items.length ? (
          <section className="mt-6">
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Inspección / Checklist</h2>
            <div className="mt-2 overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-teal-700 text-left text-xs font-bold uppercase tracking-wide text-white">
                    <th className="px-3 py-2">Ítem</th>
                    <th className="px-3 py-2">Valor / Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {agruparPorSeccion(datos.items).map((fila, i) =>
                    fila.seccion ? (
                      <tr key={`s-${i}`}>
                        <td colSpan={2} className="border-t border-slate-200 bg-slate-100 px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-slate-600">
                          {fila.seccion}
                        </td>
                      </tr>
                    ) : (
                      <tr key={`f-${i}`} className="border-t border-slate-100">
                        <td className="px-3 py-2 text-slate-600">{fila.etiqueta}</td>
                        <td className="px-3 py-2 font-medium text-slate-800">{fila.valor}</td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {/* El material visual: fotos y videos */}
        {datos.evidencias.length ? (
          <section className="mt-6">
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Evidencias</h2>
            <div className="mt-2 space-y-3">
              {datos.evidencias.map((ev, i) => {
                const rutas = ev.rutas.filter((ruta) => urlDe(ruta))
                if (!rutas.length && !ev.pie) return null
                return (
                  <article key={`${ev.pie}-${i}`} className="rounded-xl border border-slate-200 bg-white p-3">
                    {ev.pie ? <p className="text-xs font-semibold text-slate-600">{ev.pie}</p> : null}
                    {rutas.length ? (
                      <div className="mt-2 grid grid-cols-4 gap-1.5 sm:grid-cols-6">
                        {rutas.map((ruta) => (
                          <button
                            key={ruta}
                            type="button"
                            onClick={() => setAbierta(ruta)}
                            aria-label={esVideoPath(ruta) ? 'Reproducir video' : 'Ampliar evidencia'}
                            className="relative block min-w-0"
                          >
                            {/* El video se pinta como <video> para traer su
                                póster: el tipo se colige de la extensión,
                                porque una URL firmada no trae el contentType. */}
                            {esVideoPath(ruta) ? (
                              <>
                                <video
                                  src={urlDe(ruta) ?? undefined}
                                  preload="metadata"
                                  muted
                                  playsInline
                                  className="aspect-square w-full rounded-md border border-slate-200 object-cover"
                                />
                                <span aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center">
                                  <span className="grid h-7 w-7 place-items-center rounded-full bg-slate-900/60 text-white">
                                    <Play className="h-3.5 w-3.5" />
                                  </span>
                                </span>
                              </>
                            ) : (
                              <img
                                src={urlDe(ruta) ?? undefined}
                                alt="Evidencia"
                                loading="lazy"
                                onError={(e) => {
                                  // Una foto que no carga (URL vencida, archivo
                                  // borrado) no deja un hueco: desaparece y la
                                  // evidencia sigue leyéndose con su pie.
                                  e.currentTarget.style.display = 'none'
                                }}
                                className="aspect-square w-full rounded-md border border-slate-200 object-cover transition-transform hover:scale-110"
                              />
                            )}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </article>
                )
              })}
            </div>
            <ModalImagen
              src={abierta ? urlDe(abierta) : null}
              esVideo={!!abierta && esVideoPath(abierta)}
              alt="Evidencia"
              onClose={() => setAbierta(null)}
            />
          </section>
        ) : null}

        {datos.observaciones ? (
          <section className="mt-6">
            <h2 className="text-sm font-bold uppercase tracking-wide text-slate-500">Observaciones</h2>
            <p className="mt-2 whitespace-pre-wrap rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
              {datos.observaciones}
            </p>
          </section>
        ) : null}

        <footer className="mt-8 border-t border-slate-200 pt-4 text-center text-xs text-slate-400">
          Documento generado el {fechaLarga(datos.fecha)} · EvaLuxor
        </footer>
      </div>
    </Marco>
  )
}

/**
 * Las filas de la tabla agrupadas por sección: la fila de sección va
 * ENTRERADA y las suyas debajo (mismo dibujo que el PDF).
 */
function agruparPorSeccion(items: DetalleInspeccion['items']): {
  seccion?: string
  etiqueta?: string
  valor?: string
}[] {
  const filas: { seccion?: string; etiqueta?: string; valor?: string }[] = []
  let seccionActual: string | null | undefined = null
  for (const item of items) {
    if (item.grupo !== seccionActual) {
      seccionActual = item.grupo
      if (item.grupo) filas.push({ seccion: item.grupo })
    }
    filas.push({ etiqueta: item.etiqueta, valor: item.valor })
  }
  return filas
}

/** `2026-11-12` → «12 de noviembre de 2026», sin depender del locale raro. */
function fechaLarga(fecha: string): string {
  const d = new Date(`${fecha}T00:00:00`)
  if (Number.isNaN(d.getTime())) return fecha
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' })
}
