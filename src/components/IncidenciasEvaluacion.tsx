import { useEffect, useState } from 'react'
import { AlertTriangle, Camera, ChevronLeft, ChevronRight, Image as ImageIcon } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { ChipsResponsables } from './EditorResponsablesIncidencia'
import { normalizarResponsables, type ResponsableIncidencia } from '../lib/data/responsablesIncidencia'
import { claveNormalizada } from '../lib/data/responsables'
import { desdeAhora } from '../lib/tiempo'
import { Skeleton, Spinner } from './ui'
import { ModalImagen } from './ModalImagen'

export interface IncidenciaFila {
  id: string
  descripcion: string
  fotos: string[]
  modulo_id: string | null
  /** Cargos responsables, tal como los cargo el evaluador. */
  responsables: ResponsableIncidencia[]
  created_at: string
  /** PostgREST devuelve las relaciones embebidas como arreglo. */
  evaluador?: { nombre: string }[] | null
  modulo?: { nombre: string }[] | null
}

/**
 * Incidencias que los evaluadores reportaron durante la visita (fuera de lo
 * programado). Solo el LÍDER las ve: es la vista de "qué encontré en la tienda
 * que no estaba en el cuestionario".
 *
 * QUÉ DEVUELVE Y QUÉ PINTA
 * ------------------------
 * El hook trae los datos y el componente pinta el botón. Así el detalle puede
 * tener UNA sola consulta y a la vez mostrar el botón y usar las mismas filas
 * para filtrar las incidencias de un cargo: si el botón y el modal del cargo
 * consultaran por su cuenta, el total del botón y el contenido del modal
 * podrían no coincidir.
 *
 * Acepta `null` porque en el detalle se llama junto a los demás hooks, antes de
 * que haya terminado de cargar la evaluación. Sin ese `null` el hook tendría que
 * ir después del `return` de "todavía no hay datos", y los hooks no se pueden
 * llamar después de un return temprano.
 */
export function useIncidenciasEvaluacion(evaluacionId: string | null) {
  const [filas, setFilas] = useState<IncidenciaFila[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)
  const [urlsFotos, setUrlsFotos] = useState<Record<string, Record<string, string>>>({})

  useEffect(() => {
    let vivo = true
    // Todavía no hay evaluación: consultar con id vacío devolvería error y dejaría
    // el botón en rojo por un problema que no existe.
    if (!evaluacionId) {
      setFilas([])
      setCargando(false)
      return () => { vivo = false }
    }
    void (async () => {
      try {
        const { data, error: queryError } = await supabase
          .from('incidencias')
          .select('id, descripcion, fotos, modulo_id, evaluador_id, created_at, responsables, modulo:modulos!incidencias_modulo_id_fkey(nombre)')
          .eq('evaluacion_id', evaluacionId)
          .order('created_at', { ascending: false })
        if (!vivo) return
        if (queryError) {
          setError(queryError.message)
          setFilas([])
          return
        }

        const incidencias = (data ?? []) as Array<{
          id: string
          descripcion: string
          fotos: string[]
          modulo_id: string
          evaluador_id: string
          created_at: string
          responsables?: unknown
          modulo?: { nombre: string }[] | null
        }>

        const evaluadorIds = [...new Set(incidencias.map((i) => i.evaluador_id).filter(Boolean))]
        const nombresPorEvaluador = new Map<string, string>()
        if (evaluadorIds.length) {
          const { data: perfiles, error: perfilError } = await supabase
            .from('profiles')
            .select('id, nombre')
            .in('id', evaluadorIds)
          if (perfilError) {
            throw perfilError
          }
          for (const perfil of perfiles ?? []) {
            if (perfil.id && perfil.nombre) nombresPorEvaluador.set(perfil.id, perfil.nombre)
          }
        }

        const filasNormalizadas: IncidenciaFila[] = incidencias.map((item) => ({
          id: item.id,
          descripcion: item.descripcion,
          fotos: item.fotos ?? [],
          modulo_id: item.modulo_id,
          // Sin normalizar, el jsonb crudo llega directo a la vista y una incidencia
          // vieja (sin la columna) rompería el render.
          responsables: normalizarResponsables(item.responsables),
          created_at: item.created_at,
          evaluador: nombresPorEvaluador.has(item.evaluador_id) ? [{ nombre: nombresPorEvaluador.get(item.evaluador_id)! }] : null,
          modulo: item.modulo ? item.modulo : null
        }))

        setFilas(filasNormalizadas)
        setError(null)
      } catch (e) {
        if (!vivo) return
        setError(e instanceof Error ? e.message : 'No se pudieron cargar las incidencias.')
        setFilas([])
      } finally {
        if (vivo) setCargando(false)
      }
    })()
    return () => {
      vivo = false
    }
  }, [evaluacionId])

  useEffect(() => {
    let vivo = true
    const paths = Array.from(new Set((filas ?? []).flatMap((fila) => fila.fotos)))
    if (!paths.length) {
      setUrlsFotos({})
      return () => { vivo = false }
    }
    void (async () => {
      try {
        const { data, error: errorFotos } = await supabase.storage.from('evidencias').createSignedUrls(paths, 3600)
        if (errorFotos) throw errorFotos
        if (!vivo) return
        const urlsPorPath = new Map<string, string>()
        for (const foto of data ?? []) {
          if (foto.path && foto.signedUrl) urlsPorPath.set(foto.path, foto.signedUrl)
        }
        const nuevasUrls: Record<string, Record<string, string>> = {}
        for (const fila of filas ?? []) {
          nuevasUrls[fila.id] = Object.fromEntries(
            fila.fotos.filter((path) => urlsPorPath.has(path)).map((path) => [path, urlsPorPath.get(path)!])
          )
        }
        setUrlsFotos(nuevasUrls)
      } catch {
        if (vivo) setUrlsFotos({})
      }
    })()
    return () => { vivo = false }
  }, [filas])

  return { filas, error, cargando, urlsFotos }
}

/** ¿Esta incidencia es de este cargo? Comparación con la clave normalizada, la
 *  misma que usa el catálogo: sin ella, «Encargado de turno» y «encargado de
 *  Turno» serían dos cargos distintos y el cargo no vería su incidencia. */
export function incidenciaEsDeCargo(incidencia: IncidenciaFila, cargo: string): boolean {
  const clave = claveNormalizada(cargo)
  if (!clave) return false
  return incidencia.responsables.some((r) => claveNormalizada(r.cargo) === clave)
}

/**
 * Botón con el total de incidencias y el modal con la lista.
 *
 * Antes esto era una sección siempre abierta en la columna izquierda, con todas
 * las incidencias escritas a mano. Ahora es un botón: el bloque sirve para enterarse
 * de cuántas hay, no para leerlas, y con veinte incidencias tapaba los cargos, que
 * es lo que el Líder está mirando.
 *
 * Y la tarjeta no se mueve: es la notificación, y una notificación que sale de
 * la vista ya no avisa de nada. Eso lo garantiza la columna de arriba, que es
 * flex de alto fijo y le deja el suyo a esta tarjeta.
 */
export function IncidenciasEvaluacion({
  filas,
  error,
  cargando,
  onAbrir
}: {
  filas: IncidenciaFila[] | null
  error: string | null
  cargando: boolean
  onAbrir?: () => void
}) {
  if (cargando) {
    return (
      <section className="shrink-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <Skeleton className="h-4 w-48" />
      </section>
    )
  }
  if (!filas) return null

  const pendientes = filas.reduce(
    (total, fila) => total + fila.responsables.filter((r) => r.porValidar).length,
    0
  )
  // La notificación lleva la hora de la más reciente, como cualquier push. Las
  // filas llegan ordenadas de más nueva a más vieja, así que la primera es la
  // última que reportó un evaluador.
  const ultima = filas.length ? desdeAhora(filas[0].created_at) : null
  const conIncidencias = filas.length > 0
  // Fotos de todas las incidencias juntas, no solo de la primera. El contador se
  // puso en vez de la miniatura: una foto de 48 px sin contexto es textura —no
  // dice si hay evidencia de algo grave o de algo de rutina—, mientras que el
  // número sí, y además tiene el ícono de imagen al lado para que el ojo lo lea
  // antes que el texto.
  const totalFotos = filas.reduce((total, fila) => total + fila.fotos.length, 0)

  return (
    /* La notificación no se mueve porque la columna de arriba es flex de alto
       fijo y esta tarjeta no cede su alto (`shrink-0`): no hay scroll que la
       empujar. Antes llevaba `sticky`, pero eso solo funcionaba porque la columna
       scrolleaba, y ese scroll ya no existe.

       El fondo es opaco y no translúcido: la lista de cargos queda pegada debajo
       y con el translúcido se transparentaba el texto entre las dos.

       APARIENCIA DE NOTIFICACIÓN PUSH
       ------------------------------
       Las cuatro cosas que la hacen leer como una push y no como una tarjeta más:
       la sombra profunda (parece flota sobre la página, no ser parte del
       documento), el ícono de app a la izquierda, la hora en gris a la derecha
       del título, y el contador de fotos. El borde se quitó: las pushes reales
       no lo tienen y el `ring` oscuro ya separa del fondo. */
    <section className="shrink-0 rounded-2xl bg-amber-50 p-3 shadow-lg shadow-slate-900/15 ring-1 ring-slate-900/10">
      {/* Botón y no un contador suelto: el número solo no indica que hay algo
          detrás, y el Líder tiene que poder abrir la lista desde ahí. */}
      <button
        type="button"
        onClick={onAbrir}
        disabled={!conIncidencias}
        aria-label={
          conIncidencias
            ? `Abrir las ${filas.length} incidencias reportadas`
            : 'Sin incidencias reportadas'
        }
        className="flex w-full items-center gap-2.5 rounded-xl p-1 text-left transition-colors hover:bg-amber-100/60 disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:bg-transparent"
      >
        {/* Ícono de app: el cuadrado de color con el símbolo es lo que el ojo
            identifica como "notificación de una app" en la barra del teléfono. */}
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-amber-500 text-white shadow-sm">
          <AlertTriangle className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate text-sm font-bold text-slate-900">
              Incidencias
            </span>
            {ultima ? (
              <span className="shrink-0 text-[11px] text-slate-400">{ultima}</span>
            ) : null}
          </span>
          <span className="mt-0.5 block text-xs text-slate-600">
            {conIncidencias
              ? `${filas.length} reportada${filas.length === 1 ? '' : 's'} por los evaluadores`
              : 'Los evaluadores no reportaron ninguna'}
          </span>
          {pendientes > 0 ? (
            <span className="mt-1 inline-block rounded-full bg-amber-200/70 px-1.5 py-0.5 text-[10px] font-bold text-amber-900">
              {pendientes} cargo{pendientes === 1 ? '' : 's'} sin verificar
            </span>
          ) : null}
        </span>
        {/* Ícono de imagen con el total, en vez de la miniatura. La miniatura se veía
            más como push pero no decía nada: una foto de 48 px sin contexto es
            textura, y el número al lado sí comunica cuánto respaldo hay detrás de
            lo que el evaluador reportó. */}
        {totalFotos > 0 ? (
          <span
            className="flex shrink-0 items-center gap-1 self-center rounded-lg bg-amber-100/80 px-1.5 py-1 text-[11px] font-bold tabular-nums text-amber-900"
            title={`${totalFotos} foto(s) adjunta(s)`}
          >
            <ImageIcon className="h-3.5 w-3.5" aria-hidden="true" />
            {totalFotos}
          </span>
        ) : null}
      </button>
      {error ? (
        <p className="mt-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          No se pudieron cargar las incidencias: {error}
        </p>
      ) : null}
    </section>
  )
}

/**
 * Lista de incidencias. La usan el modal de todas y el modal de un cargo, así que
 * recibe las filas ya filtradas y no sabe de dónde salieron.
 */
export function ListaIncidencias({
  filas,
  urlsFotos,
  vacio
}: {
  filas: IncidenciaFila[]
  urlsFotos: Record<string, Record<string, string>>
  /** Texto para el caso sin incidencias. Opcional: el modal de un cargo solo
   *  monta la lista cuando tiene algo que mostrar, así que ahí nunca se ve. */
  vacio?: string
}) {
  const [imagenAbierta, setImagenAbierta] = useState<{ incidenciaId: string; src: string } | null>(null)

  const incidenciasConFoto = filas.filter((fila) => fila.fotos.some((path) => urlsFotos[fila.id]?.[path]))
  const indiceIncidencia = imagenAbierta
    ? incidenciasConFoto.findIndex((fila) => fila.id === imagenAbierta.incidenciaId)
    : -1
  const incidenciaAbierta = indiceIncidencia >= 0 ? incidenciasConFoto[indiceIncidencia] : null

  function navegarIncidencia(direccion: -1 | 1) {
    const siguiente = incidenciasConFoto[indiceIncidencia + direccion]
    if (!siguiente) return
    const src = siguiente.fotos.map((path) => urlsFotos[siguiente.id]?.[path]).find(Boolean)
    if (src) setImagenAbierta({ incidenciaId: siguiente.id, src })
  }

  if (!filas.length) {
    if (!vacio) return null
    return <p className="rounded-xl border border-dashed border-amber-200 bg-white/70 px-3 py-3 text-sm text-amber-800/80">{vacio}</p>
  }

  return (
    <>
      <ul className="space-y-3">
        {filas.map((f) => (
          <li key={f.id} className="rounded-xl border border-amber-200 bg-white px-3 py-2.5">
            <p className="text-sm text-slate-800">{f.descripcion}</p>
            <p className="mt-1 text-[11px] text-slate-500">
              {f.evaluador?.[0]?.nombre ?? 'Evaluador'} · {f.modulo?.[0]?.nombre ?? 'Sin módulo'}
              {f.created_at
                ? ` · ${new Date(f.created_at).toLocaleString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`
                : ''}
            </p>
            {/* Los cargos van debajo del nombre, y los pendientes de validar
                aparte: el Líder necesita ver qué está verificado y qué se
                escribió a mano en la tienda. */}
            <ChipsResponsables valor={f.responsables} className="mt-1.5" />
            {f.responsables.some((r) => r.porValidar) ? (
              <p className="mt-1 text-[11px] text-amber-700">
                Hay cargos escritos sin catálogo: no se pudieron verificar.
              </p>
            ) : null}
            {f.fotos?.length ? (
              <FotosIncidencia
                paths={f.fotos}
                urls={urlsFotos[f.id] ?? {}}
                onAbrir={(src) => setImagenAbierta({ incidenciaId: f.id, src })}
              />
            ) : null}
          </li>
        ))}
      </ul>
      <ModalImagen
        src={imagenAbierta?.src ?? null}
        alt="Foto de la incidencia"
        onClose={() => setImagenAbierta(null)}
        footer={incidenciaAbierta ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => navegarIncidencia(-1)}
                disabled={indiceIncidencia <= 0}
                aria-label="Incidencia anterior"
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-slate-200 text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <p className="text-xs font-semibold text-slate-500">
                Incidencia {indiceIncidencia + 1} de {incidenciasConFoto.length}
              </p>
              <button
                type="button"
                onClick={() => navegarIncidencia(1)}
                disabled={indiceIncidencia >= incidenciasConFoto.length - 1}
                aria-label="Siguiente incidencia"
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-slate-200 text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Observación</p>
              <p className="whitespace-pre-wrap text-sm text-slate-700">{incidenciaAbierta.descripcion}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Responsable</p>
              <ChipsResponsables valor={incidenciaAbierta.responsables} className="mt-1" />
            </div>
          </div>
        ) : undefined}
      />
    </>
  )
}

/** Miniaturas con URL firmada (el bucket `evidencias` es privado). */
function FotosIncidencia({ paths, urls, onAbrir }: {
  paths: string[]
  urls: Record<string, string>
  onAbrir: (src: string) => void
}) {
  return (
    <div className="mt-2">
      <div className="mb-1.5 flex items-center gap-1 text-[11px] text-amber-700">
        <Camera className="h-3.5 w-3.5" /> {paths.length} foto(s)
      </div>
      <div className="flex flex-wrap gap-2">
        {paths.map((p) =>
          urls[p] ? (
            <button
              key={p}
              type="button"
              onClick={() => onAbrir(urls[p])}
              title="Ver foto de la incidencia"
              aria-label="Ampliar foto de la incidencia"
            >
              <img src={urls[p]} alt="Foto de la incidencia" className="h-16 w-16 rounded-lg border border-slate-200 object-cover" />
            </button>
          ) : (
            <div key={p} className="grid h-16 w-16 place-items-center rounded-lg border border-slate-200 bg-slate-50">
              <Spinner size={16} />
            </div>
          )
        )}
      </div>
    </div>
  )
}