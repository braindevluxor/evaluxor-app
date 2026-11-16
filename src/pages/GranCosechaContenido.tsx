import { useCallback, useEffect, useState } from 'react'
import { ExternalLink, Plus, Save, Trash2 } from 'lucide-react'
import { avisar } from '../lib/aviso'
import { useAuth } from '../context/AuthContext'
import { Button, EmptyState, Field, Input, Select, SkeletonFilas, Spinner, Textarea, cn } from '../components/ui'
import { PortalCabecera } from '../components/PortalCabecera'
import { etiquetaPeriodo, periodoDe, periodosRecientes } from '../lib/data/granCosecha'
import {
  contenidoDe,
  guardarContenido,
  leerContenidoEditor,
  type ClaveContenido,
  type FilaContenido,
  type ValoresContenido
} from '../lib/data/concursoPublico'

/**
 * CONTENIDO DE GRAN COSECHA: LO QUE SE PUBLICA EN /concurso
 * --------------------------------------------------------
 * La landing pública no se edita en código: bases, calendario, premios,
 * jurado, FAQ y ganadores se cargan acá y la página los lee de
 * `gran_cosecha_contenido`. Sólo JUEZ y LÍDER llegan a esta pantalla —el
 * `RequireRol` de la ruta y la RLS `puede_gran_cosecha()` son la misma
 * cerradura dicha dos veces—.
 *
 * Dos cosas que este editor respeta:
 *
 *  · Se LEE lo mismo que lee la página (`contenidoDe`, que prefiere la fila
 *    del trimestre sobre la GLOBAL) y se GUARDA en esa misma fila: lo que se
 *    ve acá es lo que se publica, sin sorpresas. Si todavía no hay fila, se
 *    crea en su lugar por defecto (GLOBAL para bases/faq/ganadores, el
 *    trimestre para el resto).
 *  · Si la tabla no existe todavía (bloque `gran-cosecha-publico.sql` sin
 *    aplicar), el error se traduce a una instrucción concreta, no a un
 *    `relation does not exist`.
 */

/** Las seis secciones de la landing, en el orden en que las muestra la página. */
interface SeccionEditor {
  clave: ClaveContenido
  titulo: string
  bajada: string
  /** GLOBAL: el contenido se publica en todos los trimestres. */
  global: boolean
}

const SECCIONES: SeccionEditor[] = [
  {
    clave: 'bases',
    titulo: 'Bases y reglamento',
    bajada: 'El texto de la sección Bases. Admite negrita, listas, tablas y saltos de línea.',
    global: true
  },
  {
    clave: 'calendario',
    titulo: 'Calendario',
    bajada: 'Los hitos del trimestre. La página los ordena por fecha sola y marca el próximo.',
    global: false
  },
  {
    clave: 'premios',
    titulo: 'Premios',
    bajada: 'Lo que lleva cada puesto. El primero es el que aparece en la vitrina del hero.',
    global: false
  },
  {
    clave: 'jurado',
    titulo: 'Jurado',
    bajada: 'Quiénes dan seguimiento a los equipos y resuelven el veredicto.',
    global: false
  },
  {
    clave: 'faq',
    titulo: 'Preguntas frecuentes',
    bajada: 'Las dudas que más llegan a los equipos, con su respuesta.',
    global: true
  },
  {
    clave: 'ganadores',
    titulo: 'Ganadores anteriores',
    bajada: 'Los trimestres ya cerrados. La página los lista en el orden en que se cargan.',
    global: true
  }
]

const PERIODOS = periodosRecientes(8)

/** El valor con que arranca una sección sin filas: nada inventado, todo vacío. */
function valorVacio(clave: ClaveContenido): ValoresContenido[ClaveContenido] {
  if (clave === 'bases') return { texto: '' }
  if (clave === 'calendario') return { hitos: [] }
  return { items: [] }
}

/**
 * En qué fila se guarda la sección que se está mirando: la misma que leería
 * la página (fila del trimestre si existe, si no la GLOBAL) y, si todavía no
 * hay ninguna, el lugar por defecto de esa clave.
 */
function periodoDestino(filas: FilaContenido[], clave: ClaveContenido, periodo: string): string {
  if (filas.some((f) => f.clave === clave && f.periodo === periodo)) return periodo
  if (filas.some((f) => f.clave === clave && f.periodo === 'GLOBAL')) return 'GLOBAL'
  return SECCIONES.find((s) => s.clave === clave)?.global ? 'GLOBAL' : periodo
}

/* --- El editor de las listas (calendario, premios, jurado, FAQ, ganadores) --- */

interface CampoLista {
  nombre: string
  etiqueta: string
  /** Campo de fecha: `input type="date"`. */
  fecha?: boolean
  /** Más de una línea: va como textarea y ocupa el ancho completo. */
  largo?: boolean
}

function EditorLista<T extends object>({
  items,
  campos,
  vacio,
  etiquetaAgregar,
  onItems
}: {
  items: T[]
  campos: CampoLista[]
  /** Mensaje cuando la lista está vacía. */
  vacio: string
  etiquetaAgregar: string
  onItems: (items: T[]) => void
}) {
  const leer = (item: T, nombre: string): string => {
    const v = (item as Record<string, unknown>)[nombre]
    return typeof v === 'string' ? v : ''
  }

  const escribir = (i: number, nombre: string, valor: string) => {
    onItems(items.map((item, j) => (j === i ? ({ ...item, [nombre]: valor } as T) : item)))
  }

  return (
    <div className="space-y-3">
      {items.length === 0 ? (
        <p className="rounded-xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">{vacio}</p>
      ) : null}
      {items.map((item, i) => (
        <div key={i} className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {campos.map((c) => (
              <Field
                key={c.nombre}
                label={c.etiqueta}
                className={c.largo ? 'sm:col-span-2' : undefined}
              >
                {c.fecha ? (
                  <Input
                    type="date"
                    value={leer(item, c.nombre)}
                    onChange={(e) => escribir(i, c.nombre, e.target.value)}
                  />
                ) : c.largo ? (
                  <Textarea
                    rows={2}
                    value={leer(item, c.nombre)}
                    onChange={(e) => escribir(i, c.nombre, e.target.value)}
                  />
                ) : (
                  <Input value={leer(item, c.nombre)} onChange={(e) => escribir(i, c.nombre, e.target.value)} />
                )}
              </Field>
            ))}
          </div>
          <div className="mt-1 flex justify-end">
            <Button
              variant="ghost"
              className="min-h-0 px-2 py-1 text-xs"
              onClick={() => onItems(items.filter((_, j) => j !== i))}
            >
              <Trash2 className="h-4 w-4" />
              Quitar
            </Button>
          </div>
        </div>
      ))}
      <Button variant="secondary" onClick={() => onItems([...items, {} as T])}>
        <Plus className="h-4 w-4" />
        {etiquetaAgregar}
      </Button>
    </div>
  )
}

/* --- La pantalla --- */

export function GranCosechaContenido() {
  const { profile } = useAuth()
  const [periodo, setPeriodo] = useState(() => periodoDe())
  const [filas, setFilas] = useState<FilaContenido[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [clave, setClave] = useState<ClaveContenido>('bases')
  const [guardando, setGuardando] = useState(false)

  const seccion = SECCIONES.find((s) => s.clave === clave) ?? SECCIONES[0]

  const cargar = useCallback(async () => {
    setError(null)
    setFilas(null)
    try {
      setFilas(await leerContenidoEditor(periodo))
    } catch (e) {
      setFilas(null)
      setError(e instanceof Error ? e.message : 'No se pudo leer el contenido del concurso.')
    }
  }, [periodo])

  useEffect(() => {
    void cargar()
  }, [cargar])

  // La misma fila que lee la página pública: si las dos coexisten, manda la
  // del trimestre, porque es la que alguien cargó para ESTE concurso.
  const destino = filas ? periodoDestino(filas, clave, periodo) : periodo
  const valor: ValoresContenido[ClaveContenido] =
    (filas ? contenidoDe(filas, clave, periodo) : null) ?? valorVacio(clave)

  /** Cambia el valor de la sección actual en memoria (sin guardar). */
  function cambiar(nuevo: ValoresContenido[ClaveContenido]) {
    setFilas((prev) => {
      const lista = prev ?? []
      const i = lista.findIndex((f) => f.clave === clave && f.periodo === destino)
      if (i >= 0) {
        const copia = [...lista]
        copia[i] = { ...copia[i], valor: nuevo }
        return copia
      }
      return [...lista, { clave, periodo: destino, valor: nuevo }]
    })
  }

  async function guardar() {
    setGuardando(true)
    try {
      await guardarContenido({ periodo: destino, clave, valor, autor: profile?.id ?? null })
      avisar('Contenido guardado. La página pública lo muestra en cuanto se recargue.')
      await cargar()
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'No se pudo guardar el contenido.', 'error')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <PortalCabecera>
        <Field label="Trimestre" className="w-40">
          <Select
            className="h-10"
            value={periodo}
            onChange={(e) => setPeriodo(e.target.value)}
            aria-label="Trimestre del contenido"
          >
            {PERIODOS.map((p) => (
              <option key={p} value={p}>
                {etiquetaPeriodo(p)}
              </option>
            ))}
          </Select>
        </Field>
        <a
          href="/concurso"
          target="_blank"
          rel="noreferrer"
          title="Abrir la página pública en otra pestaña"
          className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm font-semibold text-slate-600 transition-colors hover:border-primary-300 hover:text-primary"
        >
          <ExternalLink className="h-4 w-4" />
          <span className="hidden sm:inline">Ver página pública</span>
        </a>
      </PortalCabecera>

      {error ? (
        <div>
          <EmptyState title="No se pudo leer el contenido" subtitle={error} />
          <Button className="mt-3" variant="secondary" onClick={() => void cargar()}>
            Reintentar
          </Button>
        </div>
      ) : filas === null ? (
        <SkeletonFilas n={4} />
      ) : (
        <>
          {/* Las secciones, como pestañas: una a la vez para que el formulario
              no compita con el resto de la página. */}
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Secciones del contenido">
            {SECCIONES.map((s) => (
              <button
                key={s.clave}
                type="button"
                role="tab"
                aria-selected={s.clave === clave}
                onClick={() => setClave(s.clave)}
                className={cn(
                  'rounded-xl px-4 py-2 text-sm font-semibold transition-colors',
                  s.clave === clave
                    ? 'bg-primary text-white'
                    : 'border border-slate-200 bg-white text-slate-600 hover:border-primary-300 hover:text-primary'
                )}
              >
                {s.titulo}
              </button>
            ))}
          </div>

          <section className="rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="text-lg font-bold text-slate-800">{seccion.titulo}</h2>
            <p className="mt-1 text-sm text-slate-500">{seccion.bajada}</p>
            {destino === 'GLOBAL' ? (
              <p className="mt-2 text-xs font-semibold text-amber-700">
                Se guarda en GLOBAL: se publica en todos los trimestres.
              </p>
            ) : (
              <p className="mt-2 text-xs font-semibold text-slate-500">
                Se guarda sólo para {etiquetaPeriodo(destino)}.
              </p>
            )}

            <div className="mt-4">
              {clave === 'bases' ? (
                <BasesEditor
                  valor={(valor as ValoresContenido['bases']).texto}
                  onTexto={(texto) => cambiar({ texto })}
                />
              ) : clave === 'calendario' ? (
                <EditorLista
                  items={(valor as ValoresContenido['calendario']).hitos}
                  campos={[
                    { nombre: 'fecha', etiqueta: 'Fecha', fecha: true },
                    { nombre: 'titulo', etiqueta: 'Título del hito' },
                    { nombre: 'detalle', etiqueta: 'Detalle', largo: true }
                  ]}
                  vacio="Sin hitos todavía: la sección Calendario queda vacía en la página."
                  etiquetaAgregar="Agregar hito"
                  onItems={(hitos) => cambiar({ hitos })}
                />
              ) : clave === 'premios' ? (
                <EditorLista
                  items={(valor as ValoresContenido['premios']).items}
                  campos={[
                    { nombre: 'puesto', etiqueta: 'Puesto' },
                    { nombre: 'titulo', etiqueta: 'Título' },
                    { nombre: 'detalle', etiqueta: 'Detalle', largo: true }
                  ]}
                  vacio="Sin premios: ni la vitrina ni la sección Premios se publican."
                  etiquetaAgregar="Agregar premio"
                  onItems={(items) => cambiar({ items })}
                />
              ) : clave === 'jurado' ? (
                <EditorLista
                  items={(valor as ValoresContenido['jurado']).items}
                  campos={[
                    { nombre: 'nombre', etiqueta: 'Nombre' },
                    { nombre: 'cargo', etiqueta: 'Cargo o función' }
                  ]}
                  vacio="Sin jurado: la sección muestra su estado vacío."
                  etiquetaAgregar="Agregar miembro"
                  onItems={(items) => cambiar({ items })}
                />
              ) : clave === 'faq' ? (
                <EditorLista
                  items={(valor as ValoresContenido['faq']).items}
                  campos={[
                    { nombre: 'pregunta', etiqueta: 'Pregunta' },
                    { nombre: 'respuesta', etiqueta: 'Respuesta', largo: true }
                  ]}
                  vacio="Sin preguntas: la sección FAQ queda vacía en la página."
                  etiquetaAgregar="Agregar pregunta"
                  onItems={(items) => cambiar({ items })}
                />
              ) : (
                <EditorLista
                  items={(valor as ValoresContenido['ganadores']).items}
                  campos={[
                    { nombre: 'periodo', etiqueta: 'Trimestre (p. ej. T3 2026)' },
                    { nombre: 'proyecto', etiqueta: 'Proyecto ganador' },
                    { nombre: 'equipo', etiqueta: 'Equipo', largo: true }
                  ]}
                  vacio="Sin ganadores: la página avisa que el primero se anuncia al cerrar el trimestre."
                  etiquetaAgregar="Agregar ganador"
                  onItems={(items) => cambiar({ items })}
                />
              )}
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
              <Button onClick={() => void guardar()} disabled={guardando}>
                {guardando ? <Spinner size={16} light /> : <Save className="h-4 w-4" />}
                Guardar
              </Button>
              <span className="text-xs text-slate-500">
                Se publica en la página pública apenas se guarde.
              </span>
            </div>
          </section>
        </>
      )}
    </div>
  )
}

/** Las bases: un solo campo de texto largo, sin filas ni columnas. */
function BasesEditor({ valor, onTexto }: { valor: string; onTexto: (texto: string) => void }) {
  return (
    <div>
      <Textarea
        rows={16}
        value={valor}
        onChange={(e) => onTexto(e.target.value)}
        placeholder={'Armá acá el reglamento.\n\n- **negrita**\n- listas\n- tablas'}
        aria-label="Bases y reglamento"
      />
      <p className="mt-1.5 text-xs text-slate-500">
        Se muestra tal cual, con negrita y listas. Un salto de línea es un párrafo nuevo.
      </p>
    </div>
  )
}
