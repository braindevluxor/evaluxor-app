import { useCallback, useEffect, useState } from 'react'
import { Pencil, Plus, Trash2, TrendingUp } from 'lucide-react'
import { avisar } from '../lib/aviso'
import {
  Badge,
  Button,
  CampoFoto,
  Confirmar,
  EmptyState,
  Field,
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
  ESTADOS,
  TIPOS_BITACORA,
  actualizarProyecto,
  candidatosDeEquipoAsync,
  claveDeMiembro,
  crearProyecto,
  eliminarProyecto,
  etiquetaPeriodo,
  historialAvances,
  listarBitacora,
  listarProyectos,
  listarTrabajadoresEquipo,
  periodosRecientes,
  regarProyecto,
  riegosDeLaCosecha,
  subirFotoProyecto,
  validarEquipo,
  type CambiosProyecto,
  type EstadoProyecto,
  type FilaBitacora,
  type MiembroEquipo,
  type ProyectoGranCosecha,
  type RiegosProyecto,
  type TrabajadorNomina
} from '../lib/data/granCosecha'
import { cedula, esActivo, nombreCompleto } from '../lib/data/colaboradores'
import type { ProfileVista } from '../lib/data/usuarios'

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

/** La regadera del "regar": el like de jardín, con la temática de la cosecha. */
function Regadera({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true" focusable="false">
      <path d="M12 13h11a2 2 0 0 1 2 2v7a4 4 0 0 1-4 4h-7a4 4 0 0 1-4-4v-9z" fill="currentColor" />
      <path
        d="M15 13a4.5 4.5 0 0 1 9 0"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path d="M12 15 6 11.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="4.5" cy="10.5" r="3" fill="currentColor" />
      <circle cx="5" cy="18" r="1.4" fill="currentColor" />
      <circle cx="8" cy="21.5" r="1.1" fill="currentColor" />
    </svg>
  )
}

/**
 * El conteo de RIEGOS y su estado — en la cabecera de la tarjeta: cuántas
 * veces se regó el proyecto y si YO ya lo regué.
 *
 * Si ya regué, sólo un texto apagado y no un botón: apretar de nuevo no hace
 * nada (la PK ya cuenta el riego) y una píldora gris llenaba de más la fila.
 * `datos` en `null` es "la RPC de conteo no está disponible" (bloque de
 * riegos sin aplicar): no se pinta nada — un cero inventado sería peor que
 * el silencio.
 */
function RiegoProyecto({
  datos,
  ocupado,
  onRegar
}: {
  datos: { riegos: number; mio: boolean } | null
  ocupado: boolean
  onRegar: () => void
}) {
  if (!datos) return null
  const n = datos.riegos
  return (
    <span className="flex items-center gap-2">
      <span
        className="inline-flex items-center gap-1.5 rounded-full bg-sky-50 px-2.5 py-1 text-xs font-bold text-sky-900"
        title="Veces que regaron este proyecto"
      >
        <Regadera className="h-3.5 w-3.5" />
        <span className="tabular-nums">{n}</span>
        {n === 1 ? 'riego' : 'riegos'}
      </span>
      {datos.mio ? (
        <span
          className="inline-flex items-center gap-1 text-xs font-semibold text-slate-400"
          title="Ya regaste este proyecto"
        >
          <Regadera className="h-3.5 w-3.5" />
          Ya regaste
        </span>
      ) : (
        <Button
          className="min-h-[30px] px-2.5 py-1 text-xs"
          disabled={ocupado}
          onClick={onRegar}
          title="Regar este proyecto"
        >
          <Regadera className="h-3.5 w-3.5" />
          {ocupado ? 'Regando…' : 'Regar'}
        </Button>
      )}
    </span>
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

  const [editando, setEditando] = useState<ProyectoGranCosecha | null>(null)
  const [nuevo, setNuevo] = useState(false)
  const [avanceDe, setAvanceDe] = useState<ProyectoGranCosecha | null>(null)

  /**
   * El proyecto que se está por borrar. Es destructivo y no se puede
   * deshacer —la bitácora y los riegos salen en cascada—, así que nunca se
   * borra de un toque: siempre pasa por el `Confirmar`.
   */
  const [aBorrar, setABorrar] = useState<ProyectoGranCosecha | null>(null)
  const [borrando, setBorrando] = useState(false)

  const [candidatos, setCandidatos] = useState<ProfileVista[] | null>(null)

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

  // Los candidatos al equipo se piden una vez: sirven para crear y para
  // editar, y la lista de usuarios no cambia durante la sesión.
  useEffect(() => {
    let vivo = true
    void candidatosDeEquipoAsync()
      .then((lista) => {
        if (vivo) setCandidatos(lista)
      })
      .catch(() => {
        // Sin candidatos no se puede armar un equipo: se avisa al abrir el
        // formulario, no acá, para no ensuciar la lista con un error.
      })
    return () => {
      vivo = false
    }
  }, [])

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

  const guardar = async (cambios: CambiosProyecto, id: string) => {
    try {
      await actualizarProyecto(id, cambios)
      avisar('Proyecto actualizado.')
      setRecargar((n) => n + 1)
      setBitacora({})
      setEditando(null)
      setAvanceDe(null)
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'No se pudo guardar el cambio.', 'error')
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
                          la bitácora y los riegos salen en cascada. */}
                      <Button
                        variant="danger"
                        className="min-h-[34px] px-3 py-1.5 text-xs"
                        onClick={() => setABorrar(p)}
                        title="Borrar el proyecto del concurso"
                      >
                        <Trash2 className="h-4 w-4" />
                        <span className="hidden sm:inline">Borrar</span>
                      </Button>
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
                  proyecto={p}
                  bitacora={bitacora[p.id] ?? null}
                  puedeEditar={puedeEditar(p)}
                  onFoto={(cambios) => void publicarFoto(cambios, p.id)}
                  onEstado={(estado) => void guardar({ estado }, p.id)}
                  onAvance={() => setAvanceDe(p)}
                  onEditar={() => setEditando(p)}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {nuevo || editando ? (
        <FormProyecto
          proyecto={editando}
          candidatos={candidatos}
          onGuardar={async (entrada) => {
            if (editando) await guardar(entrada, editando.id)
            else await crear(entrada)
          }}
          onCerrar={() => {
            setNuevo(false)
            setEditando(null)
          }}
        />
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
 * Lo que se despliega bajo la fila: descripción, equipo, estado y bitácora.
 *
 * El estado se cambia con un `select` directo y no en modal: es un campo de
 * una sola tirada y el modal sólo agregaría un paso para lo que es un toque.
 */
function DetalleProyecto({
  proyecto,
  bitacora,
  puedeEditar,
  onFoto,
  onEstado,
  onAvance,
  onEditar
}: {
  proyecto: ProyectoGranCosecha
  bitacora: FilaBitacora[] | null
  puedeEditar: boolean
  /** Guarda una foto EN EL MOMENTO (misma inmediación que el Estado). */
  onFoto: (cambios: Pick<CambiosProyecto, 'imagen' | 'foto'>) => void
  onEstado: (estado: EstadoProyecto) => void
  onAvance: () => void
  onEditar: () => void
}) {
  const avances = bitacora ? historialAvances(bitacora) : []
  const [subiendoFoto, setSubiendoFoto] = useState<string | null>(null)

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

  return (
    <div className="mt-4 space-y-4 rounded-xl bg-slate-50 p-4">
      {proyecto.descripcion ? (
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
                  <img
                    src={proyecto.imagen}
                    alt="Imagen del proyecto"
                    className="aspect-square w-full rounded-xl border border-slate-200 object-cover"
                  />
                  <figcaption className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                    Imagen del proyecto
                  </figcaption>
                </figure>
              ) : null}
              {proyecto.foto ? (
                <figure className="w-40">
                  <img
                    src={proyecto.foto}
                    alt="Foto del equipo"
                    className="aspect-square w-full rounded-xl border border-slate-200 object-cover"
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

      {/* El equipo como TABLA y no como píldoras: tres nombres largos en
          píldoras se apilan y se cortan, y la tercera columna lleva la
          identidad de cada uno —la cédula del trabajador sin cuenta, o el
          hecho de que su identidad es su cuenta—, que en las píldoras sólo
          estaba en un `title` invisible. */}
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
            <Button variant="ghost" className="text-xs" onClick={onEditar}>
              <Pencil className="h-4 w-4" />
              Editar
            </Button>
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
 * El formulario de alta y de edición: es el mismo con un título distinto.
 *
 * El equipo se elige de los usuarios de la app (checkbox + búsqueda) y el
 * mínimo de tres se valida ACÁ con el mismo criterio que el `check` de la
 * base, para que el error se lea en castellano y no como un 23514.
 */
function FormProyecto({
  proyecto,
  candidatos,
  onGuardar,
  onCerrar
}: {
  proyecto: ProyectoGranCosecha | null
  candidatos: ProfileVista[] | null
  onGuardar: (entrada: Parameters<typeof crearProyecto>[0]) => Promise<void>
  onCerrar: () => void
}) {
  const [titulo, setTitulo] = useState(proyecto?.titulo ?? '')
  const [descripcion, setDescripcion] = useState(proyecto?.descripcion ?? '')
  const [periodo, setPeriodo] = useState(proyecto?.periodo ?? periodoDeHoy())
  const [elegidos, setElegidos] = useState<MiembroEquipo[]>(proyecto?.miembros ?? [])
  const [imagen, setImagen] = useState(proyecto?.imagen ?? '')
  const [foto, setFoto] = useState(proyecto?.foto ?? '')
  const [subiendoFoto, setSubiendoFoto] = useState<string | null>(null)
  const [busqueda, setBusqueda] = useState('')
  const [guardando, setGuardando] = useState(false)
  /** Trabajadores de la nómina que coincide la búsqueda (con o sin cuenta). */
  const [trabajadores, setTrabajadores] = useState<TrabajadorNomina[]>([])
  /** Falló la última búsqueda en la nómina (bloque de SQL pendiente, red…). */
  const [errorNomina, setErrorNomina] = useState(false)

  // La nómina no se baja entera (miles de filas): la búsqueda va al servidor,
  // con debounce y recién desde 2 letras. Mientras tanto, el filtro local de
  // siempre sigue cubriendo a los usuarios de la app. El error va AL TEXTO y
  // no a un toast: dura mientras se siga escribiendo y un aviso por tecla
  // enloquecería la pantalla.
  useEffect(() => {
    const texto = busqueda.trim()
    if (texto.length < 2) {
      setTrabajadores([])
      setErrorNomina(false)
      return
    }
    let vivo = true
    const reloj = setTimeout(() => {
      listarTrabajadoresEquipo(texto)
        .then((filas) => {
          if (!vivo) return
          setTrabajadores(filas)
          setErrorNomina(false)
        })
        .catch(() => {
          if (!vivo) return
          setTrabajadores([])
          setErrorNomina(true)
        })
    }, 300)
    return () => {
      vivo = false
      clearTimeout(reloj)
    }
  }, [busqueda])

  const q = busqueda.trim().toLowerCase()
  /** Una fila del selector: un usuario de la app o un trabajador de la nómina. */
  type Opcion = {
    clave: string
    nombre: string
    /** Qué se muestra debajo: el usuario, o la cédula y la sucursal. */
    sub: string
    perfil?: ProfileVista
    trabajador?: TrabajadorNomina
  }
  const opciones: Opcion[] = [
    ...(candidatos ?? []).map((c) => ({
      clave: `u:${c.id}`,
      nombre: c.nombre || c.usuario,
      sub: c.usuario,
      perfil: c
    })),
    // Sólo activos: `esActivo` es el MISMO criterio con el que se paga la nómina.
    ...trabajadores.filter(esActivo).map((t) => ({
      clave: `w:${t.nacionalidad}-${t.dni}`,
      nombre: nombreCompleto(t),
      sub: `${cedula({ nationality: t.nacionalidad, dni: t.dni })}${t.sucursal ? ` · ${t.sucursal}` : ''}`,
      trabajador: t
    }))
  ]
  const visibles = opciones.filter((o) => !q || `${o.nombre} ${o.sub}`.toLowerCase().includes(q))
  const problema = titulo.trim() ? validarEquipo(elegidos) : 'Escribí el título del proyecto.'

  const alternar = (o: Opcion) =>
    setElegidos((prev) => {
      const esta = (m: MiembroEquipo) => claveDeMiembro(m) === o.clave
      if (prev.some(esta)) return prev.filter((m) => !esta(m))
      const nuevo: MiembroEquipo = o.perfil
        ? { usuario_id: o.perfil.id, nombre: o.perfil.nombre || o.perfil.usuario }
        : {
            usuario_id: '',
            nombre: o.nombre,
            nacionalidad: o.trabajador?.nacionalidad,
            dni: o.trabajador?.dni
          }
      return [...prev, nuevo]
    })

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
      title={proyecto ? 'Editar proyecto' : 'Nuevo proyecto'}
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCerrar} disabled={guardando}>
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={guardando || problema !== null}
            onClick={() => {
              setGuardando(true)
              void onGuardar({
                titulo: titulo.trim(),
                descripcion: descripcion.trim(),
                periodo,
                miembros: elegidos,
                imagen,
                foto
              })
                .catch(() => undefined)
                .finally(() => setGuardando(false))
            }}
          >
            {guardando ? 'Guardando…' : proyecto ? 'Guardar cambios' : 'Presentar proyecto'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label="Título">
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

        <Field
          label={`Equipo (${elegidos.length})`}
          hint="Mínimo 3 personas: usuarios de la app y trabajadores de cualquier sucursal."
        >
          <Input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por nombre, usuario o cédula"
            aria-label="Buscar integrante"
          />
        </Field>

        {candidatos === null ? (
          <p className="flex items-center gap-2 text-sm text-slate-500">
            <Spinner size={16} /> Cargando usuarios…
          </p>
        ) : !visibles.length ? (
          <p className="text-sm text-slate-500">Nadie coincide con «{busqueda}».</p>
        ) : (
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
        )}
        {errorNomina ? (
          <p className="mt-2 text-xs font-semibold text-amber-700">
            No se pudo buscar en la nómina de trabajadores — ¿el bloque de Gran Cosecha está aplicado
            en el SQL Editor?
          </p>
        ) : q.length < 2 ? (
          <p className="mt-2 text-[11px] text-slate-400">
            Escribí 2 letras o más para buscar también entre los trabajadores de cualquier sucursal,
            aunque no tengan cuenta en EvaLuxor.
          </p>
        ) : null}

        {problema ? <p className="text-xs font-semibold text-amber-700">{problema}</p> : null}
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
