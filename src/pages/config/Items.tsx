import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { X } from 'lucide-react'
import { listarModulosAdmin, guardarItem, eliminarItem } from '../../lib/data/catalog'
import { etiquetaTipo, ETIQUETAS_TIPO } from '../../lib/scoring'
import type { FiltroColaboradores, Item, Modulo, Opcion, TipoItem } from '../../lib/types'
import { Button, Field, Input, Modal, Select, Textarea, Badge, Spinner } from '../../components/ui'

const TIPOS = Object.keys(ETIQUETAS_TIPO) as TipoItem[]

export function ItemsPage() {
  const [params] = useSearchParams()
  const [modulos, setModulos] = useState<(Modulo & { _items: Item[] })[]>([])
  const [cargando, setCargando] = useState(true)
  const [moduloId, setModuloId] = useState(() => params.get('modulo') ?? '')
  const [modal, setModal] = useState(false)
  const [editando, setEditando] = useState<Item | null>(null)
  const [aBorrar, setABorrar] = useState<Item | null>(null)
  const [borrando, setBorrando] = useState(false)

  const cargar = useCallback(async () => {
    const data = await listarModulosAdmin()
    setModulos(data)
    setCargando(false)
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  useEffect(() => {
    if (!moduloId && modulos.length) setModuloId(modulos[0].id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modulos.length])

  const actual = useMemo(() => modulos.find((m) => m.id === moduloId), [modulos, moduloId])
  const items = actual?._items ?? []

  async function mover(idx: number, dir: -1 | 1) {
    const destino = idx + dir
    if (destino < 0 || destino >= items.length) return
    const a = items[idx]
    const b = items[destino]
    await Promise.all([
      guardarItem({ id: a.id, modulo_id: a.modulo_id, tipo: a.tipo, texto: a.texto, orden: b.orden }),
      guardarItem({ id: b.id, modulo_id: b.modulo_id, tipo: b.tipo, texto: b.texto, orden: a.orden })
    ])
    await cargar()
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-extrabold text-primary-900">Ítems de evaluación</h2>
          <p className="text-sm text-slate-500">Preguntas de cada módulo</p>
        </div>
        <div className="w-56">
          <Field label="Módulo">
            <Select value={moduloId} onChange={(e) => setModuloId(e.target.value)}>
              {modulos.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
            </Select>
          </Field>
        </div>
        <Button onClick={() => { setEditando(null); setModal(true) }} disabled={!moduloId}>+ Nuevo ítem</Button>
      </div>

      {cargando ? <div className="flex justify-center py-16"><Spinner /></div> : !actual ? (
        <div className="rounded-2xl border border-slate-200 bg-white py-12 text-center text-slate-500">Selecciona un módulo o crea uno primero.</div>
      ) : !items.length ? (
        <div className="rounded-2xl border border-slate-200 bg-white py-12 text-center text-slate-500">Este módulo no tiene ítems.</div>
      ) : (
        <div className="space-y-2">
          {items.map((it, idx) => (
            <div key={it.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
              <p className="min-w-[24px] text-center text-sm font-bold text-slate-400">{idx + 1}</p>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-700">{it.texto}</p>
                <div className="mt-1 flex items-center gap-2">
                  <Badge color={tipoColor(it.tipo)}>{etiquetaTipo(it.tipo)}</Badge>
                  {it.requerido ? <Badge color={0}>Obligatorio</Badge> : null}
                  {!it.activo ? <Badge color={4}>Inactivo</Badge> : null}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => void mover(idx, -1)} disabled={idx === 0} className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 text-slate-500 disabled:opacity-30">↑</button>
                <button onClick={() => void mover(idx, 1)} disabled={idx === items.length - 1} className="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 text-slate-500 disabled:opacity-30">↓</button>
                <button onClick={() => { setEditando(it); setModal(true) }} className="grid h-8 place-items-center rounded-lg border border-slate-200 px-3 text-sm font-semibold text-primary">Editar</button>
                <button onClick={() => setABorrar(it)} className="grid h-8 place-items-center rounded-lg border border-red-200 px-3 text-sm font-semibold text-red-600 hover:bg-red-50">Eliminar</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={modal} onClose={() => setModal(false)} title={editando ? 'Editar ítem' : 'Nuevo ítem'} wide>
        <FormItem
          moduloId={moduloId}
          inicial={editando}
          onGuardar={async (d) => {
            await guardarItem(d)
            setModal(false)
            await cargar()
          }}
        />
      </Modal>

      <Modal open={!!aBorrar} onClose={() => setABorrar(null)} title="Eliminar ítem">
        {aBorrar ? (
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              ¿Seguro que deseas eliminar el ítem <strong>{aBorrar.texto}</strong>? Se borrarán también las respuestas asociadas en evaluaciones ya realizadas. Esta acción no se puede deshacer.
            </p>
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setABorrar(null)}>Cancelar</Button>
              <Button
                className="flex-1 bg-red-600 hover:bg-red-700"
                disabled={borrando}
                onClick={async () => {
                  setBorrando(true)
                  await eliminarItem(aBorrar.id)
                  setBorrando(false)
                  setABorrar(null)
                  await cargar()
                }}
              >
                {borrando ? 'Eliminando…' : 'Eliminar ítem'}
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  )
}

function tipoColor(t: TipoItem): number {
  return t === 'CUMPLE_NO_CUMPLE' ? 3 : t === 'CONCILIACION' ? 6 : t === 'CHECKLIST' ? 5 : t === 'LISTA_COLABORADORES' ? 1 : 4
}

function FormItem({
  moduloId,
  inicial,
  onGuardar
}: {
  moduloId: string
  inicial: Item | null
  onGuardar: (d: Partial<Item> & { modulo_id: string; tipo: TipoItem; texto: string; sku?: string }) => Promise<void>
}) {
  const [tipo, setTipo] = useState<TipoItem>(inicial?.tipo ?? 'CUMPLE_NO_CUMPLE')
  const [texto, setTexto] = useState(inicial?.texto ?? '')
  const [opciones, setOpciones] = useState<Opcion[]>(inicial?.opciones?.length ? inicial.opciones : [{ id: 'o1', etiqueta: '' }, { id: 'o2', etiqueta: '' }])
  const [requerido, setRequerido] = useState(inicial?.requerido ?? false)
  const [activo, setActivo] = useState(inicial?.activo ?? true)
  const [filtroColaboradores, setFiltroColaboradores] = useState<FiltroColaboradores>(inicial?.colaboradores_filtro ?? 'ACTIVOS')

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        void onGuardar({
          id: inicial?.id,
          modulo_id: inicial?.modulo_id ?? moduloId,
          tipo,
          texto,
          opciones: tipo === 'CHECKLIST' || tipo === 'LISTA_COLABORADORES' ? opciones.filter((o) => o.etiqueta.trim()) : [],
          colaboradores_filtro: tipo === 'LISTA_COLABORADORES' ? filtroColaboradores : null,
          requerido,
          activo
        })
      }}
    >
      <Field label="Tipo de ítem">
        <Select value={tipo} onChange={(e) => setTipo(e.target.value as TipoItem)}>
          {TIPOS.map((t) => <option key={t} value={t}>{etiquetaTipo(t)}</option>)}
        </Select>
      </Field>
      <Field label="Pregunta / enunciado">
        <Textarea rows={2} value={texto} onChange={(e) => setTexto(e.target.value)} required placeholder="Ej. Los pasillos están libres de obstáculos…" />
      </Field>
      {tipo === 'CHECKLIST' ? (
        <Field label="Lista de opciones (el ítem cumple al marcar todas)">
          <EditorOpciones opciones={opciones} onChange={setOpciones} />
        </Field>
      ) : null}
      {tipo === 'LISTA_COLABORADORES' ? (
        <>
          <Field label="Checklist de cada colaborador (se aplica a todos los colaboradores de la tienda)">
            <EditorOpciones opciones={opciones} onChange={setOpciones} />
          </Field>
          <Field label="Colaboradores en cuenta">
            <Select value={filtroColaboradores} onChange={(e) => setFiltroColaboradores(e.target.value as FiltroColaboradores)}>
              <option value="ACTIVOS">Solo activos</option>
              <option value="INACTIVOS">Solo inactivos</option>
              <option value="TODOS">Activos e inactivos</option>
            </Select>
          </Field>
          <p className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">
            En la evaluación se cargan los colaboradores de la tienda desde la API de talento humano (aplicando el filtro elegido) y este mismo checklist se marca para cada uno. El ítem cumple cuando todos los colaboradores en cuenta tienen su checklist completo.
          </p>
        </>
      ) : null}
      {tipo === 'CONCILIACION' ? (
        <p className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">
          En la evaluación, el evaluador agrega los productos (escaneando o escribiendo el SKU) y registra las cantidades teórica y física por cada uno.
        </p>
      ) : null}
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" className="h-5 w-5 accent-primary" checked={requerido} onChange={(e) => setRequerido(e.target.checked)} />
        Ítem obligatorio
      </label>
      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" className="h-5 w-5 accent-primary" checked={activo} onChange={(e) => setActivo(e.target.checked)} />
        Ítem activo (visible en evaluaciones)
      </label>
      <Button type="submit" className="w-full">Guardar ítem</Button>
    </form>
  )
}

function EditorOpciones({ opciones, onChange }: { opciones: Opcion[]; onChange: (o: Opcion[]) => void }) {
  const cambiar = (i: number, etiqueta: string) => {
    const nuevo = opciones.map((o, idx) => (idx === i ? { ...o, etiqueta } : o))
    onChange(nuevo)
  }
  const agregar = () => onChange([...opciones, { id: `o${Date.now()}`, etiqueta: '' }])
  const quitar = (i: number) => onChange(opciones.filter((_, idx) => idx !== i))
  const mover = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= opciones.length) return
    const nuevo = [...opciones]
    ;[nuevo[i], nuevo[j]] = [nuevo[j], nuevo[i]]
    onChange(nuevo)
  }

  return (
    <div className="space-y-2">
      {opciones.map((o, i) => (
        <div key={o.id} className="flex items-center gap-2">
          <span className="w-6 shrink-0 text-center text-sm font-bold text-slate-400">{i + 1}</span>
          <Input value={o.etiqueta} onChange={(e) => cambiar(i, e.target.value)} placeholder={`Opción ${i + 1}`} />
          <button type="button" onClick={() => mover(i, -1)} disabled={i === 0} title="Subir" className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-slate-500 hover:bg-slate-100 disabled:opacity-30">↑</button>
          <button type="button" onClick={() => mover(i, 1)} disabled={i === opciones.length - 1} title="Bajar" className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-slate-500 hover:bg-slate-100 disabled:opacity-30">↓</button>
          <button type="button" onClick={() => quitar(i)} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl text-red-500 hover:bg-red-50"><X className="h-5 w-5" /></button>
        </div>
      ))}
      <Button type="button" variant="secondary" onClick={agregar}>+ Agregar opción</Button>
    </div>
  )
}