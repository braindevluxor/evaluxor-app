import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { FolderOpen, GripVertical, Pencil, Plus, Trash2, X } from 'lucide-react'
import { listarModulosAdmin, guardarItem, eliminarItem } from '../../lib/data/catalog'
import { etiquetaTipo, ETIQUETAS_TIPO, pesoItem, redondear3 } from '../../lib/scoring'
import { itemsEnOrdenJerarquico, hijosDe } from '../../lib/hierarchy'
import type { FiltroColaboradores, Item, Modulo, Opcion, TipoItem } from '../../lib/types'
import { Button, Field, Input, Modal, Select, Textarea, Badge, Skeleton, cn } from '../../components/ui'

const TIPOS = Object.keys(ETIQUETAS_TIPO) as TipoItem[]

export function ItemsPage() {
  const [params] = useSearchParams()
  const [modulos, setModulos] = useState<(Modulo & { _items: Item[] })[]>([])
  const [cargando, setCargando] = useState(true)
  const [moduloId, setModuloId] = useState(() => params.get('modulo') ?? '')
  const [modal, setModal] = useState(false)
  const [editando, setEditando] = useState<Item | null>(null)
  const [nuevoPadreId, setNuevoPadreId] = useState<string | null>(null)
  const [aBorrar, setABorrar] = useState<Item | null>(null)
  const [borrando, setBorrando] = useState(false)
  const [arrastrando, setArrastrando] = useState<number | null>(null)
  const [sobre, setSobre] = useState<{ idx: number; lado: 'arriba' | 'abajo' } | null>(null)

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
  const items = useMemo(() => itemsEnOrdenJerarquico(actual?._items ?? []), [actual])
  const secciones = useMemo(() => items.filter((i) => i.tipo === 'CONTENEDOR'), [items])
  const sumaModulo = useMemo(() => items.filter((i) => i.tipo === 'CONTENEDOR' || !i.padre_id).reduce((a, i) => a + pesoItem(i), 0), [items])

  async function soltarEn(hasta: number) {
    if (arrastrando == null) {
      setArrastrando(null)
      setSobre(null)
      return
    }
    const original = arrastrando
    const movido = items[original]
    // El arrastre reordena dentro de la misma sección/nivel; el cambio de sección se hace con el selector.
    const grupoId = movido.padre_id ?? '__raiz'
    const offset = items.findIndex((i) => (i.padre_id ?? '__raiz') === grupoId)
    const grupoLargo = items.filter((i) => (i.padre_id ?? '__raiz') === grupoId).length
    if (hasta < offset || hasta > offset + grupoLargo) {
      setArrastrando(null)
      setSobre(null)
      return
    }
    const rel = original < hasta ? hasta - 1 : hasta
    if (original === rel) {
      setArrastrando(null)
      setSobre(null)
      return
    }
    const nuevo = [...items]
    const [movidoGlobal] = nuevo.splice(original, 1)
    nuevo.splice(rel, 0, movidoGlobal)
    setArrastrando(null)
    setSobre(null)
    // Re-numera el orden de todo el módulo para que coincida con el nuevo orden de la lista
    await Promise.all(
      nuevo.map((it, idx) =>
        guardarItem({ id: it.id, modulo_id: it.modulo_id, tipo: it.tipo, texto: it.texto, orden: idx, padre_id: it.padre_id ?? null })
      )
    )
    await cargar()
  }

  async function moverASeccion(it: Item, padre: string | null) {
    await guardarItem({
      id: it.id,
      modulo_id: it.modulo_id,
      tipo: it.tipo,
      texto: it.texto,
      orden: it.orden,
      requerido: it.requerido,
      activo: it.activo,
      puntaje: it.puntaje ?? 0,
      padre_id: padre
    })
    await cargar()
  }

  // Posición visual (índice de inserción) donde se soltaría el ítem arrastrado
  const insertAt = sobre ? (sobre.lado === 'arriba' ? sobre.idx : sobre.idx + 1) : null

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
        <Button onClick={() => { setEditando(null); setNuevoPadreId(null); setModal(true) }} disabled={!moduloId}>+ Nuevo ítem</Button>
      </div>

      {cargando ? (
        <div className="space-y-2">
          <Skeleton className="h-9 w-full rounded-xl" />
          <div className="space-y-2">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-14 w-full rounded-xl" />)}
          </div>
        </div>
      ) : !actual ? (
        <div className="rounded-2xl border border-slate-200 bg-white py-12 text-center text-slate-500">Selecciona un módulo o crea uno primero.</div>
      ) : !items.length ? (
        <div className="rounded-2xl border border-slate-200 bg-white py-12 text-center text-slate-500">Este módulo no tiene ítems.</div>
      ) : (
        <div className={cn('space-y-2', arrastrando !== null && 'select-none')}>
          <div className={cn('flex flex-wrap items-center justify-between gap-2 rounded-xl px-3 py-2 text-sm font-semibold', sumaModulo > 100 ? 'bg-red-50 text-red-700 ring-1 ring-red-200' : 'bg-slate-50 text-slate-600')}>
            <span>Puntos asignados en el módulo</span>
            <span>{sumaModulo} / 100{sumaModulo > 100 ? ' — supera el máximo' : ''}</span>
          </div>
          {items.map((it, idx) => {
            const esSeccion = it.tipo === 'CONTENEDOR'
            const esHijo = !!it.padre_id
            const nHijos = hijosDe(items, it.id).length
            return (
              <Fragment key={it.id}>
                {insertAt === idx ? (
                  <div className={cn('flex items-center gap-1.5', esHijo ? 'pl-12' : 'px-1')} aria-hidden="true">
                    <span className="h-2 w-2 shrink-0 rounded-full bg-primary" />
                    <span className="h-0.5 flex-1 animate-pulse rounded-full bg-primary/60" />
                  </div>
                ) : null}
                <div
                  onDragOver={(e) => e.preventDefault()}
                  onDragEnter={(e) => {
                    if (arrastrando === null || arrastrando === idx) return
                    const rect = e.currentTarget.getBoundingClientRect()
                    const lado = e.clientY < rect.top + rect.height / 2 ? 'arriba' : 'abajo'
                    setSobre({ idx, lado })
                  }}
                  onDrop={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect()
                    const lado = e.clientY < rect.top + rect.height / 2 ? 'arriba' : 'abajo'
                    void soltarEn(lado === 'arriba' ? idx : idx + 1)
                  }}
                  className={cn(
                    'flex flex-wrap items-center gap-3 rounded-xl border p-3 transition-[border-color,background-color,opacity] duration-150',
                    esHijo && !esSeccion && 'ml-10 border-slate-100 bg-slate-50/40',
                    esSeccion && 'border-primary-200 bg-primary-50',
                    !esSeccion && !esHijo && 'border-slate-200 bg-white',
                    arrastrando === idx ? 'border-primary bg-primary-50 opacity-60' : '',
                    sobre?.idx === idx ? 'bg-primary-50/50' : ''
                  )}
                >
                  <button
                    type="button"
                    draggable
                    onDragStart={(e) => {
                      setArrastrando(idx)
                      setSobre(null)
                      e.dataTransfer.effectAllowed = 'move'
                      e.dataTransfer.setData('text/plain', String(idx))
                    }}
                    onDragEnd={() => { setArrastrando(null); setSobre(null) }}
                    className="grid h-10 w-8 shrink-0 cursor-grab touch-none place-items-center rounded-full text-slate-400 transition-colors hover:bg-primary-50 hover:text-primary active:cursor-grabbing"
                    title="Arrastrar para reordenar"
                    aria-label={`Reordenar ítem: ${it.texto}`}
                  >
                    <GripVertical className="h-5 w-5" />
                  </button>
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-slate-100 text-xs font-bold tabular-nums text-slate-600 ring-1 ring-inset ring-slate-200">{idx + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className={cn('text-sm font-medium', esSeccion ? 'font-bold text-primary-900' : 'text-slate-700')}>
                      {esSeccion ? <FolderOpen className="mr-1.5 inline h-4 w-4 text-primary" /> : null}
                      {it.texto}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <Badge color={tipoColor(it.tipo)}>{etiquetaTipo(it.tipo)}</Badge>
                      {esSeccion && nHijos > 0 ? <Badge color={0}>{nHijos} ítem(s) dentro</Badge> : null}
                      {it.requerido ? <Badge color={0}>Obligatorio</Badge> : null}
                      {!it.activo ? <Badge color={4}>Inactivo</Badge> : null}
                      {pesoItem(it) > 0 ? <Badge color={2}>{pesoItem(it)} pts</Badge> : <Badge color={4}>Sin puntos</Badge>}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    {!esSeccion ? (
                      <Select
                        value={it.padre_id ?? ''}
                        onChange={(e) => void moverASeccion(it, e.target.value || null)}
                        className="w-36 shrink-0"
                        aria-label={`Sección de ${it.texto}`}
                        title="Sección a la que pertenece este ítem"
                      >
                        <option value="">(Sin sección)</option>
                        {secciones.map((s) => <option key={s.id} value={s.id}>{s.texto}</option>)}
                      </Select>
                    ) : null}
                    {esSeccion ? (
                      <button
                        onClick={() => { setEditando(null); setNuevoPadreId(it.id); setModal(true) }}
                        className="inline-flex h-8 items-center gap-1 rounded-full border border-primary-200 px-3 text-sm font-semibold text-primary hover:bg-primary-50"
                      >
                        <Plus className="h-4 w-4" /> Ítem dentro
                      </button>
                    ) : null}
                    <button onClick={() => { setEditando(it); setNuevoPadreId(null); setModal(true) }} title="Editar" className="grid h-8 w-8 place-items-center rounded-full bg-primary text-white transition-colors hover:bg-primary-700"><Pencil className="h-4 w-4" /></button>
                    <button onClick={() => setABorrar(it)} title="Eliminar" className="grid h-8 w-8 place-items-center rounded-full bg-red-600 text-white transition-colors hover:bg-red-700"><Trash2 className="h-4 w-4" /></button>
                  </div>
                </div>
              </Fragment>
            )
          })}
          {insertAt === items.length ? (
            <div className="flex items-center gap-1.5 px-1" aria-hidden="true">
              <span className="h-2 w-2 shrink-0 rounded-full bg-primary" />
              <span className="h-0.5 flex-1 animate-pulse rounded-full bg-primary/60" />
            </div>
          ) : null}
        </div>
      )}

      <Modal open={modal} onClose={() => { setModal(false); setNuevoPadreId(null) }} title={editando ? 'Editar ítem' : nuevoPadreId ? 'Nuevo ítem dentro de la sección' : 'Nuevo ítem'} wide sinCerrarFuera>
        <FormItem
          moduloId={moduloId}
          modulos={modulos}
          inicial={editando}
          items={items}
          padreIdInicial={nuevoPadreId}
          onGuardar={async (d) => {
            const destino = modulos.find((m) => m.id === d.modulo_id)
            const mover = d.id != null && d.modulo_id !== moduloId
            if (destino) {
              const maxOrden = destino._items.reduce((a, i) => Math.max(a, i.orden), -1)
              if (!d.id || mover) d = { ...d, orden: maxOrden + 1 }
            }
            await guardarItem(d)
            setModal(false)
            setNuevoPadreId(null)
            if (mover) setModuloId(d.modulo_id)
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
            {aBorrar.tipo === 'CONTENEDOR' && hijosDe(items, aBorrar.id).length > 0 ? (
              <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
                Esta sección contiene <strong>{hijosDe(items, aBorrar.id).length} ítem(s)</strong>. También se eliminarán junto con la sección.
              </p>
            ) : null}
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
  return t === 'CUMPLE_NO_CUMPLE' ? 3 : t === 'CONCILIACION' ? 6 : t === 'CHECKLIST' ? 5 : t === 'LISTA_COLABORADORES' ? 1 : t === 'UNIDAD_CHECKLIST' ? 1 : 4
}

function FormItem({
  moduloId,
  modulos,
  inicial,
  items,
  padreIdInicial = null,
  onGuardar
}: {
  moduloId: string
  modulos: (Modulo & { _items: Item[] })[]
  inicial: Item | null
  items: Item[]
  padreIdInicial?: string | null
  onGuardar: (d: Partial<Item> & { modulo_id: string; tipo: TipoItem; texto: string; sku?: string }) => Promise<void>
}) {
  const [moduloSel, setModuloSel] = useState<string>(inicial?.modulo_id ?? moduloId)
  const [tipo, setTipo] = useState<TipoItem>(inicial?.tipo ?? 'CUMPLE_NO_CUMPLE')
  const [texto, setTexto] = useState(inicial?.texto ?? '')
  const [puntos, setPuntos] = useState<number | ''>(inicial?.puntaje ?? 0)
  const [opciones, setOpciones] = useState<Opcion[]>(inicial?.opciones?.length ? inicial.opciones : [{ id: 'o1', etiqueta: '' }, { id: 'o2', etiqueta: '' }])
  const [requerido, setRequerido] = useState(inicial?.requerido ?? false)
  const [activo, setActivo] = useState(inicial?.activo ?? true)
  const [filtroColaboradores, setFiltroColaboradores] = useState<FiltroColaboradores>(inicial?.colaboradores_filtro ?? 'ACTIVOS')
  const [responsables, setResponsables] = useState<string[]>(inicial?.responsables?.length ? inicial.responsables : [])
  const [padreId, setPadreId] = useState<string | null>(inicial?.padre_id ?? padreIdInicial)
  const [autoPuntaje, setAutoPuntaje] = useState(false)

  const esSeccion = tipo === 'CONTENEDOR'
  const conChecklist = tipo === 'CHECKLIST' || tipo === 'LISTA_COLABORADORES' || tipo === 'UNIDAD_CHECKLIST'
  const itemsModulo = modulos.find((m) => m.id === moduloSel)?._items ?? items
  const seccionesDisponibles = itemsModulo.filter((i) => i.tipo === 'CONTENEDOR' && i.id !== inicial?.id)

  // Peso del módulo: solo secciones (ponderadas) e ítems sueltos. Los hijos de una
  // sección no suman al módulo: su tope es el puntaje de la sección.
  const otros = itemsModulo
    .filter((i) => i.id !== inicial?.id && (i.tipo === 'CONTENEDOR' || !i.padre_id))
    .reduce((a, i) => a + pesoItem(i), 0)
  const aportaModulo = esSeccion || !padreId ? Number(puntos) || 0 : 0
  const sumaConNuevo = otros + aportaModulo
  const excede = sumaConNuevo > 100

  // Zona del grupo: la suma de los ítems del grupo no puede superar el puntaje de la sección.
  const seccionDeGrupo = padreId ? itemsModulo.find((i) => i.id === padreId) : null
  const sumaHermanos = padreId
    ? itemsModulo.filter((i) => i.padre_id === padreId && i.id !== inicial?.id).reduce((a, i) => a + pesoItem(i), 0)
    : 0
  const excedeGrupo = !!padreId && !!seccionDeGrupo && sumaHermanos + (Number(puntos) || 0) > pesoItem(seccionDeGrupo ?? null)
  const sumaHijosPropios = esSeccion && inicial ? itemsModulo.filter((i) => i.padre_id === inicial.id).reduce((a, i) => a + pesoItem(i), 0) : 0
  const excedeHijos = esSeccion && inicial ? (Number(puntos) || 0) < sumaHijosPropios : false

  const sumaPuntosOpciones = opciones.reduce((a, o) => a + (o.puntos && o.puntos > 0 ? o.puntos : 0), 0)
  const rangoIncompleto = opciones.some((o) => o.tipo_respuesta === 'RANGO' && o.etiqueta.trim() && typeof o.minimo !== 'number')

  // CHECKLIST con puntaje automático: reparte el peso del ítem en partes iguales
  // entre las opciones con etiqueta, redondeado a 3 decimales (mín. 0.001 por opción).
  const nOpcionesConTexto = opciones.filter((o) => o.etiqueta.trim()).length
  useEffect(() => {
    if (!autoPuntaje) return
    const v = Number(puntos) || 0
    setOpciones((prev) =>
      v > 0 && nOpcionesConTexto > 0
        ? prev.map((o) => ({ ...o, puntos: redondear3(v / nOpcionesConTexto) }))
        : prev.map((o) => ({ ...o, puntos: undefined }))
    )
  }, [autoPuntaje, puntos, nOpcionesConTexto])

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (excede || rangoIncompleto || excedeGrupo || excedeHijos) return
        void onGuardar({
          id: inicial?.id,
          modulo_id: moduloSel,
          tipo,
          texto,
          puntaje: Number(puntos) || 0,
          opciones: esSeccion
            ? []
            : conChecklist
              ? opciones
                  .filter((o) => o.etiqueta.trim())
                  .map((o) => (tipo === 'CHECKLIST' ? o : { id: o.id, etiqueta: o.etiqueta, responsable: o.responsable }))
              : [],
          colaboradores_filtro: !esSeccion && tipo === 'LISTA_COLABORADORES' ? filtroColaboradores : null,
          responsables: !esSeccion && conChecklist ? responsables.filter((r) => r.trim()) : [],
          requerido: esSeccion ? false : requerido,
          activo,
          padre_id: esSeccion ? null : padreId
        })
      }}
    >
      <Field label="Módulo">
        <Select value={moduloSel} onChange={(e) => setModuloSel(e.target.value)}>
          {modulos.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
        </Select>
      </Field>
      {inicial && inicial.modulo_id !== moduloSel ? (
        <p className="rounded-xl bg-primary-50 px-3 py-2 text-xs font-medium text-primary-900">
          El ítem se moverá al módulo «{modulos.find((m) => m.id === moduloSel)?.nombre ?? ''}» y se añadirá al final de su lista.
        </p>
      ) : null}
      <Field label="Tipo de ítem">
        <Select value={tipo} onChange={(e) => setTipo(e.target.value as TipoItem)}>
          {TIPOS.map((t) => <option key={t} value={t}>{etiquetaTipo(t)}</option>)}
        </Select>
      </Field>
      <Field label={esSeccion ? 'Nombre de la sección' : 'Pregunta / enunciado'}>
        <Textarea
          rows={esSeccion ? 1 : 2}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          required
          placeholder={esSeccion ? 'Ej. Seguridad e higiene…' : 'Ej. Los pasillos están libres de obstáculos…'}
        />
      </Field>
      {!esSeccion ? (
        <Field label="Sección (opcional)" hint="Si elegís una sección, este ítem se mostrará agrupado dentro de ella en la evaluación.">
          <Select value={padreId ?? ''} onChange={(e) => setPadreId(e.target.value || null)}>
            <option value="">(Sin sección)</option>
            {seccionesDisponibles.map((s) => <option key={s.id} value={s.id}>{s.texto}</option>)}
          </Select>
        </Field>
      ) : null}
      <Field
        label={esSeccion ? 'Puntos de la sección (ponderación)' : 'Puntos (ponderación)'}
        hint={esSeccion
          ? 'Peso de la sección en el módulo. Los ítems del grupo suman como máximo este valor; secciones + ítems sueltos del módulo no pueden superar 100.'
          : padreId
            ? 'Peso dentro de la sección. La suma de los ítems del grupo no puede superar el puntaje de la sección.'
            : 'Peso del ítem en el módulo. La suma de todos los ítems del módulo no puede superar 100.'}
      >
        <Input
          type="number"
          min={0}
          max={100}
          step={0.001}
          value={puntos}
          onChange={(e) => setPuntos(e.target.value === '' ? '' : Number(e.target.value))}
        />
      </Field>
      {esSeccion ? (
        <p className="rounded-xl border border-primary-200 bg-primary-50 p-3 text-xs text-slate-600">
          {sumaHijosPropios > 0 ? (
            <>La sección pondera <strong>{Number(puntos) || 0} pts</strong>; sus ítems ya suman <strong>{sumaHijosPropios} pts</strong> (tope del grupo).</>
          ) : (
            'Las secciones pueden ponderarse (ej. 60 pts): los ítems que contiene suman como máximo el puntaje de la sección y ese peso cuenta para el módulo.'
          )}
        </p>
      ) : null}
      {excede ? (
        <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-medium text-red-600">
          Con estos puntos el módulo sumaría {sumaConNuevo}/100. Baja el valor para no superar 100.
        </p>
      ) : null}
      {excedeGrupo ? (
        <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-medium text-red-600">
          {pesoItem(seccionDeGrupo ?? null) > 0 ? (
            <>El grupo «{seccionDeGrupo?.texto}» tiene {sumaHermanos} pts; con estos puntos el grupo sumaría {sumaHermanos + (Number(puntos) || 0)}/{pesoItem(seccionDeGrupo ?? null)}. Reducí el valor para no superar el puntaje de la sección.</>
          ) : (
            <>El grupo «{seccionDeGrupo?.texto}» no tiene puntos asignados. Primero ponderá la sección para poder darles puntos a sus ítems.</>
          )}
        </p>
      ) : null}
      {excedeHijos ? (
        <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-medium text-red-600">
          La sección ya tiene {sumaHijosPropios} pts repartidos en sus ítems; el puntaje no puede ser menor a esa suma.
        </p>
      ) : null}
      {tipo === 'CHECKLIST' ? (
        <>
          <label className="flex items-start gap-2 rounded-xl border border-slate-200 bg-slate-50/60 px-3.5 py-3 text-sm text-slate-700">
            <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-primary" checked={autoPuntaje} onChange={(e) => setAutoPuntaje(e.target.checked)} />
            <span>
              <strong>Puntaje automático</strong>
              <span className="block text-xs font-normal text-slate-500">Reparte el peso del ítem en partes iguales entre las opciones (peso ÷ nº de checks, ej. 6 ÷ 15 = 0.4 por check).</span>
            </span>
          </label>
          <Field
            label="Lista de opciones"
            hint="El ítem cumple al marcar todas las opciones. En «Rango de valor» el punto solo cumple si el evaluador ingresa un valor mayor o igual al mínimo aceptable. Los puntos por opción admiten hasta 3 decimales (mínimo 0.001); si asignás puntos a TODAS las opciones, la puntuación del ítem se reparte."
          >
            <EditorOpciones opciones={opciones} onChange={setOpciones} responsables={responsables} conPuntos conRango puntosBloqueados={autoPuntaje} />
          </Field>
          {rangoIncompleto ? (
            <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-medium text-red-600">
              Hay opciones de tipo «Rango de valor» sin mínimo aceptable. Definí el mínimo en todas para poder guardar.
            </p>
          ) : null}
          {sumaPuntosOpciones > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-primary-50 px-3 py-2">
              <p className="text-xs font-medium text-primary-900">
                Puntos de las opciones: <strong>{sumaPuntosOpciones} pts</strong> · se reparten sobre el peso del ítem ({Number(puntos) || 0} pts).
              </p>
              <Button type="button" variant="secondary" className="shrink-0" onClick={() => setPuntos(sumaPuntosOpciones)}>
                Usar la suma como peso del ítem
              </Button>
            </div>
          ) : null}
        </>
      ) : null}
      {tipo === 'LISTA_COLABORADORES' ? (
        <>
          <Field label="Checklist de cada colaborador (se aplica a todos los colaboradores de la tienda)">
            <EditorOpciones opciones={opciones} onChange={setOpciones} responsables={responsables} />
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
      {tipo === 'UNIDAD_CHECKLIST' ? (
        <>
          <Field label="Checklist de cada unidad (se aplica a todas las unidades que se agreguen)">
            <EditorOpciones opciones={opciones} onChange={setOpciones} responsables={responsables} />
          </Field>
          <p className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">
            En la evaluación el evaluador agrega cada unidad (valor alfanumérico) una a una y marca este mismo checklist para cada una. El ítem cumple cuando todas las unidades agregadas tienen su checklist completo.
          </p>
        </>
      ) : null}
      {conChecklist ? (
        <EditorResponsables responsables={responsables} onChange={setResponsables} />
      ) : null}
      {tipo === 'CONCILIACION' ? (
        <p className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">
          En la evaluación, el evaluador agrega los productos (escaneando o escribiendo el SKU) y registra las cantidades teórica y física por cada uno.
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-slate-200 bg-slate-50/60 px-3.5 py-3">
        {!esSeccion ? (
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" className="h-5 w-5 accent-primary" checked={requerido} onChange={(e) => setRequerido(e.target.checked)} />
            Ítem obligatorio
          </label>
        ) : null}
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" className="h-5 w-5 accent-primary" checked={activo} onChange={(e) => setActivo(e.target.checked)} />
          Ítem activo (visible en evaluaciones)
        </label>
      </div>
      <Button type="submit" className="w-full" disabled={excede || rangoIncompleto || excedeGrupo || excedeHijos}>Guardar ítem</Button>
    </form>
  )
}

function EditorOpciones({ opciones, onChange, responsables = [], conPuntos = false, conRango = false, puntosBloqueados = false }: { opciones: Opcion[]; onChange: (o: Opcion[]) => void; responsables?: string[]; conPuntos?: boolean; conRango?: boolean; puntosBloqueados?: boolean }) {
  const [arrastrando, setArrastrando] = useState<number | null>(null)
  const [sobre, setSobre] = useState<number | null>(null)

  const cambiar = (i: number, etiqueta: string) => {
    const nuevo = opciones.map((o, idx) => (idx === i ? { ...o, etiqueta } : o))
    onChange(nuevo)
  }
  const cambiarResponsable = (i: number, responsable: string) => {
    const nuevo = opciones.map((o, idx) => (idx === i ? { ...o, responsable: responsable.trim() || undefined } : o))
    onChange(nuevo)
  }
  const cambiarPuntos = (i: number, valor: string) => {
    const n = Number(valor)
    // Hasta 3 decimales y mínimo 0.001 por opción; el vacío quita los puntos.
    const puntos = valor.trim() !== '' && Number.isFinite(n) && n > 0 ? redondear3(Math.max(0.001, n)) : undefined
    const nuevo = opciones.map((o, idx) => (idx === i ? { ...o, puntos } : o))
    onChange(nuevo)
  }
  const cambiarTipoRespuesta = (i: number, tipo: 'CHECK' | 'RANGO') => {
    const nuevo = opciones.map((o, idx) =>
      idx === i
        ? tipo === 'RANGO'
          ? { ...o, tipo_respuesta: 'RANGO' as const }
          : { ...o, tipo_respuesta: undefined, minimo: undefined, maximo: undefined, unidad: undefined }
        : o
    )
    onChange(nuevo)
  }
  const cambiarMinimo = (i: number, valor: string) => {
    const n = Number(valor)
    const minimo = valor.trim() !== '' && Number.isFinite(n) ? n : undefined
    const nuevo = opciones.map((o, idx) => (idx === i ? { ...o, minimo } : o))
    onChange(nuevo)
  }
  const cambiarMaximo = (i: number, valor: string) => {
    const n = Number(valor)
    const maximo = valor.trim() !== '' && Number.isFinite(n) && n > 0 ? n : undefined
    const nuevo = opciones.map((o, idx) => (idx === i ? { ...o, maximo } : o))
    onChange(nuevo)
  }
  const cambiarUnidad = (i: number, unidad: string) => {
    const nuevo = opciones.map((o, idx) => (idx === i ? { ...o, unidad: unidad.trim() || undefined } : o))
    onChange(nuevo)
  }
  const agregar = () => onChange([...opciones, { id: `o${Date.now()}`, etiqueta: '' }])
  const quitar = (i: number) => onChange(opciones.filter((_, idx) => idx !== i))
  const soltarEn = (j: number) => {
    if (arrastrando == null || arrastrando === j) return
    const nuevo = [...opciones]
    const [movido] = nuevo.splice(arrastrando, 1)
    nuevo.splice(j, 0, movido)
    onChange(nuevo)
    setArrastrando(null)
    setSobre(null)
  }

  return (
    <div className="space-y-2">
      {opciones.map((o, i) => (
        <div
          key={o.id}
          onDragOver={(e) => e.preventDefault()}
          onDragEnter={() => { if (arrastrando !== null && arrastrando !== i) setSobre(i) }}
          onDrop={() => soltarEn(i)}
          className={cn(
            'space-y-2 rounded-xl border border-slate-200 bg-white p-2',
            arrastrando === i ? 'border-primary bg-primary-50/40' : '',
            sobre === i ? 'ring-2 ring-primary ring-offset-1' : ''
          )}
        >
          <div className="flex flex-wrap items-end gap-2">
            <button
              type="button"
              draggable
              onDragStart={(e) => {
                setArrastrando(i)
                setSobre(null)
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('text/plain', String(i))
              }}
              onDragEnd={() => { setArrastrando(null); setSobre(null) }}
              className="grid h-10 w-10 shrink-0 cursor-grab place-items-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600 active:cursor-grabbing"
              title="Arrastrar para reordenar"
            >
              <GripVertical className="h-5 w-5" />
            </button>
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-slate-100 text-xs font-bold tabular-nums text-slate-600 ring-1 ring-inset ring-slate-200">{i + 1}</span>
            <Input value={o.etiqueta} onChange={(e) => cambiar(i, e.target.value)} placeholder={`Opción ${i + 1}`} className="min-w-40 flex-1" />
            {conPuntos ? (
              <label className="flex shrink-0 flex-col gap-1">
                <span className="px-0.5 text-[11px] font-semibold text-slate-500">{puntosBloqueados ? 'Puntos (auto)' : 'Puntos'}</span>
                <Input
                  type="number"
                  min={0.001}
                  step={0.001}
                  value={o.puntos ?? ''}
                  onChange={(e) => cambiarPuntos(i, e.target.value)}
                  disabled={puntosBloqueados}
                  className="w-20 shrink-0 disabled:bg-slate-100 disabled:text-slate-400"
                  style={{ borderColor: 'var(--color-primary-400)' }}
                  title={puntosBloqueados ? 'El puntaje automático reparte el peso del ítem entre las opciones.' : 'Hasta 3 decimales, mínimo 0.001.'}
                  aria-label={`Puntos de la opción ${i + 1}`}
                />
              </label>
            ) : null}
            {responsables.length && !conRango ? (
              <label className="flex shrink-0 flex-col gap-1">
                <span className="px-0.5 text-[11px] font-semibold text-slate-500">Responsable directo</span>
                <Select value={o.responsable ?? ''} onChange={(e) => cambiarResponsable(i, e.target.value)} className="w-44 shrink-0">
                  <option value="">(Sin asignar)</option>
                  {responsables.map((r) => <option key={r} value={r}>{r}</option>)}
                </Select>
              </label>
            ) : null}
            <button type="button" onClick={() => quitar(i)} className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-red-500 hover:bg-red-50" title="Eliminar opción"><Trash2 className="h-5 w-5" /></button>
          </div>
          {conRango ? (
            <div className="flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 px-2.5 py-2">
              <label className="flex shrink-0 flex-col gap-1">
                <span className="px-0.5 text-[11px] font-semibold text-slate-500">Tipo de control</span>
                <Select
                  value={o.tipo_respuesta ?? 'CHECK'}
                  onChange={(e) => cambiarTipoRespuesta(i, e.target.value as 'CHECK' | 'RANGO')}
                  className="w-32 shrink-0"
                  aria-label={`Tipo de respuesta de la opción ${i + 1}`}
                >
                  <option value="CHECK">Check</option>
                  <option value="RANGO">Rango de valor</option>
                </Select>
              </label>
              {responsables.length ? (
                <label className="flex shrink-0 flex-col gap-1">
                  <span className="px-0.5 text-[11px] font-semibold text-slate-500">Responsable directo</span>
                  <Select value={o.responsable ?? ''} onChange={(e) => cambiarResponsable(i, e.target.value)} className="w-44 shrink-0">
                    <option value="">(Sin asignar)</option>
                    {responsables.map((r) => <option key={r} value={r}>{r}</option>)}
                  </Select>
                </label>
              ) : null}
              {o.tipo_respuesta === 'RANGO' ? (
                <>
                  <label className="flex shrink-0 flex-col gap-1">
                    <span className="px-0.5 text-[11px] font-semibold text-slate-500">Mínimo aceptable</span>
                    <Input
                      type="number"
                      step="any"
                      value={o.minimo ?? ''}
                      onChange={(e) => cambiarMinimo(i, e.target.value)}
                      className="w-32 shrink-0"
                      aria-label={`Mínimo aceptable de la opción ${i + 1}`}
                    />
                  </label>
                  <label className="flex shrink-0 flex-col gap-1">
                    <span className="px-0.5 text-[11px] font-semibold text-slate-500">Máximo (opcional)</span>
                    <Input
                      type="number"
                      step="any"
                      value={o.maximo ?? ''}
                      onChange={(e) => cambiarMaximo(i, e.target.value)}
                      className="w-32 shrink-0"
                      title="Tope derecho de la barra. Si se omite, máximo = 2 × mínimo (mínimo 100)."
                      aria-label={`Máximo de la opción ${i + 1}`}
                    />
                  </label>
                  <label className="flex shrink-0 flex-col gap-1">
                    <span className="px-0.5 text-[11px] font-semibold text-slate-500">Unidad (opcional)</span>
                    <Input
                      value={o.unidad ?? ''}
                      onChange={(e) => cambiarUnidad(i, e.target.value)}
                      className="w-32 shrink-0"
                      aria-label={`Unidad de la opción ${i + 1}`}
                    />
                  </label>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      ))}
      <Button type="button" variant="secondary" onClick={agregar}>+ Agregar opción</Button>
    </div>
  )
}

function EditorResponsables({ responsables, onChange }: { responsables: string[]; onChange: (r: string[]) => void }) {
  const [nuevo, setNuevo] = useState('')

  const agregar = () => {
    const r = nuevo.trim()
    if (!r) return
    if (responsables.some((x) => x.toLowerCase() === r.toLowerCase())) {
      setNuevo('')
      return
    }
    onChange([...responsables, r])
    setNuevo('')
  }

  return (
    <Field label="Responsables" hint="Nombres que podrás asignar a cada punto con el selector de la derecha. Los puntos que no se cumplan se acumulan a su responsable.">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Input value={nuevo} onChange={(e) => setNuevo(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); agregar() } }} placeholder="Ej. Mecánico, Chofer…" />
          <Button type="button" variant="secondary" className="shrink-0" onClick={agregar} disabled={!nuevo.trim()}>Agregar</Button>
        </div>
        {responsables.length ? (
          <div className="flex flex-wrap gap-2">
            {responsables.map((r) => (
              <span key={r} className="inline-flex items-center gap-1 rounded-full bg-primary-50 px-2.5 py-1 text-xs font-bold text-primary-900">
                {r}
                <button type="button" onClick={() => onChange(responsables.filter((x) => x !== r))} className="text-primary-400 hover:text-red-500" title="Quitar responsable">
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
          </div>
        ) : (
          <p className="text-xs text-slate-400">Sin responsables configurados. Los puntos quedarán sin responsable y no se acumularán incumplimientos.</p>
        )}
      </div>
    </Field>
  )
}