import { useCallback, useEffect, useState } from 'react'
import { Pencil, Settings2, Trash2 } from 'lucide-react'
import { listarDepartamentosAdmin, guardarDepartamento, eliminarDepartamento } from '../../lib/data/departamentos'
import type { Departamento } from '../../lib/types'
import { Button, Field, Input, Modal, Badge, SkeletonFilas } from '../../components/ui'
import { DepartamentoConfigModal } from './SucursalConfig'

/**
 * Configuración > Departamentos: el listado de las áreas que no son sucursales
 * (Mercadeo, Taller, Talento Humano, Administración...).
 *
 * Es el gemelo de `Sucursales`, pero sin las columnas de tienda (nº tienda, ID
 * de trabajadores, dirección, Gerente S): un departamento no tiene sucursal a
 * la que parecerse. Alta, edición y baja lógica (el checkbox "activo"), que es
 * lo mismo que se puede hacer con una sucursal.
 */
export function DepartamentosPage() {
  const [departamentos, setDepartamentos] = useState<Departamento[]>([])
  const [cargando, setCargando] = useState(true)
  const [modal, setModal] = useState(false)
  const [editando, setEditando] = useState<Departamento | null>(null)
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'err'; texto: string } | null>(null)
  const [aBorrar, setABorrar] = useState<Departamento | null>(null)
  const [borrando, setBorrando] = useState(false)
  const [configurando, setConfigurando] = useState<Departamento | null>(null)

  const cargar = useCallback(async () => {
    try {
      setDepartamentos(await listarDepartamentosAdmin())
    } catch (e) {
      setMsg({ tipo: 'err', texto: e instanceof Error ? e.message : 'No se pudieron cargar los departamentos.' })
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const borrar = async () => {
    if (!aBorrar) return
    setBorrando(true)
    try {
      await eliminarDepartamento(aBorrar.id)
      setMsg({ tipo: 'ok', texto: `Se eliminó ${aBorrar.nombre}.` })
      setABorrar(null)
      await cargar()
    } catch (e) {
      // El modal se cierra igual: si el departamento ya tiene evaluaciones,
      // Postgres no deja borrarlo y el aviso queda en la página, no adentro.
      setMsg({ tipo: 'err', texto: e instanceof Error ? e.message : 'No se pudo eliminar.' })
      setABorrar(null)
    } finally {
      setBorrando(false)
    }
  }

  const abrir = (d: Departamento | null) => {
    setEditando(d)
    setMsg(null)
    setModal(true)
  }

  const guardar = async (data: Partial<Departamento> & { nombre: string }) => {
    try {
      await guardarDepartamento(data)
      setMsg({ tipo: 'ok', texto: 'Guardado correctamente.' })
      setModal(false)
      await cargar()
    } catch (e) {
      // Se queda el modal abierto: si el nombre ya existe o no se pudo guardar,
      // el error se muestra junto al botón y el texto escrito sigue ahí.
      setMsg({ tipo: 'err', texto: e instanceof Error ? e.message : 'No se pudo guardar.' })
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-slate-500">
          Áreas de la organización que se evalúan por separado y no son tiendas. Central no es una
          sucursal: lo que se evalúa ahí es cada uno de estos departamentos.
        </p>
        <Button onClick={() => abrir(null)}>+ Nuevo</Button>
      </div>

      {cargando ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <SkeletonFilas n={5} />
        </div>
      ) : !departamentos.length ? (
        <div className="rounded-2xl border border-slate-200 bg-white py-12 text-center text-slate-500">
          Aún no hay departamentos.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase text-slate-400">
                <th className="px-4 py-3">Nombre</th>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {departamentos.map((d) => (
                <tr key={d.id} className="border-t border-slate-100">
                  <td className="px-4 py-3 font-semibold text-slate-700">{d.nombre}</td>
                  <td className="px-4 py-3">
                    <Badge color={d.activa ? 2 : 4}>{d.activa ? 'Activo' : 'Inactivo'}</Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-3">
                      <button
                        onClick={() => setConfigurando(d)}
                        title="Configurar módulos e ítems"
                        className="grid h-8 w-8 place-items-center rounded-full bg-primary text-white transition-colors hover:bg-primary-700"
                      >
                        <Settings2 className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => abrir(d)}
                        title="Editar"
                        className="grid h-8 w-8 place-items-center rounded-full bg-primary text-white transition-colors hover:bg-primary-700"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => { setMsg(null); setABorrar(d) }}
                        title="Eliminar"
                        className="grid h-8 w-8 place-items-center rounded-full bg-red-600 text-white transition-colors hover:bg-red-700"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={modal}
        onClose={() => { setModal(false); setMsg(null) }}
        title={editando ? 'Editar departamento' : 'Nuevo departamento'}
        footer={
          <div className="space-y-2">
            {msg?.tipo === 'err' ? (
              <p className="text-sm font-medium text-red-600">{msg.texto}</p>
            ) : null}
            <Button type="submit" form="form-departamento" className="w-full">
              Guardar departamento
            </Button>
          </div>
        }
      >
        <FormDepartamento inicial={editando} onGuardar={guardar} />
      </Modal>

      <Modal
        open={!!aBorrar}
        onClose={() => setABorrar(null)}
        title="Eliminar departamento"
        footer={
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setABorrar(null)}>
              Cancelar
            </Button>
            <Button className="flex-1 bg-red-600 hover:bg-red-700" disabled={borrando} onClick={() => void borrar()}>
              {borrando ? 'Eliminando.' : 'Eliminar departamento'}
            </Button>
          </div>
        }
      >
        {aBorrar ? (
          <p className="text-sm text-slate-600">
            ¿Seguro que deseas eliminar <strong>{aBorrar.nombre}</strong>? Se quita del listado y no
            podrá usarse en nuevas evaluaciones. Esta acción no se puede deshacer.
          </p>
        ) : null}
        <p className="mt-2 text-xs text-slate-400">
          Si solo quieres que deje de aparecer sin perder nada, en vez de eliminarlo márcalo como
          inactivo desde Editar.
        </p>
      </Modal>

      {/* Misma pantalla que la de sucursales, con las tablas `departamento_*`. */}
      <DepartamentoConfigModal
        departamento={configurando}
        onClose={() => setConfigurando(null)}
        onGuardado={() => {
          /* la configuración no cambia el listado: no hay nada que recargar */
        }}
      />

      {msg ? (
        <p
          className={
            msg.tipo === 'ok'
              ? 'text-sm font-medium text-green-700'
              : 'text-sm font-medium text-red-600'
          }
        >
          {msg.texto}
        </p>
      ) : null}
    </div>
  )
}

function FormDepartamento({
  inicial,
  onGuardar
}: {
  inicial: Departamento | null
  onGuardar: (d: Partial<Departamento> & { nombre: string }) => Promise<void>
}) {
  const [nombre, setNombre] = useState(inicial?.nombre ?? '')
  const [activa, setActiva] = useState(inicial?.activa ?? true)

  return (
    <form
      id="form-departamento"
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        void onGuardar({ id: inicial?.id, nombre: nombre.trim(), activa })
      }}
    >
      <Field
        label="Nombre"
        hint="Así aparece en los filtros, el ranking y los reportes (ej. Mercadeo, Talento Humano)."
      >
        <Input value={nombre} onChange={(e) => setNombre(e.target.value)} required autoFocus />
      </Field>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input
          type="checkbox"
          className="h-5 w-5 accent-primary"
          checked={activa}
          onChange={(e) => setActiva(e.target.checked)}
        />
        Departamento activo
      </label>
    </form>
  )
}
