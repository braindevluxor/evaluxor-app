import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { listarModulosAdmin, guardarModulo, eliminarModulo } from '../../lib/data/catalog'
import type { Modulo, Item } from '../../lib/types'
import { Button, Field, Input, Modal, Spinner, Badge, Textarea } from '../../components/ui'
import { List, Pencil, Trash2 } from 'lucide-react'

export function ModulosPage() {
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
        <div>
          <h2 className="text-xl font-extrabold text-primary-900">Módulos</h2>
          <p className="text-sm text-slate-500">Áreas que se evalúan en cada visita</p>
        </div>
        <Button onClick={() => { setEditando(null); setModal(true) }}>+ Nuevo módulo</Button>
      </div>

      {cargando ? <div className="flex justify-center py-16"><Spinner /></div> : !modulos.length ? (
        <div className="rounded-2xl border border-slate-200 bg-white py-12 text-center text-slate-500">Crea el primer módulo.</div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {modulos.map((m) => (
            <div key={m.id} className="flex flex-col rounded-2xl border border-slate-200 bg-white p-4">
              <div className="mb-1 flex items-start justify-between gap-2">
                <p className="font-bold text-primary-900">{m.nombre}</p>
                <Badge color={m.activo ? 2 : 4}>{m.activo ? 'Activo' : 'Inactivo'}</Badge>
              </div>
              <p className="mb-3 line-clamp-2 text-sm text-slate-500">{m.descripcion || 'Sin descripción'}</p>
              <p className="mb-3 text-xs text-slate-400">{m._items.length} ítem(s) configurados</p>
              <div className="mt-auto flex items-center justify-end gap-2">
                <Link to={`/config/items?modulo=${m.id}`} title="Ver ítems" className="grid h-9 w-9 place-items-center rounded-full bg-primary text-white transition-colors hover:bg-primary-700">
                  <List className="h-4 w-4" />
                </Link>
                <button onClick={() => { setEditando(m); setModal(true) }} title="Editar" className="grid h-9 w-9 place-items-center rounded-full bg-primary text-white transition-colors hover:bg-primary-700">
                  <Pencil className="h-4 w-4" />
                </button>
                <button onClick={() => setABorrar(m)} title="Eliminar" className="grid h-9 w-9 place-items-center rounded-full bg-red-600 text-white transition-colors hover:bg-red-700">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={modal} onClose={() => setModal(false)} title={editando ? 'Editar módulo' : 'Nuevo módulo'}>
        <FormModulo
          inicial={editando}
          onGuardar={async (d) => {
            await guardarModulo(d)
            setModal(false)
            await cargar()
          }}
        />
      </Modal>

      <Modal open={!!aBorrar} onClose={() => setABorrar(null)} title="Eliminar módulo">
        {aBorrar ? (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              ¿Seguro que deseas eliminar <strong>{aBorrar.nombre}</strong>? Se borrarán también sus {aBorrar._items.length} ítem(s) y las respuestas asociadas en evaluaciones ya realizadas. Esta acción no se puede deshacer.
            </p>
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setABorrar(null)}>Cancelar</Button>
              <Button
                className="flex-1 bg-red-600 hover:bg-red-700"
                disabled={borrando}
                onClick={async () => {
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
          </div>
        ) : null}
      </Modal>
    </div>
  )
}

function FormModulo({ inicial, onGuardar }: { inicial: Modulo | null; onGuardar: (d: Partial<Modulo> & { nombre: string }) => Promise<void> }) {
  const [nombre, setNombre] = useState(inicial?.nombre ?? '')
  const [descripcion, setDescripcion] = useState(inicial?.descripcion ?? '')
  const [orden, setOrden] = useState(inicial?.orden ?? 0)
  const [activo, setActivo] = useState(inicial?.activo ?? true)

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        void onGuardar({ id: inicial?.id, nombre, descripcion, orden: Number(orden), activo })
      }}
    >
      <Field label="Nombre"><Input value={nombre} onChange={(e) => setNombre(e.target.value)} required /></Field>
      <Field label="Descripción"><Textarea rows={2} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} /></Field>
      <Field label="Orden" hint="Posición en el flujo de evaluación"><Input type="number" value={orden} onChange={(e) => setOrden(Number(e.target.value))} /></Field>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" className="h-5 w-5 accent-primary" checked={activo} onChange={(e) => setActivo(e.target.checked)} />
        Módulo activo
      </label>
      <Button type="submit" className="w-full">Guardar módulo</Button>
    </form>
  )
}