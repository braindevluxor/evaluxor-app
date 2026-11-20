import { useCallback, useEffect, useState } from 'react'
import {
  agregarFuente,
  eliminarPrograma,
  guardarNota,
  guardarPrograma,
  listarModulosFuente,
  listarProgramas,
  notasDePrograma,
  quitarFuente,
  quitarNota,
  type BonoPrograma,
  type BonoProgramaFuente,
  type ModuloFuente,
  type NotaActividad,
  type TipoFuente
} from '../../lib/data/bonosProgramas'
import { etiquetaPeriodo, periodosRecientes, type Periodicidad } from '../../lib/data/bonos'
import { listarTrabajadoresEquipo, type TrabajadorNomina } from '../../lib/data/granCosecha'
import { nombreCompleto } from '../../lib/data/colaboradores'
import { avisar } from '../../lib/aviso'
import {
  Badge,
  Button,
  ButtonIcon,
  EmptyState,
  Field,
  Input,
  Modal,
  Select,
  SkeletonFilas,
  Spinner,
  Textarea
} from '../../components/ui'
import { Pencil, Plus, StickyNote, Trash2 } from 'lucide-react'

/**
 * PROGRAMAS DE BONIFICACIÓN: DE DÓNDE SALE LA NOTA DEL BONO
 * ---------------------------------------------------------
 * Está SEPARADO DE LA PANTALLA DE MÓDULOS a propósito: los módulos miden
 * evaluaciones y se configuran en Configuración > Módulos; un programa es
 * una regla de bono que puede MIRAR un módulo sin serlo, y también puede
 * tener actividades propias con su nota cargada a mano.
 *
 * Quién entra: LÍDER y GERENTE DE TALENTO HUMANO (la ruta, el menú y el RLS
 * `puede_bonos` dicen lo mismo). Sin `RequireRol` acá: lo pone la ruta.
 */
export function ProgramasPage() {
  const [programas, setProgramas] = useState<BonoPrograma[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [modal, setModal] = useState(false)
  /** El que se está editando: `null` + modal abierto = alta. */
  const [editandoId, setEditandoId] = useState<string | null>(null)
  const [aBorrar, setABorrar] = useState<BonoPrograma | null>(null)
  const [borrando, setBorrando] = useState(false)
  /** El programa cuyas notas de actividades se cargan ahora. */
  const [notasDe, setNotasDe] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setError(null)
    try {
      setProgramas(await listarProgramas())
    } catch (e) {
      setProgramas(null)
      setError(e instanceof Error ? e.message : 'No se pudieron cargar los programas.')
    }
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  // Se busca por ID y no se guarda el objeto: al recargar (por ejemplo,
  // después de agregar una fuente) el modal vuelve a leer la fila fresca.
  const editando = programas?.find((p) => p.id === editandoId) ?? null
  const notasPrograma = programas?.find((p) => p.id === notasDe) ?? null

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-500">
          Cada programa junta de dónde sale su nota: <strong>módulos de evaluación</strong> o{' '}
          <strong>actividades propias</strong>. Es otra cosa que Configuración &gt; Módulos.
        </p>
        <Button
          onClick={() => {
            setEditandoId(null)
            setModal(true)
          }}
        >
          <Plus className="h-4 w-4" />
          Nuevo programa
        </Button>
      </div>

      {error ? (
        <div>
          <EmptyState title="No se pudieron cargar los programas" subtitle={error} />
          <Button className="mt-3" variant="secondary" onClick={() => void cargar()}>
            Reintentar
          </Button>
        </div>
      ) : programas === null ? (
        <SkeletonFilas n={4} />
      ) : !programas.length ? (
        <EmptyState
          title="Todavía no hay programas de bonificación"
          subtitle="Creá el primero: le agregás sus fuentes (módulos o actividades) y después lo asignás al cargo que paga con él."
        />
      ) : (
        <>
          {/* ESCRITORIO: una fila por programa. */}
          <div className="hidden overflow-hidden rounded-2xl border border-slate-200 bg-white lg:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase text-slate-400">
                  <th className="px-4 py-3">Programa</th>
                  <th className="px-4 py-3">Fuentes de la nota</th>
                  <th className="px-4 py-3">Período</th>
                  <th className="px-4 py-3">Estado</th>
                  <th className="px-4 py-3 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {programas.map((p) => (
                  <tr key={p.id} className="border-t border-slate-100 align-top">
                    <td className="px-4 py-3">
                      <p className="font-semibold text-slate-800">{p.nombre}</p>
                      <p className="line-clamp-2 text-xs text-slate-500">{p.descripcion || 'Sin descripción'}</p>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{resumenFuentes(p)}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {p.periodicidad === 'MENSUAL' ? 'Mensual' : 'Trimestral'}
                    </td>
                    <td className="px-4 py-3">
                      <Badge color={p.activo ? 2 : 4}>{p.activo ? 'Activo' : 'Inactivo'}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        <AccionesPrograma
                          programa={p}
                          onNotas={() => setNotasDe(p.id)}
                          onEditar={() => {
                            setEditandoId(p.id)
                            setModal(true)
                          }}
                          onBorrar={() => setABorrar(p)}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* MÓVIL: tarjetas. */}
          <div className="grid gap-3 lg:hidden">
            {programas.map((p) => (
              <div key={p.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-bold text-primary-900">{p.nombre}</p>
                  <Badge color={p.activo ? 2 : 4}>{p.activo ? 'Activo' : 'Inactivo'}</Badge>
                </div>
                <p className="mt-1 line-clamp-2 text-sm text-slate-500">{p.descripcion || 'Sin descripción'}</p>
                <p className="mt-2 text-xs text-slate-400">
                  {resumenFuentes(p)} · {p.periodicidad === 'MENSUAL' ? 'Mensual' : 'Trimestral'}
                </p>
                <div className="mt-3 flex items-center justify-end gap-1.5">
                  <AccionesPrograma
                    programa={p}
                    onNotas={() => setNotasDe(p.id)}
                    onEditar={() => {
                      setEditandoId(p.id)
                      setModal(true)
                    }}
                    onBorrar={() => setABorrar(p)}
                  />
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ALTA Y EDICIÓN: lo mismo, con las fuentes sólo cuando ya existe. */}
      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title={editando ? `Editar «${editando.nombre}»` : 'Nuevo programa'}
        wide
        footer={
          <Button type="submit" form="form-programa" className="w-full">
            {editando ? 'Guardar cambios' : 'Crear programa'}
          </Button>
        }
      >
        <FormPrograma
          key={editando?.id ?? 'nuevo'}
          programa={editando}
          onGuardar={async (datos) => {
            const id = await guardarPrograma(datos)
            if (!editando) {
              avisar('Programa creado: agregale sus fuentes.')
              setEditandoId(id)
            } else {
              avisar('Programa actualizado.')
              setModal(false)
            }
            await cargar()
          }}
          onAgregarFuente={async (fuente) => {
            if (!editando) return
            await agregarFuente(editando.id, fuente)
            avisar('Fuente agregada.')
            await cargar()
          }}
          onQuitarFuente={async (fuente) => {
            await quitarFuente(fuente.id)
            avisar('Fuente quitada.')
            await cargar()
          }}
        />
      </Modal>

      {/* NOTAS DE LAS ACTIVIDADES, por período. */}
      {notasPrograma ? (
        <ModalNotas
          key={`${notasPrograma.id}:${notasPrograma.periodicidad}`}
          programa={notasPrograma}
          onCerrar={() => setNotasDe(null)}
          onCambio={() => void cargar()}
        />
      ) : null}

      <Modal
        open={!!aBorrar}
        onClose={() => setABorrar(null)}
        title="Eliminar programa"
        footer={
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setABorrar(null)}>
              Cancelar
            </Button>
            <Button
              className="flex-1 bg-red-600 hover:bg-red-700"
              disabled={borrando}
              onClick={async () => {
                if (!aBorrar) return
                setBorrando(true)
                await eliminarPrograma(aBorrar.id)
                setBorrando(false)
                setABorrar(null)
                await cargar()
              }}
            >
              {borrando ? 'Eliminando…' : 'Eliminar programa'}
            </Button>
          </div>
        }
      >
        {aBorrar ? (
          <p className="text-sm text-slate-600">
            ¿Seguro que querés eliminar <strong>{aBorrar.nombre}</strong>? Se borran también sus{' '}
            {aBorrar.fuentes.length} fuente(s) y las notas de actividades cargadas. Los cargos que usen este
            programa quedan <strong>sin programa</strong> (su nota vuelve a cargarse a mano): no se borra el bono.
          </p>
        ) : null}
      </Modal>
    </div>
  )
}

/** «2 módulos · 1 actividad», o el estado vacío. */
function resumenFuentes(p: BonoPrograma): string {
  if (!p.fuentes.length) return 'Sin fuentes de nota'
  const modulos = p.fuentes.filter((f) => f.tipo === 'MODULO').length
  const actividades = p.fuentes.length - modulos
  const partes: string[] = []
  if (modulos) partes.push(`${modulos} ${modulos === 1 ? 'módulo' : 'módulos'}`)
  if (actividades) partes.push(`${actividades} ${actividades === 1 ? 'actividad' : 'actividades'}`)
  return partes.join(' · ')
}

/**
 * Los botones de UN programa, compartidos por la tabla y las tarjetas.
 * «Notas» es lo que hace el Líder a mano: cargar la nota de las actividades.
 */
function AccionesPrograma({
  programa,
  onNotas,
  onEditar,
  onBorrar
}: {
  programa: BonoPrograma
  onNotas: () => void
  onEditar: () => void
  onBorrar: () => void
}) {
  const tieneActividades = programa.fuentes.some((f) => f.tipo === 'ACTIVIDAD')
  return (
    <>
      {tieneActividades ? (
        <ButtonIcon variant="primary" onClick={onNotas} title="Cargar notas de actividades" aria-label="Cargar notas de actividades">
          <StickyNote className="h-5 w-5" />
        </ButtonIcon>
      ) : null}
      <ButtonIcon variant="primary" onClick={onEditar} title="Editar" aria-label="Editar">
        <Pencil className="h-5 w-5" />
      </ButtonIcon>
      <ButtonIcon variant="danger" onClick={onBorrar} title="Eliminar" aria-label="Eliminar">
        <Trash2 className="h-5 w-5" />
      </ButtonIcon>
    </>
  )
}

/**
 * El formulario del programa: sus datos y —cuando ya existe— sus FUENTES.
 *
 * Las fuentes se agregan y quitan acá mismo, con recarga en cada cambio
 * (la fila nueva recién tiene `id`): no vale la pena un modal dentro del
 * modal para dos operaciones.
 */
function FormPrograma({
  programa,
  onGuardar,
  onAgregarFuente,
  onQuitarFuente
}: {
  programa: BonoPrograma | null
  onGuardar: (datos: {
    id?: string
    nombre: string
    descripcion: string
    activo: boolean
    periodicidad: Periodicidad
  }) => Promise<void>
  onAgregarFuente: (fuente: { tipo: TipoFuente; modulo_id?: string | null; nombre: string; peso: number }) => Promise<void>
  onQuitarFuente: (fuente: BonoProgramaFuente) => Promise<void>
}) {
  const [nombre, setNombre] = useState(programa?.nombre ?? '')
  const [descripcion, setDescripcion] = useState(programa?.descripcion ?? '')
  const [periodicidad, setPeriodicidad] = useState<Periodicidad>(programa?.periodicidad ?? 'MENSUAL')
  const [activo, setActivo] = useState(programa?.activo ?? true)
  const [err, setErr] = useState<string | null>(null)

  // Las fuentes sólo existen para un programa ya guardado.
  const [tipo, setTipo] = useState<TipoFuente>('MODULO')
  const [moduloId, setModuloId] = useState('')
  const [nombreActividad, setNombreActividad] = useState('')
  const [peso, setPeso] = useState('1')
  const [modulos, setModulos] = useState<ModuloFuente[] | null>(null)

  useEffect(() => {
    if (!programa) return
    let vivo = true
    void listarModulosFuente()
      .then((lista) => {
        if (vivo) setModulos(lista)
      })
      .catch(() => {
        // Sin módulos no se puede elegir uno: el select queda con el aviso,
        // sin romper el formulario entero.
        if (vivo) setModulos([])
      })
    return () => {
      vivo = false
    }
  }, [programa])

  const pesoNumero = Number(peso.replace(',', '.'))
  const puedeAgregar =
    tipo === 'MODULO' ? Boolean(moduloId) : Boolean(nombreActividad.trim()) && pesoNumero > 0

  const agregar = async () => {
    try {
      await onAgregarFuente({
        tipo,
        modulo_id: tipo === 'MODULO' ? moduloId : null,
        nombre:
          tipo === 'MODULO'
            ? (modulos?.find((m) => m.id === moduloId)?.nombre ?? '')
            : nombreActividad.trim(),
        peso: pesoNumero
      })
      setModuloId('')
      setNombreActividad('')
      setPeso('1')
      setErr(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'No se pudo agregar la fuente.')
    }
  }

  return (
    <form
      id="form-programa"
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        setErr(null)
        void onGuardar({ id: programa?.id, nombre, descripcion, activo, periodicidad }).catch((e2: unknown) =>
          setErr(e2 instanceof Error ? e2.message : 'No se pudo guardar el programa.')
        )
      }}
    >
      <Field label="Nombre">
        <Input value={nombre} onChange={(e) => setNombre(e.target.value)} required placeholder="Ej.: Bono por faltantes" />
      </Field>
      <Field label="Descripción">
        <Textarea rows={2} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} />
      </Field>
      <Field label="Periodicidad" hint="Define el formato del período en el que se cargan las notas de actividades.">
        <Select
          value={periodicidad}
          onChange={(e) => setPeriodicidad(e.target.value as Periodicidad)}
          aria-label="Periodicidad del programa"
        >
          <option value="MENSUAL">Mensual (2026-11)</option>
          <option value="TRIMESTRAL">Trimestral (2026-T4)</option>
        </Select>
      </Field>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          className="h-5 w-5 accent-primary"
          checked={activo}
          onChange={(e) => setActivo(e.target.checked)}
        />
        Programa activo
      </label>

      {programa ? (
        <div className="space-y-3 border-t border-slate-100 pt-4">
          <div>
            <p className="text-sm font-semibold text-slate-700">Fuentes de la nota</p>
            <p className="text-xs text-slate-500">
              Un módulo aporta la nota de SUS evaluaciones; una actividad, la que se carga a mano en «Notas».
            </p>
          </div>

          {programa.fuentes.length ? (
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
              {programa.fuentes.map((f) => (
                <li key={f.id} className="flex items-center gap-3 px-3 py-2">
                  <Badge color={f.tipo === 'MODULO' ? 1 : 0}>{f.tipo === 'MODULO' ? 'Módulo' : 'Actividad'}</Badge>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-slate-700">{f.nombre}</span>
                    {f.tipo === 'MODULO' && !f.modulo_id ? (
                      <span className="block text-xs font-semibold text-amber-700">
                        El módulo fue borrado: volvé a elegirlo.
                      </span>
                    ) : null}
                  </span>
                  <span className="text-xs tabular-nums text-slate-500">peso {f.peso}</span>
                  <ButtonIcon
                    variant="danger"
                    title="Quitar fuente"
                    aria-label={`Quitar la fuente ${f.nombre}`}
                    onClick={() => void onQuitarFuente(f)}
                  >
                    <Trash2 className="h-5 w-5" />
                  </ButtonIcon>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-500">
              Sin fuentes: el programa todavía no tiene de dónde salir su nota.
            </p>
          )}

          <div className="space-y-3 rounded-xl bg-slate-50 p-3">
            <Field label="Tipo de fuente">
              <Select value={tipo} onChange={(e) => setTipo(e.target.value as TipoFuente)} aria-label="Tipo de fuente">
                <option value="MODULO">Módulo de evaluación</option>
                <option value="ACTIVIDAD">Actividad específica</option>
              </Select>
            </Field>

            {tipo === 'MODULO' ? (
              <Field label="Módulo" hint="La nota la dan las evaluaciones de ese módulo.">
                <Select value={moduloId} onChange={(e) => setModuloId(e.target.value)} aria-label="Módulo">
                  <option value="">{modulos === null ? 'Cargando módulos…' : 'Elegí un módulo…'}</option>
                  {(modulos ?? []).map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.nombre}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : (
              <Field label="Nombre de la actividad" hint="Ej.: Auditoría de precios, Cierre de inventario.">
                <Input
                  value={nombreActividad}
                  onChange={(e) => setNombreActividad(e.target.value)}
                  placeholder="Nombre de la actividad"
                />
              </Field>
            )}

            <Field label="Peso" hint="Cuánto pesa esta fuente en el promedio del programa.">
              <Input
                type="number"
                min={0.1}
                step="0.1"
                value={peso}
                onChange={(e) => setPeso(e.target.value)}
                aria-label="Peso de la fuente"
              />
            </Field>

            <Button type="button" variant="secondary" disabled={!puedeAgregar} onClick={() => void agregar()}>
              <Plus className="h-4 w-4" />
              Agregar fuente
            </Button>
          </div>
        </div>
      ) : (
        <p className="rounded-xl bg-primary-50 px-3 py-2 text-xs text-primary-800">
          Guardá el programa y después le agregás sus fuentes (módulos o actividades).
        </p>
      )}

      {err ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>
      ) : null}
    </form>
  )
}

/**
 * Las notas de las ACTIVIDADES de un programa, por período.
 *
 * Sólo las actividades: la nota de un módulo la dan las evaluaciones y no se
 * carga acá (de ahí que el selector sólo ofrezca fuentes ACTIVIDAD).
 */
function ModalNotas({
  programa,
  onCerrar,
  onCambio
}: {
  programa: BonoPrograma
  onCerrar: () => void
  onCambio: () => void
}) {
  const actividades = programa.fuentes.filter((f) => f.tipo === 'ACTIVIDAD')
  const periodos = periodosRecientes(programa.periodicidad)
  const [periodo, setPeriodo] = useState(periodos[0] ?? '')
  const [fuenteId, setFuenteId] = useState(actividades[0]?.id ?? '')
  const [notas, setNotas] = useState<NotaActividad[] | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setErr(null)
    setNotas(null)
    try {
      setNotas(await notasDePrograma(programa.id, periodo))
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'No se pudieron cargar las notas.')
    }
  }, [programa.id, periodo])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const fuente = actividades.find((f) => f.id === fuenteId) ?? null
  const visibles = (notas ?? []).filter((n) => n.bono_programa_fuente_id === fuenteId)

  return (
    <Modal open onClose={onCerrar} title={`Notas · ${programa.nombre}`} wide>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Período">
            <Select value={periodo} onChange={(e) => setPeriodo(e.target.value)} aria-label="Período">
              {periodos.map((p) => (
                <option key={p} value={p}>
                  {etiquetaPeriodo(p)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Actividad">
            <Select value={fuenteId} onChange={(e) => setFuenteId(e.target.value)} aria-label="Actividad">
              {actividades.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.nombre}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {actividades.length ? null : (
          <p className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-500">
            Este programa no tiene actividades: sus notas salen de los módulos y se cargan desde las evaluaciones.
          </p>
        )}

        {fuente ? <CargadorNotas fuente={fuente} periodo={periodo} onCambio={cargar} /> : null}

        {err ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>
        ) : null}

        <div className="border-t border-slate-100 pt-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Notas cargadas · {visibles.length}
          </p>
          {notas === null ? (
            <p className="flex items-center gap-2 text-sm text-slate-500">
              <Spinner size={16} /> Cargando notas…
            </p>
          ) : !visibles.length ? (
            <p className="text-sm text-slate-500">Sin notas para este período y actividad.</p>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
              {visibles.map((n) => (
                <li key={`${n.nacionalidad}-${n.dni}`} className="flex items-center gap-3 px-3 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-slate-700">{n.nombre || 'Sin nombre'}</span>
                    <span className="block text-xs tabular-nums text-slate-500">
                      {n.nacionalidad}-{n.dni}
                    </span>
                  </span>
                  <span className="text-sm font-bold tabular-nums text-primary-800">{n.nota}</span>
                  <ButtonIcon
                    variant="danger"
                    title="Quitar nota"
                    aria-label={`Quitar la nota de ${n.nombre}`}
                    onClick={async () => {
                      await quitarNota(n)
                      avisar('Nota quitada.')
                      await cargar()
                      onCambio()
                    }}
                  >
                    <Trash2 className="h-5 w-5" />
                  </ButtonIcon>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  )
}

/**
 * Buscar una persona en la nómina y cargarle la nota de la actividad.
 *
 * La búsqueda va al servidor con debounce (son miles de filas) y recién desde
 * 2 letras, igual que en el selector de equipo de Gran Cosecha —que es
 * donde nació este mismo patrón.
 */
function CargadorNotas({
  fuente,
  periodo,
  onCambio
}: {
  fuente: BonoProgramaFuente
  periodo: string
  onCambio: () => void
}) {
  const [busqueda, setBusqueda] = useState('')
  const [resultados, setResultados] = useState<TrabajadorNomina[]>([])
  const [buscando, setBuscando] = useState(false)
  const [notas, setNotas] = useState<Record<string, string>>({})
  const [guardando, setGuardando] = useState<string | null>(null)

  useEffect(() => {
    const texto = busqueda.trim()
    if (texto.length < 2) {
      setResultados([])
      setBuscando(false)
      return
    }
    let vivo = true
    const reloj = setTimeout(() => {
      setBuscando(true)
      listarTrabajadoresEquipo(texto)
        .then((filas) => {
          if (!vivo) return
          setResultados(filas)
          setBuscando(false)
        })
        .catch(() => {
          if (!vivo) return
          setResultados([])
          setBuscando(false)
        })
    }, 300)
    return () => {
      vivo = false
      clearTimeout(reloj)
    }
  }, [busqueda])

  const cargar = async (t: TrabajadorNomina) => {
    const bruto = notas[`${t.nacionalidad}-${t.dni}`] ?? ''
    const valor = Number(bruto.replace(',', '.'))
    if (bruto.trim() === '' || !Number.isFinite(valor) || valor < 0 || valor > 100) {
      avisar('La nota va de 0 a 100.', 'error')
      return
    }
    setGuardando(`${t.nacionalidad}-${t.dni}`)
    try {
      await guardarNota({
        bono_programa_fuente_id: fuente.id,
        periodo,
        nacionalidad: t.nacionalidad,
        dni: t.dni,
        nombre: nombreCompleto(t),
        nota: valor
      })
      avisar(`Nota guardada para ${nombreCompleto(t)}.`)
      setNotas((prev) => {
        const copia = { ...prev }
        delete copia[`${t.nacionalidad}-${t.dni}`]
        return copia
      })
      setBusqueda('')
      setResultados([])
      onCambio()
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'No se pudo guardar la nota.', 'error')
    } finally {
      setGuardando(null)
    }
  }

  return (
    <div className="space-y-2">
      <Field label="Buscar persona" hint="Nombre o cédula; busca entre los trabajadores de cualquier sucursal.">
        <Input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por nombre o cédula"
          aria-label="Buscar persona"
        />
      </Field>

      {buscando ? (
        <p className="flex items-center gap-2 text-sm text-slate-500">
          <Spinner size={16} /> Buscando…
        </p>
      ) : resultados.length ? (
        <ul className="max-h-56 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200">
          {resultados.map((t) => {
            const clave = `${t.nacionalidad}-${t.dni}`
            return (
              <li key={clave} className="flex items-center gap-2 px-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-slate-800">{nombreCompleto(t)}</span>
                  <span className="block text-xs tabular-nums text-slate-500">
                    {t.nacionalidad}-{t.dni}
                  </span>
                </span>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  className="w-20"
                  value={notas[clave] ?? ''}
                  onChange={(e) => setNotas((prev) => ({ ...prev, [clave]: e.target.value }))}
                  placeholder="0-100"
                  aria-label={`Nota de ${nombreCompleto(t)}`}
                />
                <Button
                  variant="secondary"
                  className="min-h-[34px] px-3 py-1.5 text-xs"
                  disabled={guardando === clave}
                  onClick={() => void cargar(t)}
                >
                  {guardando === clave ? 'Guardando…' : 'Agregar'}
                </Button>
              </li>
            )
          })}
        </ul>
      ) : busqueda.trim().length >= 2 ? (
        <p className="text-sm text-slate-500">Nadie coincide con «{busqueda}».</p>
      ) : (
        <p className="text-[11px] text-slate-400">
          Escribí 2 letras o más para buscar entre los trabajadores de cualquier sucursal.
        </p>
      )}
    </div>
  )
}
