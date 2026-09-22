import { useCallback, useEffect, useState } from 'react'
import { listarSucursalesAdmin, guardarSucursal } from '../../lib/data/catalog'
import type { Sucursal } from '../../lib/types'
import { Button, Field, Input, Modal, Spinner, Badge } from '../../components/ui'

export function SucursalesPage() {
  const [sucursales, setSucursales] = useState<Sucursal[]>([])
  const [cargando, setCargando] = useState(true)
  const [modal, setModal] = useState(false)
  const [editando, setEditando] = useState<Sucursal | null>(null)
  const [msg, setMsg] = useState('')

  const cargar = useCallback(async () => {
    setSucursales(await listarSucursalesAdmin())
    setCargando(false)
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-extrabold text-primary-900">Sucursales</h2>
          <p className="text-sm text-slate-500">Registro de supermercados a evaluar</p>
        </div>
        <Button onClick={() => { setEditando(null); setModal(true) }}>+ Nueva</Button>
      </div>

      {cargando ? <div className="flex justify-center py-16"><Spinner /></div> : !sucursales.length ? (
        <div className="rounded-2xl border border-slate-200 bg-white py-12 text-center text-slate-500">Aún no hay sucursales.</div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase text-slate-400">
                <th className="px-4 py-3">Nombre</th>
                <th className="px-4 py-3">Código</th>
                <th className="px-4 py-3">Ciudad</th>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {sucursales.map((s) => (
                <tr key={s.id} className="border-t border-slate-100">
                  <td className="px-4 py-3 font-semibold text-slate-700">{s.nombre}</td>
                  <td className="px-4 py-3">{s.codigo}</td>
                  <td className="px-4 py-3">{s.ciudad || '—'}</td>
                  <td className="px-4 py-3">
                    <Badge color={s.activa ? 2 : 4}>{s.activa ? 'Activa' : 'Inactiva'}</Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => { setEditando(s); setModal(true) }} className="font-semibold text-primary hover:underline">Editar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={modal} onClose={() => setModal(false)} title={editando ? 'Editar sucursal' : 'Nueva sucursal'}>
        <FormSucursal
          inicial={editando}
          onGuardar={async (data) => {
            await guardarSucursal(data)
            setMsg('Guardado correctamente.')
            setModal(false)
            await cargar()
          }}
        />
      </Modal>
      {msg ? <p className="text-sm font-medium text-green-700">{msg}</p> : null}
    </div>
  )
}

function FormSucursal({ inicial, onGuardar }: { inicial: Sucursal | null; onGuardar: (d: Partial<Sucursal> & { nombre: string; codigo: string }) => Promise<void> }) {
  const [nombre, setNombre] = useState(inicial?.nombre ?? '')
  const [codigo, setCodigo] = useState(inicial?.codigo ?? '')
  const [ciudad, setCiudad] = useState(inicial?.ciudad ?? '')
  const [direccion, setDireccion] = useState(inicial?.direccion ?? '')
  const [activa, setActiva] = useState(inicial?.activa ?? true)

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        void onGuardar({ id: inicial?.id, nombre, codigo, ciudad, direccion, activa })
      }}
    >
      <Field label="Nombre"><Input value={nombre} onChange={(e) => setNombre(e.target.value)} required /></Field>
      <Field label="Código" hint="Identificador corto único (ej. SUC-01)"><Input value={codigo} onChange={(e) => setCodigo(e.target.value)} required /></Field>
      <Field label="Ciudad"><Input value={ciudad} onChange={(e) => setCiudad(e.target.value)} /></Field>
      <Field label="Dirección"><Input value={direccion} onChange={(e) => setDireccion(e.target.value)} /></Field>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" className="h-5 w-5 accent-primary" checked={activa} onChange={(e) => setActiva(e.target.checked)} />
        Sucursal activa
      </label>
      <Button type="submit" className="w-full">Guardar sucursal</Button>
    </form>
  )
}