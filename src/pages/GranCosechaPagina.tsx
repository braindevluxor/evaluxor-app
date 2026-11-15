import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Eye, Plus, Trash2 } from 'lucide-react'
import { avisar } from '../lib/aviso'
import { Button, ButtonIcon, EmptyState, Field, Input, SkeletonFilas, Spinner } from '../components/ui'
import { PortalCabecera } from '../components/PortalCabecera'
import {
  cargarContenidoPagina,
  guardarContenidoPagina,
  subirFotoPagina,
  validarContenido,
  type ContenidoPagina,
  type EquipoPagina,
  type FotoPagina,
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
 * Cuatro tarjetas, un solo botón «Guardar»: todo se publica de una vez, con
 * la validación de `validarContenido` explicando en pantalla lo que el
 * `check` de la base rechazaría. Las fotos se suben solas al bucket
 * público, pero su URL recién se guarda en la base al tocar Guardar.
 */
export function GranCosechaPaginaPage() {
  const [contenido, setContenido] = useState<ContenidoPagina | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [subiendo, setSubiendo] = useState<FotoPagina | null>(null)

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

  const subir = async (slot: FotoPagina, archivo: File | undefined, urlActual: string) => {
    if (!archivo) return
    setSubiendo(slot)
    try {
      const url = await subirFotoPagina(slot, archivo, urlActual)
      setContenido((c) => {
        if (!c) return c
        if (slot === 'fondo') return { ...c, hero: { ...c.hero, fondo: url } }
        return { ...c, imagenes: { ...c.imagenes, [slot]: url } }
      })
      avisar('Foto subida. Tocá «Guardar» para publicarla.')
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'No se pudo subir la foto.', 'error')
    } finally {
      setSubiendo(null)
    }
  }

  const cambiarHero = (campo: keyof HeroPagina, valor: string) =>
    setContenido((c) => (c ? { ...c, hero: { ...c.hero, [campo]: valor } } : c))

  /** Vuelve la foto a la que trae la página por defecto. */
  const quitarFoto = (slot: FotoPagina) =>
    setContenido((c) => {
      if (!c) return c
      if (slot === 'fondo') return { ...c, hero: { ...c.hero, fondo: '' } }
      return { ...c, imagenes: { ...c.imagenes, [slot]: '' } }
    })

  const cambiarPremio = (i: number, campo: keyof PremioPagina, valor: string) =>
    setContenido((c) =>
      c ? { ...c, premios: c.premios.map((p, j) => (j === i ? { ...p, [campo]: valor } : p)) } : c
    )
  const agregarPremio = () =>
    setContenido((c) => (c ? { ...c, premios: [...c.premios, { puesto: '', descripcion: '' }] } : c))
  const quitarPremio = (i: number) =>
    setContenido((c) => (c ? { ...c, premios: c.premios.filter((_, j) => j !== i) } : c))

  const cambiarEquipo = (i: number, campo: keyof EquipoPagina, valor: string) =>
    setContenido((c) =>
      c ? { ...c, equipos: c.equipos.map((e, j) => (j === i ? { ...e, [campo]: valor } : e)) } : c
    )
  const agregarEquipo = () =>
    setContenido((c) => (c ? { ...c, equipos: [...c.equipos, { nombre: '', sucursal: '' }] } : c))
  const quitarEquipo = (i: number) =>
    setContenido((c) => (c ? { ...c, equipos: c.equipos.filter((_, j) => j !== i) } : c))

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
                etiqueta="Fondo del hero"
                url={contenido.hero.fondo}
                ocupado={subiendo === 'fondo'}
                onArchivo={(archivo) => void subir('fondo', archivo, contenido.hero.fondo)}
                onQuitar={() => quitarFoto('fondo')}
              />
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

          <Tarjeta
            titulo="Equipos participantes"
            descripcion="Si la lista queda vacía, la página oculta la sección entera."
          >
            <div className="flex justify-end">
              <Button
                variant="secondary"
                className="min-h-[34px] px-3 py-1.5 text-xs"
                onClick={agregarEquipo}
              >
                <Plus className="h-4 w-4" />
                Agregar equipo
              </Button>
            </div>
            {!contenido.equipos.length ? (
              <p className="mt-3 rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                Ningún equipo publicado: la sección no aparece en la página.
              </p>
            ) : (
              <ul className="mt-3 space-y-3">
                {contenido.equipos.map((e, i) => (
                  <li
                    key={i}
                    className="grid gap-3 rounded-xl border border-slate-100 bg-slate-50 p-3 sm:grid-cols-[1fr_1fr_auto]"
                  >
                    <Field label="Equipo">
                      <Input
                        value={e.nombre}
                        onChange={(ev) => cambiarEquipo(i, 'nombre', ev.target.value)}
                        placeholder="Equipo Frescura"
                      />
                    </Field>
                    <Field label="Sucursal">
                      <Input
                        value={e.sucursal}
                        onChange={(ev) => cambiarEquipo(i, 'sucursal', ev.target.value)}
                        placeholder="Luxor Central"
                      />
                    </Field>
                    <div className="flex items-end">
                      <ButtonIcon
                        variant="danger"
                        onClick={() => quitarEquipo(i)}
                        title="Quitar equipo"
                        aria-label={`Quitar equipo ${i + 1}`}
                      >
                        <Trash2 className="h-5 w-5" />
                      </ButtonIcon>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Tarjeta>

          <Tarjeta
            titulo="Imágenes"
            descripcion="Las tres fotos de los rounds. Sin foto propia, la página usa las que ya trae."
          >
            <div className="grid gap-4 sm:grid-cols-3">
              {(['round1', 'round2', 'round3'] as const).map((slot) => (
                <CampoFoto
                  key={slot}
                  etiqueta={`Round ${slot.slice(-1)}`}
                  url={contenido.imagenes[slot]}
                  ocupado={subiendo === slot}
                  onArchivo={(archivo) => void subir(slot, archivo, contenido.imagenes[slot])}
                  onQuitar={() => quitarFoto(slot)}
                />
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
  ocupado,
  onArchivo,
  onQuitar
}: {
  etiqueta: string
  url: string
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
          La que ya trae la página
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
