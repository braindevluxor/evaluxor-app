import { useCallback, useEffect, useState } from 'react'
import { Pencil, Plus, TrendingUp } from 'lucide-react'
import { avisar } from '../lib/aviso'
import {
  Badge,
  Button,
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
  crearProyecto,
  etiquetaPeriodo,
  historialAvances,
  listarBitacora,
  listarProyectos,
  periodosRecientes,
  validarEquipo,
  type CambiosProyecto,
  type EstadoProyecto,
  type FilaBitacora,
  type MiembroEquipo,
  type ProyectoGranCosecha
} from '../lib/data/granCosecha'
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
 * cualquiera. La base es la segunda cerradura —si el componente se equivoca,
 * el `update` no pasa—, así que acá sólo se trata de no ofrecer un botón que
 * va a fallar.
 *
 * Todo cambio a un proyecto pasa por `actualizarProyecto`: la bitácora la
 * escribe el trigger, no ésta pantalla.
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

export function GranCosechaPage() {
  const { profile } = useAuth()

  const [proyectos, setProyectos] = useState<ProyectoGranCosecha[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [recargar, setRecargar] = useState(0)
  const [periodo, setPeriodo] = useState(() => periodoDeHoy())

  /** El proyecto cuyo detalle está abierto. */
  const [abierto, setAbierto] = useState<string | null>(null)
  const [bitacora, setBitacora] = useState<Record<string, FilaBitacora[]>>({})

  const [editando, setEditando] = useState<ProyectoGranCosecha | null>(null)
  const [nuevo, setNuevo] = useState(false)
  const [avanceDe, setAvanceDe] = useState<ProyectoGranCosecha | null>(null)

  const [candidatos, setCandidatos] = useState<ProfileVista[] | null>(null)

  const esJuezOLider = profile?.rol === 'JUEZ' || profile?.rol === 'LIDER'
  const puedeEditar = (p: ProyectoGranCosecha): boolean =>
    Boolean(profile) && (esJuezOLider || p.creador_id === profile?.id)

  const cargar = useCallback(async () => {
    setError(null)
    try {
      setProyectos(await listarProyectos(periodo))
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
                <div className="flex items-center gap-2">
                  {puedeEditar(p) ? (
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
  onEstado,
  onAvance,
  onEditar
}: {
  proyecto: ProyectoGranCosecha
  bitacora: FilaBitacora[] | null
  puedeEditar: boolean
  onEstado: (estado: EstadoProyecto) => void
  onAvance: () => void
  onEditar: () => void
}) {
  const avances = bitacora ? historialAvances(bitacora) : []

  return (
    <div className="mt-4 space-y-4 rounded-xl bg-slate-50 p-4">
      {proyecto.descripcion ? (
        <p className="whitespace-pre-wrap text-sm text-slate-700">{proyecto.descripcion}</p>
      ) : (
        <p className="text-sm text-slate-500">Sin descripción.</p>
      )}

      <div>
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Equipo</span>
        <ul className="mt-1.5 flex flex-wrap gap-2">
          {proyecto.miembros.map((m) => (
            <li
              key={m.usuario_id}
              className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-700 ring-1 ring-slate-200"
            >
              {m.nombre}
            </li>
          ))}
        </ul>
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
  const [busqueda, setBusqueda] = useState('')
  const [guardando, setGuardando] = useState(false)

  const q = busqueda.trim().toLowerCase()
  const visibles = (candidatos ?? []).filter(
    (c) => !q || `${c.nombre} ${c.usuario}`.toLowerCase().includes(q)
  )
  const problema = titulo.trim() ? validarEquipo(elegidos) : 'Escribí el título del proyecto.'

  const alternar = (c: ProfileVista) =>
    setElegidos((prev) =>
      prev.some((m) => m.usuario_id === c.id)
        ? prev.filter((m) => m.usuario_id !== c.id)
        : [...prev, { usuario_id: c.id, nombre: c.nombre || c.usuario }]
    )

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
                miembros: elegidos
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

        <Field
          label={`Equipo (${elegidos.length})`}
          hint="Mínimo 3 personas. Se eligen de los usuarios de la empresa."
        >
          <Input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por nombre o usuario"
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
            {visibles.map((c) => {
              const marcado = elegidos.some((m) => m.usuario_id === c.id)
              return (
                <li key={c.id}>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-primary"
                      checked={marcado}
                      onChange={() => alternar(c)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-slate-800">{c.nombre}</span>
                      <span className="block text-xs text-slate-500">{c.usuario}</span>
                    </span>
                    {marcado ? <Badge color={1}>Equipo</Badge> : null}
                  </label>
                </li>
              )
            })}
          </ul>
        )}

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
