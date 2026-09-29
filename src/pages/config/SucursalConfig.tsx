import { useEffect, useState } from 'react'
import { ChevronDown } from 'lucide-react'
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
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set())
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
      setExpandidos(new Set())
      setMsg('')
      setCargando(false)
    })()
  }, [sucursal])

  /** Un módulo aplica si está marcado, o (canónicamente) si no se marcó ninguno. */
  const aplica = (m: Modulo) => selModulos.size === 0 || selModulos.has(m.id)

  function toggleModulo(id: string) {
    const aplicaba = selModulos.size === 0 || selModulos.has(id)
    setSelModulos((prev) => {
      let n: Set<string>
      if (prev.size === 0) {
        // Estaba en "aplican todos": desmarcar uno pasa a "aplican todos menos este".
        n = new Set(modulos.map((m) => m.id))
        n.delete(id)
      } else {
        n = new Set(prev)
        if (n.has(id)) n.delete(id)
        else n.add(id)
      }
      // Si quedan todos marcados, volver al estado canónico "aplican todos" (conjunto vacío).
      if (n.size === modulos.length) n = new Set()
      return n
    })
    // Al aplicar se despliegan sus ítems; al no aplicar se repliegan.
    setExpandidos((prev) => {
      const n = new Set(prev)
      if (aplicaba) n.delete(id)
      else n.add(id)
      return n
    })
  }

  function toggleExpandido(id: string) {
    setExpandidos((prev) => {
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

  function toggleTodosItems(m: Modulo & { _items: Item[] }) {
    const todos = m._items.length > 0 && m._items.every((i) => selItems.has(i.id))
    setSelItems((prev) => {
      const n = new Set(prev)
      for (const i of m._items) {
        if (todos) n.delete(i.id)
        else n.add(i.id)
      }
      return n
    })
    // Quitar puntos guardados de los ítems que dejan de aplicarse.
    if (todos) {
      setSelOpciones((prev) => {
        const n = new Map(prev)
        for (const i of m._items) n.delete(i.id)
        return n
      })
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
    <Modal
      open={sucursal != null}
      onClose={onClose}
      title={`Configurar sucursal${sucursal ? ` · ${sucursal.nombre}` : ''}`}
      wide
      footer={
        !cargando ? (
          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={onClose}>Cerrar</Button>
            <Button className="flex-1" disabled={guardando} onClick={() => void guardar()}>
              {guardando ? 'Guardando…' : 'Guardar configuración'}
            </Button>
          </div>
        ) : undefined
      }
    >
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
            Marca con el check los módulos que aplican a esta sucursal: al marcarlos se despliegan sus ítems para ajustar cuáles aplican.
            Si no marcas ninguno, aplican todos los módulos activos. Si no marcas ítems de un módulo, aplican todos sus ítems.
            En un ítem tipo check list puedes marcar qué puntos aplican; si no marcas ninguno, aplican todos sus puntos.
          </p>

          <div>
            <h4 className="mb-2 text-sm font-bold text-primary-900">Módulos e ítems que aplican</h4>
            {selModulos.size === 0 ? (
              <p className="mb-2 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">Sin selección: aplican todos los módulos activos (todos con el check puesto).</p>
            ) : null}
            <div className="space-y-2">
              {modulos.length ? (
                modulos.map((m) => {
                  const exp = expandidos.has(m.id)
                  const on = aplica(m)
                  const itemsSel = m._items.filter((i) => selItems.has(i.id)).length
                  const todos = m._items.length > 0 && itemsSel === m._items.length
                  return (
                    <div key={m.id} className={cn('overflow-hidden rounded-xl border bg-white transition-opacity', on ? 'border-slate-200' : 'border-slate-100 opacity-70')}>
                      <div className="flex items-center gap-1.5 px-2 py-1.5">
                        <label
                          className="flex shrink-0 select-none items-center gap-1.5 rounded-lg px-1 py-1.5 transition-colors hover:bg-slate-50"
                          title={on ? 'Quitar el check: el módulo deja de aplicar a esta sucursal' : 'Poner el check: el módulo aplica a esta sucursal y se despliegan sus ítems'}
                        >
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-primary"
                            checked={on}
                            onChange={() => toggleModulo(m.id)}
                          />
                          <span className={cn('text-[10px] font-bold uppercase tracking-wide', on ? 'text-primary' : 'text-slate-400')}>
                            {on ? 'Aplica' : 'No aplica'}
                          </span>
                        </label>
                        <button
                          type="button"
                          onClick={() => toggleExpandido(m.id)}
                          className="flex min-w-0 flex-1 items-center gap-3 px-1 py-1.5 text-left transition-colors hover:bg-slate-50"
                          title={exp ? 'Re plegar ítems' : 'Desplegar ítems'}
                        >
                          <ChevronDown className={cn('h-4 w-4 shrink-0 text-slate-400 transition-transform duration-150', exp && 'rotate-180')} />
                          <span className="min-w-0 flex-1 truncate text-sm font-bold text-slate-800">{m.nombre}</span>
                          {m._items.length ? (
                            <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold', itemsSel === 0 ? 'bg-slate-100 text-slate-500' : 'bg-primary-50 text-primary-700')}>
                              {itemsSel === 0 ? 'Todos sus ítems' : `${itemsSel}/${m._items.length} seleccionados`}
                            </span>
                          ) : (
                            <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-400">Sin ítems</span>
                          )}
                        </button>
                        {on && m._items.length ? (
                          <button
                            type="button"
                            onClick={() => toggleTodosItems(m)}
                            className="mr-1 shrink-0 rounded-full border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-500 transition-colors hover:border-primary hover:text-primary"
                            title={todos ? 'Quitar la selección de todos los ítems del módulo' : 'Seleccionar todos los ítems del módulo'}
                          >
                            {todos ? 'Quitar todos' : 'Marcar todos'}
                          </button>
                        ) : null}
                      </div>
                      {exp ? (
                        <div className="border-t border-slate-100 bg-slate-50/60 p-3">
                          {on ? (
                            <div className="space-y-1">
                              {m._items.length ? (
                                m._items.map((i) => {
                                  const sel = selItems.has(i.id)
                                  const esChecklist = i.tipo === 'CHECKLIST' && !!i.opciones?.length
                                  return (
                                    <div key={i.id}>
                                      <label className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1 text-sm transition-colors hover:bg-white">
                                        <input
                                          type="checkbox"
                                          className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                                          checked={sel}
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
                                        <div className="ml-7 rounded-xl bg-white p-2 ring-1 ring-slate-100">
                                          <p className="mb-1 px-1 text-[11px] font-semibold text-slate-500">Puntos que aplican a esta sucursal</p>
                                          {i.opciones!.map((o) => {
                                            const marcada = selOpciones.get(i.id)?.has(o.id) ?? false
                                            return (
                                              <label key={o.id} className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1 text-sm hover:bg-slate-50">
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
                                })
                              ) : (
                                <p className="px-2 py-1 text-xs text-slate-400">Este módulo no tiene ítems.</p>
                              )}
                            </div>
                          ) : (
                            <p className="px-2 py-1 text-xs text-slate-400">El módulo no aplica: ponle el check para configurar sus ítems.</p>
                          )}
                        </div>
                      ) : null}
                    </div>
                  )
                })
              ) : (
                <p className="rounded-xl bg-slate-50 px-3 py-3 text-xs text-slate-500">No hay módulos para configurar.</p>
              )}
            </div>
          </div>

          {msg ? <p className="rounded-xl bg-green-50 px-3 py-2 text-sm font-medium text-green-700">{msg}</p> : null}
        </div>
      )}
    </Modal>
  )
}