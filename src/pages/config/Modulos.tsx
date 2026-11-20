import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { listarModulosAdmin, guardarModulo, eliminarModulo } from '../../lib/data/catalog'
import type { Modulo, Item } from '../../lib/types'
import { Button, ButtonIcon, Field, Input, Modal, Badge, Textarea, SkeletonFilas, SkeletonTarjetas, claseBotonIcono } from '../../components/ui'
import { FileDown, List, Pencil, Trash2 } from 'lucide-react'
import { descargarExplicacionModulo } from '../../lib/pdf/explicacionModulo'
import { IconoModulo } from '../../components/IconoModulo'
import { ICONOS_MODULO } from '../../lib/iconosModulo'
import { useAuth } from '../../context/AuthContext'
import { puedeConfigurar } from '../../lib/roles'

export function ModulosPage() {
  const { profile } = useAuth()
  /**
   * Modo consulta: el EVALUADOR entra sólo para mirar los módulos y bajar su
   * explicación (PDF de metodología), por eso la ruta ya no es de Líder. Acá
   * se esconden las acciones de escritura —nuevo, editar, eliminar, ver
   * ítems— que sólo tendrían sentido para Líder, y que de todos modos el RLS
   * (`modulos_lider` / `items_lider`) rechazaría en el servidor.
   */
  const soloLectura = !puedeConfigurar(profile?.rol ?? 'SIN_ROL')
  const [modulos, setModulos] = useState<(Modulo & { _items: Item[] })[]>([])
  const [cargando, setCargando] = useState(true)
  const [modal, setModal] = useState(false)
  const [editando, setEditando] = useState<Modulo | null>(null)
  const [aBorrar, setABorrar] = useState<(Modulo & { _items: Item[] }) | null>(null)
  const [borrando, setBorrando] = useState(false)

  const cargar = useCallback(async () => {
    setModulos(await listarModulosAdmin())
    setCargando(false)
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        {soloLectura ? (
          <p className="text-sm text-slate-500">
            Consulta los módulos de evaluación y descarga la explicación de cada uno: metodología e ítems que lo componen.
          </p>
        ) : (
          <Button onClick={() => { setEditando(null); setModal(true) }}>+ Nuevo módulo</Button>
        )}
      </div>

      {cargando ? (
        <>
          {/* El esqueleto imita la lista real: tarjetas abajo, filas arriba. */}
          <div className="lg:hidden">
            <SkeletonTarjetas n={4} cols="sm:grid-cols-2" />
          </div>
          <div className="hidden lg:block">
            <SkeletonFilas n={6} />
          </div>
        </>
      ) : !modulos.length ? (
        <div className="rounded-2xl border border-slate-200 bg-white py-12 text-center text-slate-500">
          {soloLectura ? 'Aún no hay módulos configurados.' : 'Crea el primer módulo.'}
        </div>
      ) : (
        <>
          {/* ESCRITORIO: una fila por módulo —tabla, que es lo que se puede
              escanear de arriba abajo—. Las columnas son las cuatro cosas que
              se miran: qué es, de qué va, cuántos ítems tiene y en qué estado. */}
          <div className="hidden overflow-hidden rounded-2xl border border-slate-200 bg-white lg:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase text-slate-400">
                  <th className="px-4 py-3">Módulo</th>
                  <th className="px-4 py-3">Descripción</th>
                  <th className="px-4 py-3">Ítems</th>
                  <th className="px-4 py-3">Estado</th>
                  <th className="px-4 py-3 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {modulos.map((m) => (
                  <tr key={m.id} className="border-t border-slate-100 align-top">
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-2 font-semibold text-slate-800">
                        <IconoModulo nombre={m.icono} className="h-5 w-5 shrink-0 text-primary" />
                        {m.nombre}
                      </span>
                    </td>
                    <td className="max-w-md px-4 py-3 text-slate-500">
                      <span className="line-clamp-2">{m.descripcion || 'Sin descripción'}</span>
                    </td>
                    <td className="px-4 py-3 tabular-nums text-slate-600">{m._items.length}</td>
                    <td className="px-4 py-3">
                      <span className="flex flex-wrap gap-1">
                        {m.compartido ? <Badge color={1}>Compartido</Badge> : null}
                        <Badge color={m.activo ? 2 : 4}>{m.activo ? 'Activo' : 'Inactivo'}</Badge>
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        <AccionesModulo
                          modulo={m}
                          soloLectura={soloLectura}
                          onDescargar={() =>
                            void descargarExplicacionModulo({
                              moduloNombre: m.nombre,
                              moduloDescripcion: m.descripcion,
                              items: m._items
                            })
                          }
                          onEditar={() => {
                            setEditando(m)
                            setModal(true)
                          }}
                          onBorrar={() => setABorrar(m)}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* MÓVIL: las mismas tarjetas de siempre —en una columna, que en
              una tabla de cinco columnas no cabría nada—. */}
          <div className="grid gap-3 lg:hidden">
            {modulos.map((m) => (
              <div key={m.id} className="flex flex-col rounded-2xl border border-slate-200 bg-white p-4">
                <div className="mb-1 flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <IconoModulo nombre={m.icono} className="h-5 w-5 shrink-0 text-primary" />
                    <p className="font-bold text-primary-900">{m.nombre}</p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {m.compartido ? <Badge color={1}>Compartido</Badge> : null}
                    <Badge color={m.activo ? 2 : 4}>{m.activo ? 'Activo' : 'Inactivo'}</Badge>
                  </div>
                </div>
                <p className="mb-3 line-clamp-2 text-sm text-slate-500">{m.descripcion || 'Sin descripción'}</p>
                <p className="mb-3 text-xs text-slate-400">{m._items.length} ítem(s) configurados</p>
                <div className="mt-auto flex items-center justify-end gap-1.5">
                  <AccionesModulo
                    modulo={m}
                    soloLectura={soloLectura}
                    onDescargar={() =>
                      void descargarExplicacionModulo({
                        moduloNombre: m.nombre,
                        moduloDescripcion: m.descripcion,
                        items: m._items
                      })
                    }
                    onEditar={() => {
                      setEditando(m)
                      setModal(true)
                    }}
                    onBorrar={() => setABorrar(m)}
                  />
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <Modal
        open={modal}
        onClose={() => setModal(false)}
        title={editando ? 'Editar módulo' : 'Nuevo módulo'}
        footer={<Button type="submit" form="form-modulo" className="w-full">Guardar módulo</Button>}
      >
        <FormModulo
          inicial={editando}
          onGuardar={async (d) => {
            await guardarModulo(d)
            setModal(false)
            await cargar()
          }}
        />
      </Modal>

      <Modal
        open={!!aBorrar}
        onClose={() => setABorrar(null)}
        title="Eliminar módulo"
        footer={
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setABorrar(null)}>Cancelar</Button>
            <Button
              className="flex-1 bg-red-600 hover:bg-red-700"
              disabled={borrando}
              onClick={async () => {
                if (!aBorrar) return
                setBorrando(true)
                await eliminarModulo(aBorrar.id)
                setBorrando(false)
                setABorrar(null)
                await cargar()
              }}
            >
              {borrando ? 'Eliminando…' : 'Eliminar módulo'}
            </Button>
          </div>
        }
      >
        {aBorrar ? (
          <p className="text-sm text-slate-600">
            ¿Seguro que deseas eliminar <strong>{aBorrar.nombre}</strong>? Se borrarán también sus {aBorrar._items.length} ítem(s) y las respuestas asociadas en evaluaciones ya realizadas. Esta acción no se puede deshacer.
          </p>
        ) : null}
      </Modal>
    </div>
  )
}

/**
 * Los botones de UN módulo: descargar la explicación (siempre, también en
 * modo consulta) y, sólo si se puede escribir, ver ítems, editar y eliminar.
 *
 * Vive en un solo lugar porque la vista de escritorio (tabla) y la del
 * móvil (tarjetas) son dos renderings del mismo dato: si cada una tuviera
 * los suyos, un día se actualizaría uno y no el otro.
 */
function AccionesModulo({
  modulo,
  soloLectura,
  onDescargar,
  onEditar,
  onBorrar
}: {
  modulo: Modulo & { _items: Item[] }
  soloLectura: boolean
  onDescargar: () => void
  onEditar: () => void
  onBorrar: () => void
}) {
  return (
    <>
      {/* La descarga de la explicación es lo único que también hace el
          evaluador en modo consulta: siempre visible. */}
      <ButtonIcon
        variant="primary"
        onClick={onDescargar}
        title="Descargar explicación del módulo"
        aria-label="Descargar explicación del módulo"
      >
        <FileDown className="h-5 w-5" />
      </ButtonIcon>
      {!soloLectura ? (
        <>
          <Link
            to={`/config/items?modulo=${modulo.id}`}
            title="Ver ítems"
            aria-label="Ver ítems"
            className={claseBotonIcono('primary')}
          >
            <List className="h-5 w-5" />
          </Link>
          <ButtonIcon variant="primary" onClick={onEditar} title="Editar" aria-label="Editar">
            <Pencil className="h-5 w-5" />
          </ButtonIcon>
          <ButtonIcon variant="danger" onClick={onBorrar} title="Eliminar" aria-label="Eliminar">
            <Trash2 className="h-5 w-5" />
          </ButtonIcon>
        </>
      ) : null}
    </>
  )
}

function FormModulo({ inicial, onGuardar }: { inicial: Modulo | null; onGuardar: (d: Partial<Modulo> & { nombre: string }) => Promise<void> }) {
  const [nombre, setNombre] = useState(inicial?.nombre ?? '')
  const [descripcion, setDescripcion] = useState(inicial?.descripcion ?? '')
  const [icono, setIcono] = useState(inicial?.icono ?? 'clipboard-list')
  const [orden, setOrden] = useState(inicial?.orden ?? 0)
  const [activo, setActivo] = useState(inicial?.activo ?? true)
  const [compartido, setCompartido] = useState(inicial?.compartido ?? false)
  const [err, setErr] = useState<string | null>(null)

  return (
    <form
      id="form-modulo"
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        setErr(null)
        void onGuardar({ id: inicial?.id, nombre, descripcion, icono, orden: Number(orden), activo, compartido })
          .catch((e2: unknown) => {
            setErr(e2 instanceof Error ? e2.message : 'No se pudo guardar el módulo.')
          })
      }}
    >
      <Field label="Nombre"><Input value={nombre} onChange={(e) => setNombre(e.target.value)} required /></Field>
      <Field label="Descripción"><Textarea rows={2} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} /></Field>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium text-slate-700">Icono del módulo</legend>
        <div className="grid grid-cols-5 gap-2">
          {ICONOS_MODULO.map(({ id, etiqueta, Icono }) => (
            <button
              key={id}
              type="button"
              aria-label={etiqueta}
              aria-pressed={icono === id}
              title={etiqueta}
              onClick={() => setIcono(id)}
              className={`grid h-11 place-items-center rounded-lg border transition-colors ${
                icono === id
                  ? 'border-primary bg-primary-50 text-primary'
                  : 'border-slate-200 text-slate-500 hover:bg-slate-50'
              }`}
            >
              <Icono className="h-5 w-5" />
            </button>
          ))}
        </div>
      </fieldset>
      <Field label="Orden" hint="Posición en el flujo de evaluación"><Input type="number" value={orden} onChange={(e) => setOrden(Number(e.target.value))} /></Field>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" className="h-5 w-5 accent-primary" checked={activo} onChange={(e) => setActivo(e.target.checked)} />
        Módulo activo
      </label>
      <label className="flex items-start gap-2 text-sm text-slate-700">
        <input type="checkbox" className="mt-0.5 h-5 w-5 accent-primary" checked={compartido} onChange={(e) => setCompartido(e.target.checked)} />
        <span>
          Módulo compartido
          <span className="block text-xs text-slate-400">Varios evaluadores pueden llenarlo a la vez y ver en vivo el avance del otro. Si lo quitás con evaluadores asignados, primero desasignalos.</span>
        </span>
      </label>
      {err ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{err}</div>
      ) : null}
    </form>
  )
}