import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronUp, Eye, Plus, Trash2 } from 'lucide-react'
import { avisar } from '../lib/aviso'
import { Button, ButtonIcon, EmptyState, Field, Input, SkeletonFilas, Spinner } from '../components/ui'
import { PortalCabecera } from '../components/PortalCabecera'
import {
  cargarContenidoPagina,
  guardarContenidoPagina,
  subirFotoPagina,
  subirMediaCarrusel,
  validarContenido,
  type ContenidoPagina,
  type HeroPagina,
  type PremioPagina
} from '../lib/data/granCosechaPagina'

/**
 * LA PÁGINA DE LA GRAN COSECHA, EDITABLE DESDE LA CONSOLA
 * --------------------------------------------------------
 * `/gran-cosecha.html` es HTML estático que se sirve fuera del router de
 * React: esta pantalla es la única puerta de escritura a su contenido, y es
 * de sólo LÍDER tres veces —el item del menú, el guard de la ruta
 * (`SoloLider`) y la política `for all ... es_lider()` de la tabla—.
 *
 * Tres tarjetas, un solo botón «Guardar»: todo se publica de una vez, con
 * la validación de `validarContenido` explicando en pantalla lo que el
 * `check` de la base rechazaría. Las fotos y los videos del carrusel se
 * suben solos al bucket público —convertidos a WebP/WebM—, pero su URL
 * recién se guarda en la base al tocar Guardar.
 */
export function GranCosechaPaginaPage() {
  const [contenido, setContenido] = useState<ContenidoPagina | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [subiendo, setSubiendo] = useState<string | null>(null)
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

  /**
   * Sube el fondo estático del hero —el único slot fijo que queda: los
   * rounds se retiraron de la página y con ellos `round1..3`.
   */
  const subir = async (archivo: File | undefined, urlActual: string) => {
    if (!archivo) return
    setSubiendo('fondo')
    try {
      const url = await subirFotoPagina('fondo', archivo, urlActual)
      setContenido((c) => (c ? { ...c, hero: { ...c.hero, fondo: url } } : c))
      avisar('Foto subida. Tocá «Guardar» para publicarla.')
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'No se pudo subir la foto.', 'error')
    } finally {
      setSubiendo(null)
    }
  }

  const cambiarHero = (campo: keyof HeroPagina, valor: string) =>
    setContenido((c) => (c ? { ...c, hero: { ...c.hero, [campo]: valor } } : c))

  /** Vuelve el fondo al que trae la página por defecto. */
  const quitarFoto = () =>
    setContenido((c) => (c ? { ...c, hero: { ...c.hero, fondo: '' } } : c))

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

  const cambiarPremio = (i: number, campo: keyof PremioPagina, valor: string) =>
    setContenido((c) =>
      c ? { ...c, premios: c.premios.map((p, j) => (j === i ? { ...p, [campo]: valor } : p)) } : c
    )
  const agregarPremio = () =>
    setContenido((c) => (c ? { ...c, premios: [...c.premios, { puesto: '', descripcion: '' }] } : c))
  const quitarPremio = (i: number) =>
    setContenido((c) => (c ? { ...c, premios: c.premios.filter((_, j) => j !== i) } : c))

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
            titulo="Hero"
            descripcion="Lo primero que se ve en /gran-cosecha.html: lema, fechas y fondo."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Lema">
                <Input
                  value={contenido.hero.lema}
                  onChange={(e) => cambiarHero('lema', e.target.value)}
                  placeholder="COMPETENCIA INTERNA DE EXCELENCIA Y SERVICIO"
                />
              </Field>
              <Field label="Bajada">
                <Input
                  value={contenido.hero.bajada}
                  onChange={(e) => cambiarHero('bajada', e.target.value)}
                  placeholder="IMPULSANDO EL TALENTO DE NUESTRAS SUCURSALES LUXOR"
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Desde (día)">
                  <Input
                    value={contenido.hero.fechaDesde}
                    onChange={(e) => cambiarHero('fechaDesde', e.target.value)}
                    placeholder="23"
                  />
                </Field>
                <Field label="Desde (mes)">
                  <Input
                    value={contenido.hero.fechaDesdeMes}
                    onChange={(e) => cambiarHero('fechaDesdeMes', e.target.value)}
                    placeholder="AGT"
                  />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Hasta (día)">
                  <Input
                    value={contenido.hero.fechaHasta}
                    onChange={(e) => cambiarHero('fechaHasta', e.target.value)}
                    placeholder="27"
                  />
                </Field>
                <Field label="Hasta (mes)">
                  <Input
                    value={contenido.hero.fechaHastaMes}
                    onChange={(e) => cambiarHero('fechaHastaMes', e.target.value)}
                    placeholder="SEPT"
                  />
                </Field>
              </div>
            </div>
            <div className="mt-4 max-w-xs">
              <CampoFoto
                etiqueta="Fondo estático (si no hay carrusel)"
                url={contenido.hero.fondo}
                ocupado={subiendo === 'fondo'}
                onArchivo={(archivo) => void subir(archivo, contenido.hero.fondo)}
                onQuitar={() => quitarFoto()}
              />
            </div>
          </Tarjeta>

          <Tarjeta
            titulo="Carrusel del hero"
            descripcion="Imágenes y videos que rotan detrás del hero. Cada archivo se convierte al subirlo (WebP las imágenes, WebM los videos) y los videos quedan sin sonido: el carrusel es de fondo."
          >
            {!contenido.hero.carrusel.length ? (
              <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                Sin carrusel publicado: el hero muestra su fondo estático (o el degradado por defecto).
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
                accept="image/*,video/*"
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

          <Tarjeta
            titulo="Premios"
            descripcion="Una tarjeta con su trofeo por premio, en el orden en que se pintan."
          >
            <div className="flex justify-end">
              <Button
                variant="secondary"
                className="min-h-[34px] px-3 py-1.5 text-xs"
                onClick={agregarPremio}
              >
                <Plus className="h-4 w-4" />
                Agregar premio
              </Button>
            </div>
            <ul className="mt-3 space-y-3">
              {contenido.premios.map((p, i) => (
                <li
                  key={i}
                  className="grid gap-3 rounded-xl border border-slate-100 bg-slate-50 p-3 sm:grid-cols-[9rem_1fr_auto]"
                >
                  <Field label="Puesto">
                    <Input
                      value={p.puesto}
                      onChange={(e) => cambiarPremio(i, 'puesto', e.target.value)}
                      placeholder="1° PUESTO"
                    />
                  </Field>
                  <Field label="Descripción">
                    <Input
                      value={p.descripcion}
                      onChange={(e) => cambiarPremio(i, 'descripcion', e.target.value)}
                      placeholder="Qué se gana"
                    />
                  </Field>
                  <div className="flex items-end">
                    <ButtonIcon
                      variant="danger"
                      onClick={() => quitarPremio(i)}
                      title="Quitar premio"
                      aria-label={`Quitar premio ${i + 1}`}
                    >
                      <Trash2 className="h-5 w-5" />
                    </ButtonIcon>
                  </div>
                </li>
              ))}
            </ul>
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

/**
 * Una foto con su vista previa y su selector de archivo.
 *
 * El input se limpia después de elegir (`e.target.value = ''`) para poder
 * reelegir el MISMO archivo: sin eso, elegir dos veces la misma foto no
 * dispara `onChange` y el segundo intento no hace nada.
 */
function CampoFoto({
  etiqueta,
  url,
  vacio = 'La que ya trae la página',
  ocupado,
  onArchivo,
  onQuitar
}: {
  etiqueta: string
  url: string
  /** Qué dice el hueco cuando NO hay foto propia. */
  vacio?: string
  ocupado: boolean
  onArchivo: (archivo: File | undefined) => void
  onQuitar: () => void
}) {
  return (
    <div className="space-y-2">
      <span className="block text-xs font-semibold uppercase tracking-wide text-slate-400">
        {etiqueta}
      </span>
      {url ? (
        <img
          src={url}
          alt={etiqueta}
          className="h-28 w-full rounded-xl border border-slate-200 bg-slate-50 object-cover"
        />
      ) : (
        <div className="grid h-28 place-items-center rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 text-center text-xs text-slate-400">
          {vacio}
        </div>
      )}
      <div className="flex items-center gap-2">
        <input
          type="file"
          accept="image/*"
          disabled={ocupado}
          onChange={(e) => {
            onArchivo(e.target.files?.[0])
            e.target.value = ''
          }}
          className="block min-w-0 flex-1 text-xs text-slate-500 file:mr-3 file:cursor-pointer file:rounded-full file:border-0 file:bg-primary-50 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-primary-700"
        />
        {url ? (
          <button
            type="button"
            onClick={onQuitar}
            disabled={ocupado}
            className="shrink-0 rounded-full px-2 py-1 text-xs font-semibold text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50"
          >
            Quitar
          </button>
        ) : null}
      </div>
      {ocupado ? <span className="block text-xs text-slate-500">Subiendo foto…</span> : null}
    </div>
  )
}
