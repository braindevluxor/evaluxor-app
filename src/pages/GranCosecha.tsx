import { useCallback, useEffect, useState } from 'react'
import { FileText, Droplet, Pencil, Plus, Trash2, TrendingUp, Video } from 'lucide-react'
import { avisar } from '../lib/aviso'
import {
  Badge,
  Button,
  ButtonIcon,
  CampoFoto,
  Confirmar,
  EmptyState,
  Field,
  FotoAmpliable,
  Input,
  Modal,
  Select,
  SkeletonFilas,
  Spinner,
  Textarea
} from '../components/ui'
import { PortalCabecera } from '../components/PortalCabecera'
import { chipPastel } from '../lib/diseno'
import { useAuth } from '../context/AuthContext'
import {
  CATEGORIAS_GRAN_COSECHA,
  ACEPTA_ADJUNTOS,
  ESTADOS,
  MAX_ADJUNTO_BYTES,
  TIPOS_BITACORA,
  actualizarProyecto,
  claveDeMiembro,
  crearProyecto,
  eliminarProyecto,
  etiquetaPeriodo,
  formatoBytes,
  historialAvances,
  listarBitacora,
  listarProyectos,
  listarTrabajadoresEquipo,
  periodosRecientes,
  quitarAdjunto,
  quitarRiego,
  regarProyecto,
  rechazoDeAdjunto,
  riegosDeLaCosecha,
  subirAdjunto,
  subirFotoProyecto,
  validarEquipo,
  type AdjuntoProyecto,
  type CambiosProyecto,
  type EstadoProyecto,
  type FilaBitacora,
  type MiembroEquipo,
  type ProyectoGranCosecha,
  type RiegosProyecto,
  type TrabajadorNomina
} from '../lib/data/granCosecha'
import { cedula, esActivo, nombreCompleto } from '../lib/data/colaboradores'

/**
 * GRAN COSECHA: EL CONCURSO INTERNO DE PROYECTOS
 * ---------------------------------------------
 * El trimestre se elige en la barra superior (mismo portal que Unidades y
 * Bonos), la lista ocupa el cuerpo y el detalle se despliega debajo de la
 * fila, como en Seguimiento: no se pierde de vista la lista mientras se mira
 * un proyecto.
 *
 * Quién puede qué lo decide el componente con la MISMA regla que la RLS
 * (`puede_gran_cosecha`): cualquiera crea el suyo, JUEZ y LÍDER editan
 * cualquiera —y los dos también lo BORRAN, con la misma cerradura en la
 * política `delete`. La base es la segunda cerradura —si el componente se
 * equivoca, ni el `update` ni el `delete` pasan—, así que acá sólo se trata
 * de no ofrecer un botón que va a fallar.
 *
 * Todo cambio a un proyecto pasa por `actualizarProyecto` (la bitácora la
 * escribe el trigger, no ésta pantalla) y el borrado por `eliminarProyecto`,
 * que además retira las dos fotos del bucket.
 */

const PERIODOS = periodosRecientes(8)

/** El color del chip de estado, con la paleta pastel del sistema. */
function chipDeEstado(estado: EstadoProyecto) {
  return chipPastel(ESTADOS[estado].chip)
}

/** `2026-11-08T10:00:00Z` → `8/11/2026 10:00`, sin depender del locale. */
function fechaCorta(iso: string): string {
  const f = new Date(iso)
  if (Number.isNaN(f.getTime())) return iso
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(f.getDate())}/${p(f.getMonth() + 1)}/${f.getFullYear()} ${p(f.getHours())}:${p(f.getMinutes())}`
}

/**
 * La columna «Identificación» de la tabla del equipo.
 *
 * En `miembros` la cédula sólo la traen los trabajadores SIN cuenta —los
 * demás entran por su usuario de EvaLuxor y su cédula no viaja en la fila—,
 * así que: cédula donde hay, y «Cuenta en EvaLuxor» donde no. No se inventa
 * un dato que la fila no tiene.
 */
function identidadDe(m: MiembroEquipo): string {
  if (m.dni != null) return `${m.nacionalidad ?? 'V'}-${m.dni}`
  return 'Cuenta en EvaLuxor'
}

/**
 * Cuánto dura la gota del "regar", en ms. La animación tiene que verse
 * completa aunque la RPC conteste antes.
 */
const DURACION_GOTA_MS = 1400

/**
 * La planta del riego, en SÓLIDO (relleno) — el mismo gesto que el Sprout
 * del menú «Proyectos», dibujado acá porque el de lucide es de TRAZO: al
 * rellenarlo desaparecen el tallo y la línea de tierra y sólo queda una
 * hoja suelta.
 */
function Planta({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false">
      {/* El tallo: trazo grueso con punta redonda —se lee sólido a 14 px. */}
      <path
        d="M12 21C12 17.5 12.2 13.5 13 10.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      {/* Las DOS hojas, cerradas y llenas. */}
      <path d="M13 10.2C13.5 6.7 16.5 4.2 20.5 4.2C20.5 8.2 17.5 11.1 13 10.2Z" fill="currentColor" />
      <path d="M11.4 14.2C10.9 10.7 7.9 8.2 3.9 8.2C3.9 12.2 6.9 15.1 11.4 14.2Z" fill="currentColor" />
    </svg>
  )
}

/**
 * El riego como el "Me gusta" de Facebook: UN SOLO control —la planta y su
 * número— SIN fondo ni textos sueltos (ni «X riegos», ni «Ya regaste», ni
 * «Quitar»: eran tres rótulos para lo mismo).
 *
 * Cómo se lee y se usa:
 *  * En reposo, la planta en GRIS con su número. Apretar REGA: la secuencia
 *    GOTA → PLANTA verde (`riego-gota` / `riego-planta`).
 *  * Regado, la planta en VERDE. Apretar de nuevo QUITA el riego propio y
 *    la planta vuelve gris — el mismo botón, con `aria-pressed` y `title`
 *    diciendo el estado (y un `sr-only` con el número, para que el lector
 *    de pantalla no vea sólo un «2»).
 *  * La gota dura mientras la RPC contesta y, como mínimo,
 *    `DURACION_GOTA_MS`, para que la secuencia siempre se vea completa.
 *
 * `datos` en `null` es "la RPC de conteo no está disponible" (bloque de
 * riegos sin aplicar): no se pinta nada — un cero inventado sería peor que
 * el silencio.
 */
export function RiegoProyecto({
  datos,
  ocupado,
  onRegar,
  onQuitar
}: {
  datos: { riegos: number; mio: boolean } | null
  ocupado: boolean
  onRegar: () => void
  onQuitar: () => void
}) {
  const [fase, setFase] = useState<'gota' | null>(null)
  const [desde, setDesde] = useState(0)

  // La gota no se corta ni si la RPC tarda: se retira recién cuando pasó el
  // tiempo mínimo Y el pedido terminó. Si FALLÓ, la planta vuelve GRIS —el
  // estado de «todavía no regué»—; si salió bien, el estado `mio` ya llegó
  // y la planta sale verde.
  useEffect(() => {
    if (fase !== 'gota') return
    const quedan = Math.max(0, desde + DURACION_GOTA_MS - Date.now())
    const reloj = window.setTimeout(() => setFase((f) => (ocupado ? f : null)), quedan)
    return () => window.clearTimeout(reloj)
  }, [fase, ocupado, desde])

  if (!datos) return null
  const n = datos.riegos
  // La gota sólo mientras dura la animación; después, la planta.
  const icono =
    fase === 'gota' ? (
      <Droplet className="riego-gota h-3.5 w-3.5 text-sky-500" fill="currentColor" strokeWidth={1} />
    ) : (
      <Planta
        className={`riego-planta h-3.5 w-3.5 ${datos.mio ? 'text-green-600' : 'text-slate-500'}`}
      />
    )
  return (
    <Button
      variant="ghost"
      className="min-h-[30px] gap-1.5 px-2 py-1 text-xs"
      disabled={ocupado}
      aria-pressed={datos.mio}
      title={datos.mio ? 'Quitar tu riego de este proyecto' : 'Regar este proyecto'}
      onClick={() => {
        // El mismo botón conmuta: regar si aún no, quitar si ya es mío.
        if (datos.mio) {
          onQuitar()
          return
        }
        setDesde(Date.now())
        setFase('gota')
        onRegar()
      }}
    >
      {/* Lo que oye el lector de pantalla: el estado y el número, porque lo
          visible es sólo el ícono y la cifra. */}
      <span className="sr-only">
        {`${datos.mio ? 'Quitar tu riego' : 'Regar este proyecto'}: ${n} riegos`}
      </span>
      {icono}
      <span
        aria-hidden
        className={`tabular-nums ${datos.mio ? 'text-green-700' : 'text-slate-600'}`}
      >
        {n}
      </span>
    </Button>
  )
}

export function GranCosechaPage() {
  const { profile } = useAuth()

  const [proyectos, setProyectos] = useState<ProyectoGranCosecha[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [recargar, setRecargar] = useState(0)
  const [periodo, setPeriodo] = useState(() => periodoDeHoy())

  /**
   * Los riegos por proyecto (conteo + si YO ya regué). `null` mientras la
   * RPC no responda —bloque de riegos sin aplicar—: sin dato no se pinta
   * chip alguno, no un cero inventado.
   */
  const [riegos, setRiegos] = useState<Record<string, RiegosProyecto> | null>(null)
  /** El proyecto que se está regando ahora: no se mandan dos en paralelo. */
  const [regando, setRegando] = useState<string | null>(null)

  /** El proyecto cuyo detalle está abierto. */
  const [abierto, setAbierto] = useState<string | null>(null)
  const [bitacora, setBitacora] = useState<Record<string, FilaBitacora[]>>({})

  /**
   * El id del proyecto que se está editando DENTRO de su propio detalle: no
   * hay modal de edición (el panel ya tiene todo lo demás), así que el modo
   * ver/editar vive acá y se le pasa al detalle como prop.
   */
  const [editando, setEditando] = useState<string | null>(null)
  const [nuevo, setNuevo] = useState(false)
  const [avanceDe, setAvanceDe] = useState<ProyectoGranCosecha | null>(null)

  /**
   * El proyecto que se está por borrar. Es destructivo y no se puede
   * deshacer —la bitácora y los riegos salen en cascada—, así que nunca se
   * borra de un toque: siempre pasa por el `Confirmar`.
   */
  const [aBorrar, setABorrar] = useState<ProyectoGranCosecha | null>(null)
  const [borrando, setBorrando] = useState(false)

  const esJuezOLider = profile?.rol === 'JUEZ' || profile?.rol === 'LIDER'
  const puedeEditar = (p: ProyectoGranCosecha): boolean =>
    Boolean(profile) && (esJuezOLider || p.creador_id === profile?.id)

  const cargar = useCallback(async () => {
    setError(null)
    try {
      // Los riegos viajan con la lista pero NO la mandan a fallar: si su RPC
      // no existe, la pantalla sirve igual y sólo quedan sin chip.
      const [lista, mapa] = await Promise.all([listarProyectos(periodo), riegosDeLaCosecha()])
      setProyectos(lista)
      setRiegos(mapa)
    } catch (e) {
      // Sin proyectos no se juran: `null` es "no sé", `[]` es "no hay".
      setProyectos(null)
      setError(e instanceof Error ? e.message : 'No se pudieron cargar los proyectos.')
    }
  }, [periodo])

  useEffect(() => {
    void cargar()
  }, [cargar, recargar])

  /** La bitácora se pide recién al abrir el detalle: nadie la mira de paso. */
  const abrirDetalle = async (p: ProyectoGranCosecha) => {
    const yaEsta = abierto === p.id
    setAbierto(yaEsta ? null : p.id)
    if (yaEsta || bitacora[p.id]) return
    try {
      const filas = await listarBitacora(p.id)
      setBitacora((prev) => ({ ...prev, [p.id]: filas }))
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'No se pudo leer la bitácora.', 'error')
    }
  }

  /**
   * Aplica cambios y dice si salió bien: el detalle lo necesita para cerrar
   * su modo de edición SÓLO cuando se guardó (si falla, el formulario se
   * queda con lo escrito para reintentar).
   *
   * No cierra la edición por su cuenta: un cambio de Estado desde el mismo
   * panel también pasa por acá, y tirar abajo lo que se está escribiendo
   * por guardar un campo aparte sería perder trabajo.
   */
  const guardar = async (cambios: CambiosProyecto, id: string): Promise<boolean> => {
    try {
      await actualizarProyecto(id, cambios)
      avisar('Proyecto actualizado.')
      setRecargar((n) => n + 1)
      setBitacora({})
      setAvanceDe(null)
      return true
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'No se pudo guardar el cambio.', 'error')
      return false
    }
  }

  /**
   * Publica una foto EN EL MOMENTO (mismo criterio que el Estado): no pasa
   * por el formulario y NO limpia la bitácora —una foto no es un movimiento
   * del proyecto—, así que el detalle se queda con su historial puesto.
   */
  const publicarFoto = async (cambios: Pick<CambiosProyecto, 'imagen' | 'foto'>, id: string) => {
    try {
      await actualizarProyecto(id, cambios)
      avisar('Foto publicada: ya aparece en la landing.')
      setRecargar((n) => n + 1)
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'No se pudo guardar la foto.', 'error')
    }
  }

  const crear = async (entrada: Parameters<typeof crearProyecto>[0]) => {
    if (!profile) return
    try {
      await crearProyecto(entrada, profile.id)
      avisar('Proyecto presentado.')
      setNuevo(false)
      setRecargar((n) => n + 1)
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'No se pudo presentar el proyecto.', 'error')
      throw e
    }
  }

  /**
   * Borrar el proyecto DE VERDAD: la fila sale sola y con ella, en cascada,
   * la bitácora y los riegos; las dos fotos las retira `eliminarProyecto`
   * del bucket. Si RLS no deja (no es tuyo ni sos Juez/Líder) no hay error:
   * la función devuelve cero filas y avisa — sin ese control el «borrado»
   * habría mentido.
   */
  const borrar = async () => {
    if (!aBorrar || borrando) return
    setBorrando(true)
    try {
      await eliminarProyecto(aBorrar)
      avisar(`«${aBorrar.titulo}» fue borrado del concurso.`)
      setABorrar(null)
      // El detalle apuntaba a una fila que ya no existe: se cierra y se
      // limpia su bitácora en memoria antes de recargar la lista.
      setAbierto(null)
      setBitacora({})
      setRecargar((n) => n + 1)
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'No se pudo borrar el proyecto.', 'error')
    } finally {
      setBorrando(false)
    }
  }

  /**
   * Guarda la lista de archivos de la presentación. Devuelve si salió bien:
   * el detalle la necesita para borrar el archivo del bucket SÓLO después
   * de que la fila quedó sin él — así nunca queda un enlace roto.
   */
  const guardarAdjuntos = async (adjuntos: AdjuntoProyecto[], id: string): Promise<boolean> => {
    try {
      await actualizarProyecto(id, { adjuntos })
      avisar(adjuntos.length ? 'Archivos de la presentación guardados.' : 'Archivo quitado de la presentación.')
      setRecargar((n) => n + 1)
      return true
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'No se pudieron guardar los archivos.', 'error')
      return false
    }
  }

  /**
   * Regar un proyecto: la base guarda el `usuario` de QUIEN aprieta (la
   * misma clave que mandan los portales), así que no hay forma de regar por
   * otro. Idempotente: si ya estaba regado, la respuesta lo dice y el
   * conteo no se mueve.
   */
  const regar = async (id: string) => {
    if (regando) return
    setRegando(id)
    try {
      const r = await regarProyecto(id)
      setRiegos((prev) => ({ ...(prev ?? {}), [id]: { riegos: r.riegos, mio: true } }))
      avisar(
        r.ya_regado
          ? 'Ya habías regado este proyecto: el conteo sigue igual.'
          : '¡Regado! Tu riego ya cuenta en el proyecto.',
        'aviso'
      )
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'No se pudo regar el proyecto.', 'error')
    } finally {
      setRegando(null)
    }
  }

  /**
   * Quitar el PROPIO riego: el "deshacer" del me gusta. Misma llave que
   * `regar` —un pedido por tarjeta a la vez—; sólo se deshace el mío, que
   * es lo único que la función acepta.
   */
  const quitar = async (id: string) => {
    if (regando) return
    setRegando(id)
    try {
      const r = await quitarRiego(id)
      setRiegos((prev) => ({ ...(prev ?? {}), [id]: { riegos: r.riegos, mio: false } }))
      avisar(
        r.quitado
          ? 'Riego quitado: el proyecto ya no cuenta con el tuyo.'
          : 'No había un riego tuyo en este proyecto: el conteo sigue igual.',
        'aviso'
      )
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'No se pudo quitar el riego.', 'error')
    } finally {
      setRegando(null)
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      {/* El trimestre del concurso y el alta viven en la barra, igual que en
          Unidades: el título lo trae la cabecera de la consola. */}
      <PortalCabecera>
        <Field label="Trimestre" className="w-40">
          <Select
            className="h-10"
            value={periodo}
            onChange={(e) => setPeriodo(e.target.value)}
            aria-label="Trimestre del concurso"
          >
            {PERIODOS.map((p) => (
              <option key={p} value={p}>
                {etiquetaPeriodo(p)}
              </option>
            ))}
          </Select>
        </Field>
        <Button
          className="min-h-[34px] px-3 py-1.5 text-xs"
          onClick={() => setNuevo(true)}
          title="Presentar un proyecto"
        >
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">Nuevo proyecto</span>
        </Button>
      </PortalCabecera>

      {error ? (
        <div>
          <EmptyState title="No se pudieron cargar los proyectos" subtitle={error} />
          <Button className="mt-3" variant="secondary" onClick={() => setRecargar((n) => n + 1)}>
            Reintentar
          </Button>
        </div>
      ) : proyectos === null ? (
        <SkeletonFilas n={5} />
      ) : !proyectos.length ? (
        <EmptyState
          title="Todavía no hay proyectos en este trimestre"
          subtitle="Cuando alguien presente su propuesta con un equipo de al menos tres, aparece acá."
        />
      ) : (
        <ul className="space-y-3">
          {proyectos.map((p) => (
            <li key={p.id} className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-bold text-slate-800">{p.titulo}</h3>
                    <span
                      className="rounded-full px-2.5 py-1 text-xs font-semibold"
                      style={{ background: chipDeEstado(p.estado).fondo, color: chipDeEstado(p.estado).tinta }}
                    >
                      {ESTADOS[p.estado].etiqueta}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {p.miembros.length} en el equipo · presentado el {fechaCorta(p.created_at)}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {/* El riego vive en la tarjeta: chip con el conteo y su
                      botón, el mismo que despliega el detalle. */}
                  <RiegoProyecto
                    datos={riegos ? (riegos[p.id] ?? { riegos: 0, mio: false }) : null}
                    ocupado={regando === p.id}
                    onRegar={() => void regar(p.id)}
                    onQuitar={() => void quitar(p.id)}
                  />
                  {puedeEditar(p) ? (
                    <>
                      <Button
                        variant="ghost"
                        className="text-xs"
                        onClick={() => {
                          setAvanceDe(p)
                        }}
                      >
                        <TrendingUp className="h-4 w-4" />
                        Avance
                      </Button>
                      {/* Borrar sólo para quien puede editar (misma regla
                          que la RLS del delete) y SIEMPRE con confirmación:
                          la bitácora y los riegos salen en cascada. Sólo el
                          ICONO y sin fondo —el rojo del trazo y el hover son
                          todo lo que hace falta para reconocerlo—; el nombre
                          lo dan `title` y `aria-label`. */}
                      <ButtonIcon
                        variant="dangerGhost"
                        onClick={() => setABorrar(p)}
                        title="Borrar el proyecto del concurso"
                        aria-label="Borrar el proyecto del concurso"
                      >
                        <Trash2 className="h-4 w-4" />
                      </ButtonIcon>
                    </>
                  ) : null}
                  <Button variant="ghost" className="text-xs" onClick={() => void abrirDetalle(p)}>
                    {abierto === p.id ? 'Cerrar' : 'Ver detalle'}
                  </Button>
                </div>
              </div>

              {/* La barra de avance: el número y la barra dicen lo mismo, y la
                  nota del último avance va debajo para que el % no se lea sin
                  contexto. */}
              <div className="mt-3">
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>Avance</span>
                  <span className="font-bold tabular-nums text-slate-700">{p.avance}%</span>
                </div>
                <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-2 rounded-full bg-primary transition-all"
                    style={{ width: `${Math.max(0, Math.min(100, p.avance))}%` }}
                    aria-hidden
                  />
                </div>
                {p.avance_nota ? (
                  <p className="mt-1.5 text-xs text-slate-500">«{p.avance_nota}»</p>
                ) : null}
              </div>

              {abierto === p.id ? (
                <DetalleProyecto
                  // El `key` cambia con el MODO: al entrar a editar el panel
                  // se remonta con los valores guardados, y mientras se
                  // edita un refresco de la fila no pisa lo escrito.
                  key={`${p.id}:${editando === p.id}`}
                  proyecto={p}
                  bitacora={bitacora[p.id] ?? null}
                  puedeEditar={puedeEditar(p)}
                  editando={editando === p.id}
                  onFoto={(cambios) => void publicarFoto(cambios, p.id)}
                  onEstado={(estado) => void guardar({ estado }, p.id)}
                  onAvance={() => setAvanceDe(p)}
                  onEditar={() => setEditando(p.id)}
                  onGuardar={(cambios) => guardar(cambios, p.id)}
                  onAdjuntos={(adjuntos) => guardarAdjuntos(adjuntos, p.id)}
                  onCerrar={() => setEditando(null)}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {/* El alta sigue en modal —es un formulario nuevo, no hay panel que
          reusar—; la EDICIÓN vive dentro del propio detalle. */}
      {nuevo ? (
        <FormProyecto onGuardar={crear} onCerrar={() => setNuevo(false)} />
      ) : null}

      {avanceDe ? (
        <FormAvance
          proyecto={avanceDe}
          onGuardar={(avance, nota) => void guardar({ avance, avance_nota: nota }, avanceDe.id)}
          onCerrar={() => setAvanceDe(null)}
        />
      ) : null}

      {/* Borrar es definitivo: se lleva el proyecto, su bitácora y sus riegos.
          Por eso el texto también ofrece el camino que NO borra nada
          (cancelarlo), que es el que sirve si sólo hace falta sacarlo. */}
      <Confirmar
        open={aBorrar != null}
        texto={`¿Borrar «${aBorrar?.titulo ?? ''}»? Sale el proyecto, todo su historial de avances y sus riegos, y no se puede deshacer. Si sólo querés sacarlo del concurso conservando la historia, cancelalo en su detalle en vez de borrarlo.`}
        textoConfirmar="Sí, borrar"
        onConfirm={() => void borrar()}
        onCancel={() => setABorrar(null)}
      />
    </div>
  )
}

/** El trimestre de hoy, para el selector inicial. */
function periodoDeHoy(): string {
  const hoy = new Date()
  return `${hoy.getFullYear()}-T${Math.floor(hoy.getMonth() / 3) + 1}`
}

/**
 * Los archivos de la PRESENTACIÓN: documentos y videos del proyecto.
 *
 * Se guardan solas al subirlas (igual que las fotos), así que este bloque no
 * depende del modo edición: el que puede editar sube y quita desde acá, y el
 * que sólo mira los abre o baja. Sin archivos y sin permiso, ni se dibuja.
 */
function AdjuntosProyecto({
  adjuntos,
  puedeEditar,
  subiendo,
  onSubir,
  onQuitar
}: {
  adjuntos: AdjuntoProyecto[]
  puedeEditar: boolean
  /** Qué se está subiendo, para no mandar dos tandas en paralelo. */
  subiendo: string | null
  onSubir: (archivos: File[]) => void
  onQuitar: (adjunto: AdjuntoProyecto) => void
}) {
  if (!puedeEditar && !adjuntos.length) return null
  return (
    <div>
      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
        Presentación{adjuntos.length ? ` · ${adjuntos.length}` : ''}
      </span>
      {adjuntos.length ? (
        <ul className="mt-1.5 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
          {adjuntos.map((a) => {
            const esVideo = a.tipo.startsWith('video/')
            return (
              <li key={a.ruta} className="flex items-center gap-3 px-3 py-2">
                {esVideo ? (
                  <Video className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                ) : (
                  <FileText className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-slate-700">{a.nombre}</span>
                  <span className="block text-xs text-slate-500">
                    {esVideo ? 'Video' : 'Documento'} · {formatoBytes(a.bytes)}
                  </span>
                </span>
                <a
                  href={a.url}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold text-primary-700 transition-colors hover:bg-primary-50"
                >
                  Abrir
                </a>
                {puedeEditar ? (
                  <button
                    type="button"
                    onClick={() => onQuitar(a)}
                    disabled={subiendo != null}
                    title={`Quitar ${a.nombre}`}
                    aria-label={`Quitar ${a.nombre}`}
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                ) : null}
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="mt-1.5 text-xs text-slate-500">
          Sin archivos todavía: subí el video o los documentos con los que el equipo presenta el proyecto.
        </p>
      )}

      {puedeEditar ? (
        <>
          <input
            type="file"
            multiple
            accept={ACEPTA_ADJUNTOS}
            disabled={subiendo != null}
            onChange={(e) => {
              const archivos = Array.from(e.target.files ?? [])
              // Se limpia YA: así se puede volver a elegir el mismo archivo
              // si el primer intento falló (sin esto no dispara onChange).
              e.target.value = ''
              onSubir(archivos)
            }}
            aria-label="Subir archivos de la presentación"
            className="mt-2 block w-full text-xs text-slate-500 file:mr-3 file:cursor-pointer file:rounded-full file:border-0 file:bg-primary-50 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-primary-700 disabled:opacity-50"
          />
          {subiendo ? (
            <p className="mt-1.5 flex items-center gap-2 text-xs text-slate-500">
              <Spinner size={14} /> Subiendo {subiendo}…
            </p>
          ) : null}
          <p className="mt-1.5 text-[11px] text-slate-400">
            Videos y documentos (PDF, Word, Excel, PowerPoint), hasta {formatoBytes(MAX_ADJUNTO_BYTES)} por archivo.
            Se publican en la landing del concurso.
          </p>
        </>
      ) : null}
    </div>
  )
}

/**
 * Lo que se despliega bajo la fila: descripción, fotos, equipo, estado y
 * bitácora — y TAMBIÉN la edición.
 *
 * No hay modal de edición: apretar «Editar» convierte a este mismo panel en
 * el formulario (título, trimestre, descripción y equipo) con «Guardar
 * cambios» / «Cancelar» al pie. El estado y las fotos siguen guardándose solos,
 * como siempre: sólo lo que necesita un formulario entra en modo edición.
 *
 * El cambio de modo se hace con un `key` distinto en el llamador
 * (`id + modo`), así que al entrar a editar el panel se remonta con los
 * valores guardados y mientras se edita, un refresco de la fila (un cambio
 * de estado, por ejemplo) NO pisa lo que se está escribiendo.
 */
function DetalleProyecto({
  proyecto,
  bitacora,
  puedeEditar,
  editando,
  onFoto,
  onEstado,
  onAvance,
  onEditar,
  onGuardar,
  onAdjuntos,
  onCerrar
}: {
  proyecto: ProyectoGranCosecha
  bitacora: FilaBitacora[] | null
  puedeEditar: boolean
  /** `true` = el panel está en modo formulario (edición en el lugar). */
  editando: boolean
  /** Guarda una foto EN EL MOMENTO (misma inmediación que el Estado). */
  onFoto: (cambios: Pick<CambiosProyecto, 'imagen' | 'foto'>) => void
  onEstado: (estado: EstadoProyecto) => void
  onAvance: () => void
  onEditar: () => void
  /** Guarda el formulario del modo edición; devuelve si salió bien. */
  onGuardar: (cambios: CambiosProyecto) => Promise<boolean>
  /** Guarda la lista de archivos de la presentación; devuelve si salió bien. */
  onAdjuntos: (adjuntos: AdjuntoProyecto[]) => Promise<boolean>
  /** Sale del modo edición sin guardar. */
  onCerrar: () => void
}) {
  const avances = bitacora ? historialAvances(bitacora) : []
  const [subiendoFoto, setSubiendoFoto] = useState<string | null>(null)
  /** El archivo que se está subiendo ahora (para no mandar dos en paralelo). */
  const [subiendoAdjunto, setSubiendoAdjunto] = useState<string | null>(null)

  // Sólo viven en modo edición; el `key` del llamador garantiza que arranquen
  // con los valores guardados al entrar y que un refresco de la fila no las
  // pise mientras se escribe.
  const [titulo, setTitulo] = useState(proyecto.titulo)
  const [descripcion, setDescripcion] = useState(proyecto.descripcion)
  const [periodo, setPeriodo] = useState(proyecto.periodo)
  const [categoria, setCategoria] = useState(proyecto.categoria ?? '')
  const [sucursal, setSucursal] = useState(proyecto.sucursal ?? '')
  const [elegidos, setElegidos] = useState<MiembroEquipo[]>(proyecto.miembros)
  const [guardandoEdicion, setGuardandoEdicion] = useState(false)

  const equipoProblema = validarEquipo(elegidos)
  const tituloVacio = !titulo.trim()
  const sinGuardar = tituloVacio || equipoProblema !== null

  /** Guarda el formulario y sale del modo edición sólo si salió bien. */
  const guardarEdicion = async () => {
    if (sinGuardar || guardandoEdicion) return
    setGuardandoEdicion(true)
    const ok = await onGuardar({
      titulo: titulo.trim(),
      descripcion: descripcion.trim(),
      periodo,
      miembros: elegidos,
      categoria: categoria || null,
      sucursal: sucursal.trim()
    })
    setGuardandoEdicion(false)
    // Si falló (permiso, red, bloque sin aplicar) el formulario se queda con
    // lo escrito: reintentar no debería empezar de cero.
    if (ok) onCerrar()
  }

  /** Sube la foto elegida y la publica de una vez, sin pasar por el form. */
  const subirFoto = async (campo: 'imagen' | 'foto', archivo: File | undefined) => {
    if (!archivo) return
    setSubiendoFoto(campo)
    try {
      const url = await subirFotoProyecto(
        archivo,
        campo === 'imagen' ? (proyecto.imagen ?? '') : (proyecto.foto ?? '')
      )
      if (campo === 'imagen') onFoto({ imagen: url })
      else onFoto({ foto: url })
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'No se pudo subir la foto.', 'error')
    } finally {
      setSubiendoFoto(null)
    }
  }

  /**
   * Sube un archivo de la presentación y lo agrega a la lista.
   *
   * El formato y el tamaño se cortan ACÁ, antes de subir un megabyte, con
   * mensaje propio: ni el tipo rechazado ni el límite del bucket dicen nada
   * útiles en el error crudo del servidor.
   */
  const subirAdjuntosA = async (archivos: File[]) => {
    if (!archivos.length || subiendoAdjunto) return
    // Se valida TODO antes de subir nada: si uno no entra, no se sube ninguno.
    const rechazo = archivos.map((archivo) => rechazoDeAdjunto(archivo)).find(Boolean)
    if (rechazo) {
      avisar(rechazo, 'error')
      return
    }
    setSubiendoAdjunto(archivos.length === 1 ? `«${archivos[0].name}»` : `${archivos.length} archivos`)
    try {
      // En serie y guardando lo que vaya saliendo: si la tercera falla, las
      // dos primeras quedan publicadas en vez de colgadas en el bucket.
      const nuevos: AdjuntoProyecto[] = []
      let fallo: unknown = null
      for (const archivo of archivos) {
        try {
          nuevos.push(await subirAdjunto(proyecto.id, archivo))
        } catch (e) {
          fallo = e
          break
        }
      }
      if (nuevos.length) await onAdjuntos([...(proyecto.adjuntos ?? []), ...nuevos])
      if (fallo) throw fallo
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'No se pudo subir el archivo.', 'error')
    } finally {
      setSubiendoAdjunto(null)
    }
  }

  /**
   * Quita un archivo: PRIMERO la fila y DESPUÉS el del bucket (sin cortar
   * si eso falla). Al revés quedaría un enlace roto apuntando a un archivo
   * que ya no existe; al derecho, como mucho, un archivo huérfano.
   */
  const quitarAdjuntoA = async (adjunto: AdjuntoProyecto) => {
    const quedan = (proyecto.adjuntos ?? []).filter((a) => a.ruta !== adjunto.ruta)
    const ok = await onAdjuntos(quedan)
    if (ok) await quitarAdjunto(adjunto).catch(() => null)
  }

  return (
    <div className="mt-4 space-y-4 rounded-xl bg-slate-50 p-4">
      {/* MODO EDICIÓN: los mismos campos que traía el modal, ahora adentro
          del panel. MODO LECTURA: la descripción, tal cual se publica. */}
      {editando ? (
        <>
          <div className="grid gap-3 sm:grid-cols-[1fr_13rem]">
            <Field
              label="Título"
              hint={tituloVacio ? 'Escribí el título del proyecto.' : undefined}
              hintClassName="font-semibold text-amber-700"
            >
              <Input
                value={titulo}
                onChange={(e) => setTitulo(e.target.value)}
                placeholder="Ej.: Huerto vertical en la tienda"
                aria-label="Título del proyecto"
              />
            </Field>
            <Field label="Trimestre">
              <Select
                value={periodo}
                onChange={(e) => setPeriodo(e.target.value)}
                aria-label="Trimestre del proyecto"
              >
                {PERIODOS.map((p) => (
                  <option key={p} value={p}>
                    {etiquetaPeriodo(p)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          {/* Lo que la web pinta en la tarjeta: la categoría (badge,
              franja de color y filtro) y el área (el pin del mapa). */}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Categoría" hint="La que muestra la web: badge, color y filtro.">
              <Select
                value={categoria}
                onChange={(e) => setCategoria(e.target.value)}
                aria-label="Categoría del proyecto"
              >
                <option value="">Sin categoría</option>
                {CATEGORIAS_GRAN_COSECHA.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Sucursal o área" hint="El pin del mapa en la web.">
              <Input
                value={sucursal}
                onChange={(e) => setSucursal(e.target.value)}
                placeholder="Ej.: CENDIS & Sucursales"
                aria-label="Sucursal o área del proyecto"
              />
            </Field>
          </div>
          <Field label="Descripción" hint="Qué proponen hacer y en qué consiste el proyecto.">
            <Textarea
              rows={4}
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              aria-label="Descripción del proyecto"
            />
          </Field>
        </>
      ) : proyecto.descripcion ? (
        <p className="whitespace-pre-wrap text-sm text-slate-700">{proyecto.descripcion}</p>
      ) : (
        <p className="text-sm text-slate-500">Sin descripción.</p>
      )}

      {/* Las DOS fotos, con subida directa: como el Estado, se guardan al
          tocar y no hace falta abrir el formulario de edición. Sin permiso
          de edición sólo se muestran; sin fotos ni permiso, ni se dibuja. */}
      {puedeEditar || proyecto.imagen || proyecto.foto ? (
        <div>
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
            Fotos
          </span>
          {puedeEditar ? (
            <>
              <div className="mt-1.5 grid gap-4 sm:grid-cols-2">
                <CampoFoto
                  etiqueta="Imagen del proyecto"
                  url={proyecto.imagen ?? ''}
                  vacio="Sin imagen: la landing usa la inicial del título"
                  cuadrada
                  ocupado={subiendoFoto === 'imagen'}
                  onArchivo={(archivo) => void subirFoto('imagen', archivo)}
                  onQuitar={() => onFoto({ imagen: '' })}
                />
                <CampoFoto
                  etiqueta="Foto del equipo"
                  url={proyecto.foto ?? ''}
                  vacio="Sin foto: no hay nada que revelar"
                  cuadrada
                  ocupado={subiendoFoto === 'foto'}
                  onArchivo={(archivo) => void subirFoto('foto', archivo)}
                  onQuitar={() => onFoto({ foto: '' })}
                />
              </div>
              <p className="mt-1.5 text-[11px] text-slate-400">
                Se guardan solas al subirlas: ya aparecen en la landing.
              </p>
            </>
          ) : (
            <div className="mt-1.5 flex flex-wrap gap-3">
              {proyecto.imagen ? (
                <figure className="w-40">
                  <FotoAmpliable
                    url={proyecto.imagen}
                    etiqueta="Imagen del proyecto"
                    className="aspect-square w-full"
                  />
                  <figcaption className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    Imagen del proyecto
                  </figcaption>
                </figure>
              ) : null}
              {proyecto.foto ? (
                <figure className="w-40">
                  <FotoAmpliable
                    url={proyecto.foto}
                    etiqueta="Foto del equipo"
                    className="aspect-square w-full"
                  />
                  <figcaption className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    Foto del equipo
                  </figcaption>
                </figure>
              ) : null}
            </div>
          )}
        </div>
      ) : null}

      {/* LA PRESENTACIÓN: los documentos y videos del equipo. Como las
          fotos, se guardan solas al subirlas y no dependen del modo
          edición; en modo sólo lectura se listan para abrir o bajar. */}
      <AdjuntosProyecto
        adjuntos={proyecto.adjuntos ?? []}
        puedeEditar={puedeEditar}
        subiendo={subiendoAdjunto}
        onSubir={subirAdjuntosA}
        onQuitar={quitarAdjuntoA}
      />

      {/* El equipo: TABLA en modo lectura —tres nombres largos en píldoras
          se apilan, y la identidad de cada uno (cédula o cuenta) quedaba sólo
          en un `title` invisible— y el SELECTOR (trabajadores de la API) en
          modo edición, el mismo que usa el alta. */}
      {editando ? (
        <SelectorEquipo
          elegidos={elegidos}
          onElegidos={setElegidos}
          problema={equipoProblema}
        />
      ) : (
        <div>
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Equipo</span>
          <div className="mt-1.5 overflow-x-auto rounded-xl border border-slate-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase text-slate-400">
                  <th className="px-4 py-3">#</th>
                  <th className="px-4 py-3">Integrante</th>
                  <th className="px-4 py-3">Identificación</th>
                </tr>
              </thead>
              <tbody>
                {proyecto.miembros.map((m, i) => (
                  <tr key={claveDeMiembro(m)} className="border-t border-slate-100">
                    <td className="px-4 py-3 tabular-nums text-slate-400">{i + 1}</td>
                    <td className="px-4 py-3 font-semibold text-slate-700">{m.nombre}</td>
                    <td className="px-4 py-3 whitespace-nowrap text-slate-500">{identidadDe(m)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* La barra del modo edición: va después del ÚLTIMO campo (el equipo)
          y antes del Estado, que se guarda solo. */}
      {editando ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 pt-3">
          <Button
            onClick={() => void guardarEdicion()}
            disabled={guardandoEdicion || sinGuardar}
            title={equipoProblema ?? undefined}
          >
            {guardandoEdicion ? <Spinner size={16} light /> : null}
            Guardar cambios
          </Button>
          <Button variant="ghost" onClick={onCerrar} disabled={guardandoEdicion}>
            Cancelar
          </Button>
        </div>
      ) : null}

      {puedeEditar ? (
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Estado" className="w-52">
            <Select
              className="h-10"
              value={proyecto.estado}
              onChange={(e) => onEstado(e.target.value as EstadoProyecto)}
              aria-label="Estado del proyecto"
            >
              {(Object.keys(ESTADOS) as EstadoProyecto[]).map((k) => (
                <option key={k} value={k}>
                  {ESTADOS[k].etiqueta}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex gap-2">
            <Button variant="secondary" className="text-xs" onClick={onAvance}>
              <TrendingUp className="h-4 w-4" />
              Registrar avance
            </Button>
            {/* En modo edición el botón sobra: la barra de arriba ya tiene
                «Guardar cambios» y «Cancelar». */}
            {editando ? null : (
              <Button variant="ghost" className="text-xs" onClick={onEditar}>
                <Pencil className="h-4 w-4" />
                Editar
              </Button>
            )}
          </div>
        </div>
      ) : null}

      <div>
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
          Bitácora · {avances.length} de {bitacora?.length ?? 0} avances
        </span>
        {bitacora === null ? (
          <p className="mt-2 flex items-center gap-2 text-sm text-slate-500">
            <Spinner size={16} /> Cargando bitácora…
          </p>
        ) : !bitacora.length ? (
          <p className="mt-2 text-sm text-slate-500">Sin movimientos todavía.</p>
        ) : (
          <ol className="mt-2 divide-y divide-slate-200">
            {bitacora.map((f) => {
              const chip = f.tipo === 'AVANCE' ? chipPastel('riesgo') : chipPastel('sinDato')
              return (
                <li key={f.id} className="flex flex-wrap items-baseline gap-2 py-2">
                  <span className="text-xs tabular-nums text-slate-500">{fechaCorta(f.created_at)}</span>
                  <span
                    className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
                    style={{ background: chip.fondo, color: chip.tinta }}
                  >
                    {TIPOS_BITACORA[f.tipo]}
                    {f.porcentaje != null ? ` ${f.porcentaje}%` : ''}
                  </span>
                  <span className="min-w-0 flex-1 text-sm text-slate-700">{f.detalle}</span>
                </li>
              )
            })}
          </ol>
        )}
      </div>
    </div>
  )
}

/**
 * El selector de EQUIPO: de DÓNDE salen los participantes.
 *
 * SÓLO de la API de trabajadores (la nómina: búsqueda al servidor desde 2
 * letras, porque son miles de filas) y de los que ya están ELEGIDOS, que
 * aparecen primeros aunque su fila no salga de la API. Los usuarios del
 * sistema NO son candidatos: no aparecen ni siquiera estando activos.
 *
 * Va en DOS lugares —el alta de proyecto y la edición dentro del detalle—,
 * por eso no guarda nada: recibe los elegidos y avisa con `onElegidos`. La
 * validación (mínimo tres, repetidos) la calcula quien lo usa y la pasa en
 * `problema`: acá sólo se muestra, para que el mensaje quede junto a lo que
 * falla.
 */
export function SelectorEquipo({
  elegidos,
  onElegidos,
  problema
}: {
  elegidos: MiembroEquipo[]
  onElegidos: (miembros: MiembroEquipo[]) => void
  /** `null` = el equipo está bien; si no, el texto a mostrar al pie. */
  problema: string | null
}) {
  const [busqueda, setBusqueda] = useState('')
  /** Trabajadores de la nómina que coincide la búsqueda (con o sin cuenta). */
  const [trabajadores, setTrabajadores] = useState<TrabajadorNomina[]>([])
  /** Hay una búsqueda en vuelo: sin esto se enseñaría «nadie coincide» a mitad de request. */
  const [buscando, setBuscando] = useState(false)
  /** Falló la última búsqueda en la nómina (bloque de SQL pendiente, red…). */
  const [errorNomina, setErrorNomina] = useState(false)

  // La nómina no se baja entera (miles de filas): la búsqueda va al servidor,
  // con debounce y recién desde 2 letras — y es la ÚNICA fuente de
  // candidatos. El error va AL TEXTO y no a un toast: dura mientras se siga
  // escribiendo y un aviso por tecla enloquecería la pantalla.
  useEffect(() => {
    const texto = busqueda.trim()
    if (texto.length < 2) {
      setTrabajadores([])
      setBuscando(false)
      setErrorNomina(false)
      return
    }
    let vivo = true
    const reloj = setTimeout(() => {
      setBuscando(true)
      listarTrabajadoresEquipo(texto)
        .then((filas) => {
          if (!vivo) return
          setTrabajadores(filas)
          setBuscando(false)
          setErrorNomina(false)
        })
        .catch(() => {
          if (!vivo) return
          setTrabajadores([])
          setBuscando(false)
          setErrorNomina(true)
        })
    }, 300)
    return () => {
      vivo = false
      clearTimeout(reloj)
    }
  }, [busqueda])

  const q = busqueda.trim().toLowerCase()

  /**
   * El texto de apoyo de una fila: la cédula si la trae, y si no, la
   * identidad que sí tiene la fila (mismo criterio que la tabla del
   * detalle). La cédula sólo la guardan los que NO tienen cuenta en EvaLuxor.
   */
  const subDe = (m: MiembroEquipo): string =>
    m.dni != null ? cedula({ nationality: m.nacionalidad ?? 'V', dni: m.dni }) : 'Cuenta en EvaLuxor'

  /** Una fila del selector: un trabajador de la API, o una fila extra (ver `extras`). */
  type Opcion = {
    clave: string
    nombre: string
    /** Qué se muestra debajo: la cédula y la sucursal. */
    sub: string
    /** La fila completa, cuando la opción sale de los elegidos. */
    miembro?: MiembroEquipo
    trabajador?: TrabajadorNomina
  }
  /** Los candidatos: SÓLO la API de trabajadores, y sólo los activos. */
  const opciones: Opcion[] = trabajadores.filter(esActivo).map((t) => ({
    clave: `w:${t.nacionalidad}-${t.dni}`,
    nombre: nombreCompleto(t),
    sub: `${cedula({ nationality: t.nacionalidad, dni: t.dni })}${t.sucursal ? ` · ${t.sucursal}` : ''}`,
    trabajador: t
  }))
  /**
   * Las filas que la lista ofrece AUNQUE no salgan de la API: los ELEGIDOS
   * (que sólo aparecerían si se los busca) y los que se deseleccionaron con
   * este panel abierto. Sin esto el equipo era invisible —«Equipo (3)» con
   * la lista mostrando a otros—, y destildar hacía desaparecer la fila, con
   * ella la forma de volver a marcarlo.
   *
   * Van PRIMEROS, así no hay que buscarlos para verlos.
   */
  const [extras, setExtras] = useState<Record<string, MiembroEquipo>>(() =>
    Object.fromEntries(elegidos.map((m) => [claveDeMiembro(m), m]))
  )

  const filasExtras: Opcion[] = Object.entries(extras)
    .filter(([clave]) => !opciones.some((o) => o.clave === clave))
    .map(([clave, miembro]) => ({ clave, nombre: miembro.nombre, sub: subDe(miembro), miembro }))

  const visibles = [...filasExtras, ...opciones].filter(
    (o) => !q || `${o.nombre} ${o.sub}`.toLowerCase().includes(q)
  )

  const alternar = (o: Opcion) => {
    const esta = (m: MiembroEquipo) => claveDeMiembro(m) === o.clave
    if (elegidos.some(esta)) {
      onElegidos(elegidos.filter((m) => !esta(m)))
      return
    }
    // Un integrante nuevo sale de la API; una fila extra vuelve con SUS
    // datos completos, cédula incluida.
    const nuevo: MiembroEquipo = o.miembro ?? {
      usuario_id: '',
      nombre: o.nombre,
      nacionalidad: o.trabajador?.nacionalidad,
      dni: o.trabajador?.dni
    }
    // Su fila queda registrada: al limpiar la búsqueda la opción dejaría de
    // salir de la API y se escondería estando elegido.
    setExtras((prev) => (prev[o.clave] ? prev : { ...prev, [o.clave]: nuevo }))
    onElegidos([...elegidos, nuevo])
  }

  return (
    <div>
      <Field
        label={`Equipo (${elegidos.length})`}
        hint="Mínimo 3 personas: se buscan entre los trabajadores de cualquier sucursal."
      >
        <Input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por nombre o cédula"
          aria-label="Buscar integrante"
        />
      </Field>

      {/* La lista PRIMERO: si hay algo que mostrar —incluidos los ya
          elegidos— se pinta, sin esperar a que la búsqueda responda. */}
      {visibles.length ? (
        <ul className="max-h-56 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200">
          {visibles.map((o) => {
            const marcado = elegidos.some((m) => claveDeMiembro(m) === o.clave)
            return (
              <li key={o.clave}>
                <label className="flex cursor-pointer items-center gap-3 px-3 py-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-primary"
                    checked={marcado}
                    onChange={() => alternar(o)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-slate-800">
                      {o.nombre}
                    </span>
                    <span className="block text-xs text-slate-500">{o.sub}</span>
                  </span>
                  {marcado ? (
                    <Badge color={1}>Equipo</Badge>
                  ) : o.trabajador ? (
                    <Badge color={0}>Trabajador</Badge>
                  ) : null}
                </label>
              </li>
            )
          })}
        </ul>
      ) : buscando ? (
        <p className="flex items-center gap-2 text-sm text-slate-500">
          <Spinner size={16} /> Buscando trabajadores…
        </p>
      ) : q.length >= 2 ? (
        <p className="text-sm text-slate-500">Nadie coincide con «{busqueda}».</p>
      ) : null}
      {errorNomina ? (
        <p className="mt-2 text-xs font-semibold text-amber-700">
          No se pudo buscar en la nómina de trabajadores — ¿el bloque de Gran Cosecha está aplicado
          en el SQL Editor?
        </p>
      ) : q.length < 2 ? (
        <p className="mt-2 text-[11px] text-slate-400">
          Escribí 2 letras o más para buscar entre los trabajadores de cualquier sucursal.
        </p>
      ) : null}
      {problema ? (
        <p className="mt-2 text-xs font-semibold text-amber-700">{problema}</p>
      ) : null}
    </div>
  )
}

/**
 * El formulario de ALTA: se presenta un proyecto nuevo.
 *
 * La EDICIÓN ya no pasa por acá — vive dentro del propio detalle
 * (`DetalleProyecto`, en modo edición), que tiene los mismos campos sin
 * abrir ventana. Acá sólo queda el alta, con el mínimo de tres validado con
 * el mismo criterio que el `check` de la base, para que el error se lea en
 * castellano y no como un 23514.
 */
function FormProyecto({
  onGuardar,
  onCerrar
}: {
  onGuardar: (entrada: Parameters<typeof crearProyecto>[0]) => Promise<void>
  onCerrar: () => void
}) {
  const [titulo, setTitulo] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [periodo, setPeriodo] = useState(periodoDeHoy())
  const [categoria, setCategoria] = useState('')
  const [sucursal, setSucursal] = useState('')
  const [elegidos, setElegidos] = useState<MiembroEquipo[]>([])
  const [imagen, setImagen] = useState('')
  const [foto, setFoto] = useState('')
  const [subiendoFoto, setSubiendoFoto] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  const equipoProblema = validarEquipo(elegidos)
  const tituloVacio = !titulo.trim()

  /** Sube la foto elegida y la deja en el estado del formulario. */
  const subirFoto = async (campo: 'imagen' | 'foto', archivo: File | undefined) => {
    if (!archivo) return
    setSubiendoFoto(campo)
    try {
      const url = await subirFotoProyecto(archivo, campo === 'imagen' ? imagen : foto)
      if (campo === 'imagen') setImagen(url)
      else setFoto(url)
      avisar('Foto subida. Tocá el botón de guardar para publicarla.')
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'No se pudo subir la foto.', 'error')
    } finally {
      setSubiendoFoto(null)
    }
  }

  return (
    <Modal
      open
      onClose={onCerrar}
      title="Nuevo proyecto"
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCerrar} disabled={guardando}>
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={guardando || tituloVacio || equipoProblema !== null}
            onClick={() => {
              setGuardando(true)
              void onGuardar({
                titulo: titulo.trim(),
                descripcion: descripcion.trim(),
                periodo,
                miembros: elegidos,
                imagen,
                foto,
                categoria: categoria || null,
                sucursal: sucursal.trim()
              })
                .catch(() => undefined)
                .finally(() => setGuardando(false))
            }}
          >
            {guardando ? 'Guardando…' : 'Presentar proyecto'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Field
          label="Título"
          hint={tituloVacio ? 'Escribí el título del proyecto.' : undefined}
          hintClassName="font-semibold text-amber-700"
        >
          <Input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Ej.: Huerto vertical en la tienda" />
        </Field>
        <Field label="Descripción" hint="Qué proponen hacer y en qué consiste el proyecto.">
          <Textarea rows={4} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} />
        </Field>
        <Field label="Trimestre">
          <Select value={periodo} onChange={(e) => setPeriodo(e.target.value)}>
            {PERIODOS.map((p) => (
              <option key={p} value={p}>
                {etiquetaPeriodo(p)}
              </option>
            ))}
          </Select>
        </Field>

        {/* Lo que la web pinta en la tarjeta: la categoría (badge, franja
            de color y filtro) y el área (el pin del mapa). Sin categoría
            la landing la muestra en «Sin categoría». */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Categoría" hint="La que muestra la web: badge, color y filtro.">
            <Select
              value={categoria}
              onChange={(e) => setCategoria(e.target.value)}
              aria-label="Categoría del proyecto"
            >
              <option value="">Sin categoría</option>
              {CATEGORIAS_GRAN_COSECHA.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Sucursal o área" hint="El pin del mapa en la web.">
            <Input
              value={sucursal}
              onChange={(e) => setSucursal(e.target.value)}
              placeholder="Ej.: CENDIS & Sucursales"
              aria-label="Sucursal o área del proyecto"
            />
          </Field>
        </div>

        {/* Las DOS fotos que la landing del participante muestra: la del
            proyecto (la cara, siempre visible) y la del equipo (se revela al
            tocarla). Ya suben al bucket público; se guardan con el botón. */}
        <div className="grid gap-4 sm:grid-cols-2">
          <CampoFoto
            etiqueta="Imagen del proyecto"
            url={imagen}
            vacio="Sin imagen: la landing usa la inicial del título"
            cuadrada
            ocupado={subiendoFoto === 'imagen'}
            onArchivo={(archivo) => void subirFoto('imagen', archivo)}
            onQuitar={() => setImagen('')}
          />
          <CampoFoto
            etiqueta="Foto del equipo"
            url={foto}
            vacio="Sin foto: no hay nada que revelar"
            cuadrada
            ocupado={subiendoFoto === 'foto'}
            onArchivo={(archivo) => void subirFoto('foto', archivo)}
            onQuitar={() => setFoto('')}
          />
        </div>

        <SelectorEquipo
          elegidos={elegidos}
          onElegidos={setElegidos}
          problema={equipoProblema}
        />
      </div>
    </Modal>
  )
}

/**
 * Registrar un avance: el porcentaje y la nota que lo acompaña.
 *
 * La nota es lo que hace legible el número dentro de un trimestre: sin ella
 * la bitácora diría «40% → 55%» y nada más sobre por qué.
 */
function FormAvance({
  proyecto,
  onGuardar,
  onCerrar
}: {
  proyecto: ProyectoGranCosecha
  onGuardar: (avance: number, nota: string) => void
  onCerrar: () => void
}) {
  const [valor, setValor] = useState(String(proyecto.avance))
  const [nota, setNota] = useState('')
  const numero = Number(valor)
  const valido = Number.isInteger(numero) && numero >= 0 && numero <= 100

  return (
    <Modal
      open
      onClose={onCerrar}
      title={`Avance · ${proyecto.titulo}`}
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCerrar}>
            Cancelar
          </Button>
          <Button type="button" disabled={!valido} onClick={() => onGuardar(numero, nota.trim())}>
            Registrar avance
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          Avance actual: <b className="tabular-nums">{proyecto.avance}%</b>
        </p>
        <Field label="Avance (0 a 100)">
          <Input
            type="number"
            min={0}
            max={100}
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            aria-label="Porcentaje de avance"
          />
        </Field>
        <Field label="Nota" hint="Qué se hizo desde el último avance. Queda en la bitácora.">
          <Textarea rows={3} value={nota} onChange={(e) => setNota(e.target.value)} />
        </Field>
        {!valido ? <p className="text-xs font-semibold text-amber-700">El avance tiene que ser un entero de 0 a 100.</p> : null}
      </div>
    </Modal>
  )
}
