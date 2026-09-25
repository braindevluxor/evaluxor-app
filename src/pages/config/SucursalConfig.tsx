import { useEffect, useState } from 'react'
import { listarModulosAdmin, listarSucursalConfigAdmin, configurarSucursalModulos, configurarSucursalItems, configurarSucursalOpciones } from '../../lib/data/catalog'
import type { Sucursal, Modulo, Item } from '../../lib/types'
import { Button, Modal, Skeleton, cn } from '../../components/ui'

interface Props {
  sucursal: Sucursal | null
  onClose: () => void
  onGuardado: () => void
}

export function SucursalConfigModal({ sucursal, onClose, onGuardado }: Props) {
  const [modulos, setModulos] = useState<(Modulo & { _items: Item[] })[]>([])
  const [selModulos, setSelModulos] = useState<Set<string>>(new Set())
  const [selItems, setSelItems] = useState<Set<string>>(new Set())
  const [selOpciones, setSelOpciones] = useState<Map<string, Set<string>>>(new Map())
  const [cargando, setCargando] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    if (!sucursal) return
    void (async () => {
      const [mods, conf] = await Promise.all([listarModulosAdmin(), listarSucursalConfigAdmin(sucursal.id)])
      setModulos(mods)
      setSelModulos(new Set(conf.modulos))
      const itemsSeleccionados = new Set(conf.items)
      setSelItems(itemsSeleccionados)
      const porItem = new Map<string, Set<string>>()
      for (const o of conf.opciones) {
        if (!itemsSeleccionados.has(o.item_id)) continue
        const s = porItem.get(o.item_id) ?? new Set<string>()
        s.add(o.opcion_id)
        porItem.set(o.item_id, s)
      }
      setSelOpciones(porItem)
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
    if (selItems.has(id)) {
      setSelItems((prev) => {
        const n = new Set(prev)
        n.delete(id)
        return n
      })
      setSelOpciones((prev) => {
        const n = new Map(prev)
        n.delete(id)
        return n
      })
    } else {
      setSelItems((prev) => new Set(prev).add(id))
    }
  }

  function toggleOpcion(itemId: string, opcionId: string) {
    setSelOpciones((prev) => {
      const n = new Map(prev)
      const s = new Set(n.get(itemId) ?? [])
      if (s.has(opcionId)) s.delete(opcionId)
      else s.add(opcionId)
      if (s.size) n.set(itemId, s)
      else n.delete(itemId)
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
      const opciones = Array.from(selOpciones.entries()).flatMap(([itemId, ids]) =>
        Array.from(ids).map((opcion_id) => ({ item_id: itemId, opcion_id }))
      )
      await configurarSucursalOpciones(sucursal.id, opciones)
      setMsg('Configuración guardada. Los evaluadores verán los cambios al sincronizar el catálogo.')
      onGuardado()
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Modal open={sucursal != null} onClose={onClose} title={`Configurar sucursal${sucursal ? ` · ${sucursal.nombre}` : ''}`} wide>
      {cargando ? (
        <div className="space-y-5">
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-4 w-44" />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-10 rounded-xl" />)}
          </div>
          <Skeleton className="h-4 w-52" />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 rounded-xl" />)}
          </div>
          <Skeleton className="h-11 w-full rounded-full" />
        </div>
      ) : (
        <div className="space-y-6">
          <p className="rounded-xl bg-primary-50 px-3 py-2 text-[11px] leading-relaxed text-primary-700">
            Si no marcas módulos, aplican todos los módulos activos. Si no marcas ítems de un módulo, aplican todos sus ítems.
            En un ítem tipo check list puedes marcar qué puntos aplican; si no marcas ninguno, aplican todos sus puntos.
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
                      'truncate rounded-full border-2 px-3 py-2.5 text-center text-xs font-semibold transition-colors',
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
                        const esChecklist = i.tipo === 'CHECKLIST' && !!i.opciones?.length
                        return (
                          <div key={i.id}>
                            <label className={cn('flex items-start gap-2 rounded-lg px-2 py-1 text-sm', !moduloActivo ? 'cursor-not-allowed' : 'cursor-pointer hover:bg-slate-50')}>
                              <input
                                type="checkbox"
                                className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                                checked={sel}
                                disabled={!moduloActivo}
                                onChange={() => toggleItem(i.id)}
                              />
                              <span className="flex-1 leading-snug text-slate-700">{i.texto}</span>
                              {esChecklist ? (
                                <span className={cn('shrink-0 text-[11px] font-medium', sel ? 'text-primary' : 'text-slate-400')}>
                                  puntos
                                </span>
                              ) : null}
                            </label>
                            {esChecklist && sel ? (
                              <div className="ml-7 rounded-xl bg-slate-50 p-2">
                                <p className="mb-1 px-1 text-[11px] font-semibold text-slate-500">Puntos que aplican a esta sucursal</p>
                                {i.opciones!.map((o) => {
                                  const marcada = selOpciones.get(i.id)?.has(o.id) ?? false
                                  return (
                                    <label key={o.id} className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1 text-sm hover:bg-white">
                                      <input
                                        type="checkbox"
                                        className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                                        checked={marcada}
                                        onChange={() => toggleOpcion(i.id, o.id)}
                                      />
                                      <span className="leading-snug text-slate-600">{o.etiqueta}</span>
                                    </label>
                                  )
                                })}
                              </div>
                            ) : null}
                          </div>
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