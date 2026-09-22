import { useCallback, useEffect, useState } from 'react'
import { listarDepartamentosAdmin, guardarDepartamento, eliminarDepartamento } from '../../lib/data/catalog'
import type { Departamento } from '../../lib/types'
import { Button, Field, Input, Modal, Spinner, Badge } from '../../components/ui'

export function DepartamentosPage() {
  const [departamentos, setDepartamentos] = useState<Departamento[]>([])
  const [cargando, setCargando] = useState(true)
  const [modal, setModal] = useState(false)
  const [editando, setEditando] = useState<Departamento | null>(null)
  const [aBorrar, setABorrar] = useState<Departamento | null>(null)
  const [msg, setMsg] = useState('')

  const cargar = useCallback(async () => {
    setDepartamentos(await listarDepartamentosAdmin())
    setCargando(false)
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-extrabold text-primary-900">Departamentos</h2>
          <p className="text-sm text-slate-500">Tolerancias de conciliación para el escaneo de productos</p>
        </div>
        <Button onClick={() => { setEditando(null); setModal(true) }}>+ Nuevo</Button>
      </div>

      {cargando ? <div className="flex justify-center py-16"><Spinner /></div> : !departamentos.length ? (
        <div className="rounded-2xl border border-slate-200 bg-white py-12 text-center text-slate-500">Aún no hay departamentos.</div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase text-slate-400">
                <th className="px-4 py-3">Nombre</th>
                <th className="px-4 py-3">ID departamento</th>
                <th className="px-4 py-3">Tolerancia</th>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3"></th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {departamentos.map((d) => (
                <tr key={d.id} className="border-t border-slate-100">
                  <td className="px-4 py-3 font-semibold text-slate-700">{d.nombre}</td>
                  <td className="px-4 py-3 font-mono text-xs">{d.codigo}</td>
                  <td className="px-4 py-3">
                    {d.tolerancia != null
                      ? <Badge color={3}>±{d.tolerancia}%</Badge>
                      : <span className="text-slate-400">Sin tolerancia</span>}
                  </td>
                  <td className="px-4 py-3">
                    <Badge color={d.activo ? 2 : 4}>{d.activo ? 'Activo' : 'Inactivo'}</Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => { setEditando(d); setModal(true) }} className="font-semibold text-primary hover:underline">Editar</button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => setABorrar(d)} className="font-semibold text-red-500 hover:underline">Eliminar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={modal} onClose={() => setModal(false)} title={editando ? 'Editar departamento' : 'Nuevo departamento'}>
        <FormDepartamento
          inicial={editando}
          onGuardar={async (data) => {
            await guardarDepartamento(data)
            setMsg('Guardado correctamente.')
            setModal(false)
            await cargar()
          }}
        />
      </Modal>

      <Modal open={aBorrar != null} onClose={() => setABorrar(null)} title="Eliminar departamento">
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            ¿Eliminar el departamento <strong>{aBorrar?.nombre}</strong>? Esta acción no se puede deshacer.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setABorrar(null)}>Cancelar</Button>
            <Button
              variant="danger"
              onClick={async () => {
                if (aBorrar) await eliminarDepartamento(aBorrar.id)
                setABorrar(null)
                setMsg('Departamento eliminado.')
                await cargar()
              }}
            >
              Eliminar
            </Button>
          </div>
        </div>
      </Modal>

      {msg ? <p className="text-sm font-medium text-green-700">{msg}</p> : null}
    </div>
  )
}

function FormDepartamento({ inicial, onGuardar }: { inicial: Departamento | null; onGuardar: (d: Partial<Departamento> & { nombre: string; codigo: string }) => Promise<void> }) {
  const [nombre, setNombre] = useState(inicial?.nombre ?? '')
  const [codigo, setCodigo] = useState(inicial?.codigo ?? '')
  const [tolerancia, setTolerancia] = useState(inicial?.tolerancia != null ? String(inicial.tolerancia) : '')
  const [activo, setActivo] = useState(inicial?.activo ?? true)

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        const tol = tolerancia.trim()
        void onGuardar({
          id: inicial?.id,
          nombre,
          codigo,
          tolerancia: tol !== '' && Number.isFinite(Number(tol)) ? Number(tol) : null,
          activo
        })
      }}
    >
      <Field label="Nombre"><Input value={nombre} onChange={(e) => setNombre(e.target.value)} required autoFocus /></Field>
      <Field label="ID departamento" hint="Coincide con el ID que traerá la API al escanear un producto"><Input value={codigo} onChange={(e) => setCodigo(e.target.value)} required /></Field>
      <Field label="Tolerancia (%)" hint="Desviación permitida sobre el 100%. Ej. 5 = rango 95%–105%"><Input value={tolerancia} onChange={(e) => setTolerancia(e.target.value)} /></Field>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" className="h-5 w-5 accent-primary" checked={activo} onChange={(e) => setActivo(e.target.checked)} />
        Departamento activo
      </label>
      <Button type="submit" className="w-full">Guardar departamento</Button>
    </form>
  )
}