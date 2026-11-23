import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Eye, Trash2 } from 'lucide-react'
import { avisar } from '../lib/aviso'
import { Button, ButtonIcon, EmptyState, Field, Input, SkeletonFilas, Spinner } from '../components/ui'
import { PortalCabecera } from '../components/PortalCabecera'
import {
  cargarContenidoPagina,
  guardarContenidoPagina,
  subirGuiaPagina,
  validarContenido,
  type ContenidoPagina,
  type GuiaPagina
} from '../lib/data/granCosechaPagina'

/**
 * LA PÁGINA DE LA GRAN COSECHA, EDITABLE DESDE LA CONSOLA
 * --------------------------------------------------------
 * `/gran-cosecha.html` es HTML estático que se sirve fuera del router de
 * React: esta pantalla es la única puerta de escritura a su contenido, y es
 * de sólo LÍDER tres veces —el item del menú, el guard de la ruta
 * (`SoloLider`) y la política `for all ... es_lider()` de la tabla—.
 *
 * UNA tarjeta, un solo botón «Guardar»: las GUÍAS de la postulación —los
 * dos archivos que ofrece el modal «Postular Proyecto»—. Todo se publica de
 * una vez, con la validación de `validarContenido` explicando en pantalla
 * lo que el `check` de la base rechazaría; los archivos se suben solos al
 * bucket público, pero su URL recién se guarda en la base al tocar Guardar.
 *
 * El hero y el carrusel de Cosechas Pasadas ya NO se editan acá —la
 * landing pinta lo que la tabla ya trae—; el data layer los sigue leyendo
 * y escribiendo enteros para que «Guardar» no los pierda.
 */
export function GranCosechaPaginaPage() {
  const [contenido, setContenido] = useState<ContenidoPagina | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      setContenido(await cargarContenidoPagina())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar el contenido de la página.')
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const guardar = async () => {
    if (!contenido) return
    const problema = validarContenido(contenido)
    if (problema) {
      avisar(problema, 'aviso')
      return
    }
    setGuardando(true)
    try {
      await guardarContenidoPagina(contenido)
      avisar('Contenido guardado. La página pública ya lo muestra.')
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'No se pudo guardar el contenido.', 'error')
    } finally {
      setGuardando(false)
    }
  }

  /** El texto de una guía: sólo el nombre (la URL la pone la subida). */
  const cambiarGuia = (i: number, campo: keyof GuiaPagina, valor: string) =>
    setContenido((c) =>
      c ? { ...c, guias: c.guias.map((g, j) => (j === i ? { ...g, [campo]: valor } : g)) } : c
    )

  /**
   * Sube el archivo de una guía: la ruta es FIJA por slot, así que una
   * nueva subida reemplaza a la anterior. Si el slot estaba vacío, el
   * nombre nace del archivo —se puede editar después— y «Guardar» es lo
   * que publica la URL en la página.
   */
  const subirGuia = async (i: number, archivo: File | undefined) => {
    if (!archivo) return
    try {
      const url = await subirGuiaPagina(i as 0 | 1, archivo, contenido?.guias[i]?.url ?? '')
      setContenido((c) =>
        c
          ? {
              ...c,
              guias: c.guias.map((g, j) =>
                j === i ? { ...g, nombre: g.nombre || archivo.name.replace(/\.[^.]+$/, ''), url } : g
              )
            }
          : c
      )
      avisar('Guía subida. Tocá «Guardar» para publicarla.')
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'No se pudo subir la guía.', 'error')
    }
  }

  /**
   * Vacía el slot: el archivo YA SUBIDO no se borra del bucket — si estaba
   * publicado, la landing sigue apuntando a esa URL hasta el próximo
   * «Guardar», y borrarlo acá dejaría la página con un enlace roto.
   */
  const quitarGuia = (i: number) =>
    setContenido((c) =>
      c ? { ...c, guias: c.guias.map((g, j) => (j === i ? { nombre: '', url: '' } : g)) } : c
    )

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      {/* Ver y guardar viven en la barra, igual que en el resto de la consola:
          el título lo trae la cabecera de la consola. */}
      <PortalCabecera>
        <a
          href="/gran-cosecha.html"
          target="_blank"
          rel="noreferrer"
          title="Abrir la página pública en otra pestaña"
          className="inline-flex min-h-[34px] items-center gap-1.5 rounded-full border border-primary-200 bg-primary-50 px-3 py-1.5 text-xs font-semibold text-primary-700 transition-colors hover:bg-primary-100"
        >
          <Eye className="h-4 w-4" />
          <span className="hidden sm:inline">Ver página</span>
        </a>
        <Button
          className="min-h-[34px] px-3 py-1.5 text-xs"
          onClick={() => void guardar()}
          disabled={guardando || !contenido}
          title="Guardar y publicar"
        >
          {guardando ? <Spinner size={16} light /> : null}
          <span className="hidden sm:inline">{guardando ? 'Guardando…' : 'Guardar'}</span>
        </Button>
      </PortalCabecera>

      {cargando ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <SkeletonFilas n={4} />
        </div>
      ) : error ? (
        <div>
          <EmptyState title="No se pudo cargar el contenido" subtitle={error} />
          <Button className="mt-3" variant="secondary" onClick={() => void cargar()}>
            Reintentar
          </Button>
        </div>
      ) : contenido ? (
        <>
          <Tarjeta
            titulo="Guías del proyecto"
            descripcion="Los dos archivos que la landing ofrece como descarga dentro del modal «Postular Proyecto»: la plantilla y la guía que quien postula debe seguir. El nombre es lo que muestra el enlace; sin archivo, la guía no aparece en la página."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              {contenido.guias.map((guia, i) => (
                <div key={i} className="space-y-2 rounded-xl border border-slate-100 bg-slate-50 p-3">
                  <Field label={`Guía ${i + 1}`}>
                    <div className="flex items-center gap-2">
                      <Input
                        value={guia.nombre}
                        onChange={(e) => cambiarGuia(i, 'nombre', e.target.value)}
                        placeholder="Ej. Plantilla de presentación"
                      />
                      <ButtonIcon
                        variant="danger"
                        onClick={() => quitarGuia(i)}
                        disabled={!guia.nombre && !guia.url}
                        title="Quitar la guía"
                        aria-label={`Quitar la guía ${i + 1}`}
                      >
                        <Trash2 className="h-5 w-5" />
                      </ButtonIcon>
                    </div>
                  </Field>
                  <input
                    type="file"
                    accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
                    onChange={(e) => {
                      void subirGuia(i, e.target.files?.[0])
                      e.target.value = ''
                    }}
                    className="block w-full text-xs text-slate-500 file:mr-3 file:cursor-pointer file:rounded-full file:border-0 file:bg-primary-50 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-primary-700"
                  />
                  {guia.url ? (
                    <p className="truncate text-xs text-slate-400">
                      Archivo subido:{' '}
                      <a
                        href={guia.url}
                        target="_blank"
                        rel="noreferrer"
                        className="font-semibold text-primary-700 hover:underline"
                      >
                        {guia.nombre || 'ver guía'}
                      </a>
                    </p>
                  ) : (
                    <p className="text-xs text-slate-400">Sin archivo: la guía no aparece en la página.</p>
                  )}
                </div>
              ))}
            </div>
          </Tarjeta>

        </>
      ) : null}
    </div>
  )
}

/** El bloque de una sección, con su título y su nota al costado. */
function Tarjeta({
  titulo,
  descripcion,
  children
}: {
  titulo: string
  descripcion: string
  children: ReactNode
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <h2 className="text-xs font-bold uppercase tracking-wide text-slate-400">{titulo}</h2>
      <p className="mt-1 text-sm text-slate-500">{descripcion}</p>
      <div className="mt-4">{children}</div>
    </section>
  )
}

