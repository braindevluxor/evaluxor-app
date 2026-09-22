import { useEffect, useState } from 'react'
import { listarModulosAdmin, listarSucursalConfigAdmin, configurarSucursalModulos, configurarSucursalItems } from '../../lib/data/catalog'
import type { Sucursal, Modulo, Item } from '../../lib/types'
import { Button, Modal, Spinner, cn } from '../../components/ui'

interface Props {
  sucursal: Sucursal | null
  onClose: () => void
  onGuardado: () => void
}

export function SucursalConfigModal({ sucursal, onClose, onGuardado }: Props) {
  const [modulos, setModulos] = useState<(Modulo & { _items: Item[] })[]>([])
  const [selModulos, setSelModulos] = useState<Set<string>>(new Set())
  const [selItems, setSelItems] = useState<Set<string>>(new Set())
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    if (!sucursal) return
    void (async () => {
      const [mods, conf] = await Promise.all([listarModulosAdmin(), listarSucursalConfigAdmin(sucursal.id)])
      setModulos(mods)
      setSelModulos(new Set(conf.modulos))
      setSelItems(new Set(conf.items))
      setCargando(false)
    })()
  }, [sucursal])

  function toggleModulo(id: string) {
    setSelModulos((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  function toggleItem(id: string) {
    setSelItems((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  async function guardar() {
    if (!sucursal) return
    setGuardando(true)
    setMsg('')
    try {
      await configurarSucursalModulos(sucursal.id, [...selModulos])
      await configurarSucursalItems(sucursal.id, [...selItems])
      setMsg('Configuración guardada. Los evaluadores verán los cambios al sincronizar el catálogo.')
      onGuardado()
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Modal open={sucursal != null} onClose={onClose} title={`Configurar sucursal${sucursal ? ` · ${sucursal.nombre}` : ''}`} wide>
      {cargando ? <div className="flex justify-center py-16"><Spinner /></div> : (
        <div className="space-y-6">
          <p className="rounded-xl bg-primary-50 px-3 py-2 text-[11px] leading-relaxed text-primary-700">
            Si no marcas módulos, aplican todos los módulos activos. Si no marcas ítems de un módulo, aplican todos sus ítems.
            Un módulo o ítem marcado es el único que aplica para esta sucursal.
          </p>

          <div>
            <h4 className="mb-2 text-sm font-bold text-primary-900">Módulos que aplican</h4>
            {selModulos.size === 0 ? (
              <p className="mb-2 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">Sin selección: aplican todos los módulos activos.</p>
            ) : null}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {modulos.map((m) => {
                const activo = selModulos.has(m.id)
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => toggleModulo(m.id)}
                    className={cn(
                      'truncate rounded-xl border-2 px-3 py-2.5 text-center text-xs font-semibold transition-colors',
                      activo
                        ? 'border-primary bg-primary text-white'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-primary'
                    )}
                  >
                    {m.nombre}
                    <span className="mt-0.5 block text-[10px] opacity-70">{activo ? 'Aplica' : 'No aplica'}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <div>
            <h4 className="mb-2 text-sm font-bold text-primary-900">Ítems que aplican por módulo</h4>
            <div className="space-y-3">
              {modulos.map((m) => {
                const moduloActivo = selModulos.has(m.id)
                const itemsSel = m._items.filter((i) => selItems.has(i.id)).length
                return (
                  <div key={m.id} className={cn('rounded-xl border border-slate-200 p-3', !moduloActivo && 'opacity-50')}>
                    <p className="mb-2 flex items-center justify-between text-xs font-bold text-slate-700">
                      <span>{m.nombre}</span>
                      <span className="font-medium text-slate-400">{itemsSel === 0 ? 'todos los ítems' : `${itemsSel}/${m._items.length} ítems seleccionados`}</span>
                    </p>
                    <div className="space-y-1">
                      {m._items.map((i) => {
                        const sel = selItems.has(i.id)
                        return (
                          <label key={i.id} className={cn('flex items-start gap-2 rounded-lg px-2 py-1 text-sm', !moduloActivo ? 'cursor-not-allowed' : 'cursor-pointer hover:bg-slate-50')}>
                            <input
                              type="checkbox"
                              className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                              checked={sel}
                              disabled={!moduloActivo}
                              onChange={() => toggleItem(i.id)}
                            />
                            <span className="leading-snug text-slate-700">{i.texto}</span>
                          </label>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {msg ? <p className="rounded-xl bg-green-50 px-3 py-2 text-sm font-medium text-green-700">{msg}</p> : null}

          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={onClose}>Cerrar</Button>
            <Button className="flex-1" disabled={guardando} onClick={() => void guardar()}>
              {guardando ? 'Guardando…' : 'Guardar configuración'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}