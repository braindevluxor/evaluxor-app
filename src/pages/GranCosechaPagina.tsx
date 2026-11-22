import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronUp, Eye, Trash2 } from 'lucide-react'
import { avisar } from '../lib/aviso'
import { Button, ButtonIcon, EmptyState, Field, Input, SkeletonFilas, Spinner, Textarea } from '../components/ui'
import { PortalCabecera } from '../components/PortalCabecera'
import {
  cargarContenidoPagina,
  guardarContenidoPagina,
  subirGuiaPagina,
  subirMediaCarrusel,
  validarContenido,
  type ContenidoPagina,
  type GuiaPagina,
  type HeroPagina
} from '../lib/data/granCosechaPagina'

/**
 * LA PÁGINA DE LA GRAN COSECHA, EDITABLE DESDE LA CONSOLA
 * --------------------------------------------------------
 * `/gran-cosecha.html` es HTML estático que se sirve fuera del router de
 * React: esta pantalla es la única puerta de escritura a su contenido, y es
 * de sólo LÍDER tres veces —el item del menú, el guard de la ruta
 * (`SoloLider`) y la política `for all ... es_lider()` de la tabla—.
 *
 * TRES tarjetas, un solo botón «Guardar»: sólo lo que la landing ARENA sí
 * pinta —la bajada del hero, las guías de la postulación y el carrusel de
 * Cosechas Pasadas—. Todo se
 * publica de una vez, con la validación de `validarContenido` explicando en
 * pantalla lo que el `check` de la base rechazaría. Los archivos del
 * carrusel y las guías se suben solos al bucket público —los primeros
 * convertidos a WebP/WebM—, pero
 * su URL recién se guarda en la base al tocar Guardar.
 */
export function GranCosechaPaginaPage() {
  const [contenido, setContenido] = useState<ContenidoPagina | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  /** Avance (0 a 1) de la conversión del carrusel en curso, o `null`. */
  const [convirtiendo, setConvirtiendo] = useState<number | null>(null)

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

  const cambiarHero = (campo: keyof HeroPagina, valor: string) =>
    setContenido((c) => (c ? { ...c, hero: { ...c.hero, [campo]: valor } } : c))

  /**
   * Convierte el archivo (WebP o WebM) y lo agrega al carrusel.
   *
   * La conversión de un video tarda lo que dura el clip —se graba en tiempo
   * real—, así que `convirtiendo` lleva la barra de avance y deja el selector
   * de archivo bloqueado mientras tanto.
   */
  const agregarSlide = async (archivo: File | undefined) => {
    if (!archivo) return
    setConvirtiendo(0)
    try {
      const item = await subirMediaCarrusel(archivo, (f) => setConvirtiendo(f))
      setContenido((c) => (c ? { ...c, hero: { ...c.hero, carrusel: [...c.hero.carrusel, item] } } : c))
      avisar('Agregado al carrusel. Tocá «Guardar» para publicarlo.')
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'No se pudo convertir el archivo.', 'error')
    } finally {
      setConvirtiendo(null)
    }
  }

  /**
   * Quita un slide de la lista.
   *
   * El archivo YA SUBIDO no se borra del bucket: si el slide estaba publicado,
   * la landing sigue apuntando a esa URL hasta el próximo «Guardar», y
   * borrarla acá dejaría la página con un hueco.
   */
  const quitarSlide = (i: number) =>
    setContenido((c) =>
      c ? { ...c, hero: { ...c.hero, carrusel: c.hero.carrusel.filter((_, j) => j !== i) } } : c
    )

  /** Mueve un slide de posición: el orden del carrusel es el orden de la lista. */
  const moverSlide = (i: number, delta: -1 | 1) =>
    setContenido((c) => {
      if (!c) return c
      const lista = [...c.hero.carrusel]
      const j = i + delta
      if (j < 0 || j >= lista.length) return c
      ;[lista[i], lista[j]] = [lista[j], lista[i]]
      return { ...c, hero: { ...c.hero, carrusel: lista } }
    })

  /**
   * El texto de un slide —título, edición, categoría o pie—: es lo que la
   * landing pinta al lado de la foto. La URL no se toca desde acá (sale de
   * la subida) y todos los campos son opcionales: si faltan, la página
   * pinta un respaldo.
   */
  const cambiarCampoSlide = (
    i: number,
    campo: 'titulo' | 'edicion' | 'categoria' | 'pie',
    valor: string
  ) =>
    setContenido((c) =>
      c
        ? {
            ...c,
            hero: {
              ...c.hero,
              carrusel: c.hero.carrusel.map((s, j) => (j === i ? { ...s, [campo]: valor } : s))
            }
          }
        : c
    )

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
            titulo="Portada"
            descripcion="Lo primero que se ve en /gran-cosecha.html: el párrafo institucional del hero."
          >
            <Field label="Bajada">
              <Textarea
                rows={3}
                value={contenido.hero.bajada}
                onChange={(e) => cambiarHero('bajada', e.target.value)}
                placeholder="Programa institucional de reconocimiento, creatividad e innovación para todos los colaboradores…"
              />
            </Field>
          </Tarjeta>

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

          <Tarjeta
            titulo="Cosechas Pasadas"
            descripcion="Fotos de ediciones anteriores que rotan en la sección Cosechas Pasadas, con su título, edición, categoría y pie —lo que la página pinta al lado de la foto—. Cada imagen se convierte a WebP al subirlo."
          >
            {!contenido.hero.carrusel.length ? (
              <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                Sin fotos publicadas: la sección muestra las de ejemplo que trae la página.
              </p>
            ) : (
              <ul className="space-y-3">
                {contenido.hero.carrusel.map((item, i) => (
                  <li
                    key={item.url}
                    className="grid gap-3 rounded-xl border border-slate-100 bg-slate-50 p-3 sm:grid-cols-[10rem_1fr_auto]"
                  >
                    <div className="h-20 overflow-hidden rounded-lg border border-slate-200 bg-slate-100">
                      {item.tipo === 'video' ? (
                        <video
                          src={item.url}
                          controls
                          muted
                          preload="metadata"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <img
                          src={item.url}
                          alt={`Carrusel ${i + 1}`}
                          className="h-full w-full object-cover"
                        />
                      )}
                    </div>
                    <div className="self-center">
                      <span className="inline-block rounded-full bg-primary-50 px-2.5 py-1 text-xs font-semibold text-primary-700">
                        {item.tipo === 'video' ? 'Video WebM' : 'Imagen WebP'}
                      </span>
                      <p className="mt-1.5 text-xs text-slate-400">
                        Posición {i + 1} de {contenido.hero.carrusel.length}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 self-center">
                      <ButtonIcon
                        onClick={() => moverSlide(i, -1)}
                        disabled={i === 0}
                        title="Subir en el orden"
                        aria-label={`Subir el elemento ${i + 1} del carrusel`}
                      >
                        <ChevronUp className="h-5 w-5" />
                      </ButtonIcon>
                      <ButtonIcon
                        onClick={() => moverSlide(i, 1)}
                        disabled={i === contenido.hero.carrusel.length - 1}
                        title="Bajar en el orden"
                        aria-label={`Bajar el elemento ${i + 1} del carrusel`}
                      >
                        <ChevronDown className="h-5 w-5" />
                      </ButtonIcon>
                      <ButtonIcon
                        variant="danger"
                        onClick={() => quitarSlide(i)}
                        title="Quitar del carrusel"
                        aria-label={`Quitar el elemento ${i + 1} del carrusel`}
                      >
                        <Trash2 className="h-5 w-5" />
                      </ButtonIcon>
                    </div>
                    {/* Lo que la landing pinta al lado de la foto: badges,
                        título y pie. Todo opcional —con vacío, la página
                        pinta su respaldo—. */}
                    <div className="grid gap-3 sm:col-span-3 sm:grid-cols-2">
                      <Field label="Título">
                        <Input
                          value={item.titulo ?? ''}
                          onChange={(e) => cambiarCampoSlide(i, 'titulo', e.target.value)}
                          placeholder="Premiación Departamento Ganador y Entrega del Trofeo"
                        />
                      </Field>
                      <Field label="Edición (el badge de arriba)">
                        <Input
                          value={item.edicion ?? ''}
                          onChange={(e) => cambiarCampoSlide(i, 'edicion', e.target.value)}
                          placeholder="EDICIÓN TRIMESTRAL — COSECHA EN EQUIPO"
                        />
                      </Field>
                      <Field label="Categoría">
                        <Input
                          value={item.categoria ?? ''}
                          onChange={(e) => cambiarCampoSlide(i, 'categoria', e.target.value)}
                          placeholder="Cosecha en Equipo"
                        />
                      </Field>
                      <Field label="Pie de foto">
                        <Input
                          value={item.pie ?? ''}
                          onChange={(e) => cambiarCampoSlide(i, 'pie', e.target.value)}
                          placeholder="Qué se ve en la foto"
                        />
                      </Field>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3 space-y-2">
              <span className="block text-xs font-semibold uppercase tracking-wide text-slate-400">
                Agregar imagen o video
              </span>
              <input
                type="file"
                accept="image/*"
                disabled={convirtiendo !== null}
                onChange={(e) => {
                  void agregarSlide(e.target.files?.[0])
                  e.target.value = ''
                }}
                className="block w-full text-xs text-slate-500 file:mr-3 file:cursor-pointer file:rounded-full file:border-0 file:bg-primary-50 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-primary-700 disabled:cursor-not-allowed disabled:opacity-60"
              />
              {convirtiendo !== null ? (
                <div className="space-y-1">
                  <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{ width: `${Math.max(4, Math.round(convirtiendo * 100))}%` }}
                    />
                  </div>
                  <span className="block text-xs text-slate-500">
                    {convirtiendo > 0
                      ? `Convirtiendo… ${Math.round(convirtiendo * 100)}%`
                      : 'Convirtiendo…'}
                  </span>
                </div>
              ) : null}
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

