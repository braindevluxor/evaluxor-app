import { useCallback, useEffect, useState } from 'react'
import { Pencil, Settings2 } from 'lucide-react'
import { listarSucursalesAdmin, guardarSucursal, type SucursalVista } from '../../lib/data/catalog'
import { listarUsuarios, type ProfileVista } from '../../lib/data/usuarios'
import type { Sucursal } from '../../lib/types'
import { Button, Field, Input, Modal, Spinner, Badge, Select } from '../../components/ui'
import { SucursalConfigModal } from './SucursalConfig'
import { useCatalog } from '../../context/CatalogContext'

export function SucursalesPage() {
  const { refresh: refrescarCatalogo } = useCatalog()
  const [sucursales, setSucursales] = useState<SucursalVista[]>([])
  const [cargando, setCargando] = useState(true)
  const [modal, setModal] = useState(false)
  const [editando, setEditando] = useState<Sucursal | null>(null)
  const [configurando, setConfigurando] = useState<Sucursal | null>(null)
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
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase text-slate-400">
                <th className="px-4 py-3">Nombre</th>
                <th className="px-4 py-3">Nº tienda</th>
                <th className="px-4 py-3">ID trabajadores</th>
                <th className="px-4 py-3">Gerente S</th>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {sucursales.map((s) => (
                <tr key={s.id} className="border-t border-slate-100">
                  <td className="px-4 py-3 font-semibold text-slate-700">{s.nombre}</td>
                  <td className="px-4 py-3">{s.shop_id ?? '—'}</td>
                  <td className="px-4 py-3">{s.branch_id ?? '—'}</td>
                  <td className="px-4 py-3">{s.gerente?.nombre || '—'}</td>
                  <td className="px-4 py-3">
                    <Badge color={s.activa ? 2 : 4}>{s.activa ? 'Activa' : 'Inactiva'}</Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-3">
                      <button onClick={() => setConfigurando(s)} className="flex items-center gap-1.5 font-semibold text-slate-600 hover:text-primary" title="Configurar módulos e ítems">
                        <Settings2 className="h-4 w-4" /> Configurar
                      </button>
                      <button onClick={() => { setEditando(s); setModal(true) }} title="Editar" className="grid h-8 w-8 place-items-center rounded-full bg-primary text-white transition-colors hover:bg-primary-700">
                        <Pencil className="h-4 w-4" />
                      </button>
                    </div>
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
            await refrescarCatalogo()
          }}
        />
      </Modal>
      <SucursalConfigModal
        sucursal={configurando}
        onClose={() => setConfigurando(null)}
        onGuardado={() => { void cargar(); void refrescarCatalogo() }}
      />
      {msg ? <p className="text-sm font-medium text-green-700">{msg}</p> : null}
    </div>
  )
}

function FormSucursal({ inicial, onGuardar }: { inicial: Sucursal | null; onGuardar: (d: Partial<Sucursal> & { nombre: string }) => Promise<void> }) {
  const [nombre, setNombre] = useState(inicial?.nombre ?? '')
  const [shopId, setShopId] = useState(inicial?.shop_id ?? '')
  const [branchId, setBranchId] = useState(inicial?.branch_id ?? '')
  const [direccion, setDireccion] = useState(inicial?.direccion ?? '')
  const [gerenteId, setGerenteId] = useState(inicial?.gerente_id ?? '')
  const [gerentes, setGerentes] = useState<ProfileVista[]>([])
  const [activa, setActiva] = useState(inicial?.activa ?? true)

  useEffect(() => {
    void listarUsuarios().then((users) => setGerentes(users.filter((u) => u.rol === 'GERENTE_S')))
  }, [])

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        void onGuardar({ id: inicial?.id, nombre, shop_id: shopId.trim() || null, branch_id: branchId.trim() || null, direccion, gerente_id: gerenteId.trim() || null, activa })
      }}
    >
      <Field label="Nombre"><Input value={nombre} onChange={(e) => setNombre(e.target.value)} required /></Field>
      <Field label="Nº tienda (shop_id)" hint="Usado para consultar el nombre del producto al escanear (ej. 000)"><Input value={shopId} onChange={(e) => setShopId(e.target.value)} /></Field>
      <Field label="ID trabajadores (branchID)" hint="Usado para consultar la lista de colaboradores. Es el ID de la sucursal en la API de trabajadores (puede diferir del shop_id)."><Input value={branchId} onChange={(e) => setBranchId(e.target.value)} /></Field>
      <Field label="Dirección"><Input value={direccion} onChange={(e) => setDireccion(e.target.value)} /></Field>
      <Field label="Gerente S a cargo" hint="Opcional. Usuario con rol GERENTE_S responsable de la sucursal.">
        <Select value={gerenteId} onChange={(e) => setGerenteId(e.target.value)}>
          <option value="">(Sin asignar)</option>
          {gerentes.map((g) => (
            <option key={g.id} value={g.id}>{g.nombre || g.usuario || g.email}</option>
          ))}
        </Select>
      </Field>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" className="h-5 w-5 accent-primary" checked={activa} onChange={(e) => setActiva(e.target.checked)} />
        Sucursal activa
      </label>
      <Button type="submit" className="w-full">Guardar sucursal</Button>
    </form>
  )
}