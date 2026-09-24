import { useRef, useState } from 'react'
import { Camera, Check, ChevronDown, Info, Pencil, RefreshCw, ScanLine, Trash2, X } from 'lucide-react'
import type { Item, Opcion } from '../lib/types'
import { etiquetaTipo, conciliacionPorcentaje, conciliacionTotal, colaboradorCumple, unidadCumple, type ValorChecklist, type ValorConciliacion, type ProductoConciliacion, type ValorCumple, type EvidenciaCumple, type ValorListaColaboradores, type ColaboradorItem, type ValorUnidadChecklist, type UnidadChecklist } from '../lib/scoring'
import { buscarProducto } from '../lib/data/precios'
import { listarColaboradores } from '../lib/data/colaboradores'
import { Badge, cn, Input, Textarea, Button, Spinner, Confirmar } from './ui'
import { SwipeAcciones } from './SwipeAcciones'
import { guardarFotosDe, MinaFotos, PhotoCapture } from './PhotoCapture'
import { BarcodeScanner } from './BarcodeScanner'
import { deletePhoto } from '../lib/offline/db'

interface Props {
  item: Item
  valor: unknown
  onChange: (valor: unknown) => void
  index: number
  total: number
  shopId?: string | null
  branchId?: string | null
}

export function ItemRenderer({ item, valor, onChange, index, total, shopId, branchId }: Props) {
  const preg = `${index + 1}. ${item.texto}` + (item.requerido ? ' *' : '')
  const tipoColor =
    item.tipo === 'CUMPLE_NO_CUMPLE' ? 3 : item.tipo === 'CONCILIACION' ? 6 : item.tipo === 'CHECKLIST' ? 5 : item.tipo === 'LISTA_COLABORADORES' || item.tipo === 'UNIDAD_CHECKLIST' ? 1 : 4

  return (
    <section className="rounded-2xl bg-white p-4">
      <div className="mb-3 flex items-start justify-between gap-2">
        <p className="font-semibold text-slate-800">{preg}</p>
        <Badge color={tipoColor}>{etiquetaTipo(item.tipo)}</Badge>
      </div>
      <Contenido item={item} valor={valor} onChange={onChange} shopId={shopId} branchId={branchId} />
      {item.requerido && estaVacio(item, valor) ? (
        <p className="mt-2 text-xs font-medium text-red-600">Obligatorio para enviar la evaluación.</p>
      ) : null}
      <p className="mt-2 text-[11px] text-slate-400">Pregunta {index + 1} de {total}</p>
    </section>
  )
}

function estaVacio(item: Item, valor: unknown): boolean {
  switch (item.tipo) {
    case 'CUMPLE_NO_CUMPLE':
      return (valor as ValorCumple | null)?.value !== true && (valor as ValorCumple | null)?.value !== false
    case 'CHECKLIST':
      return !((valor as { selected?: string[] } | null)?.selected?.length)
    case 'CONCILIACION': {
      const ps = (valor as ValorConciliacion | null)?.productos ?? []
      return ps.length === 0 || ps.some((p) => !p.sku.trim() || p.teorica == null || p.fisica == null)
    }
    case 'LISTA_COLABORADORES':
      return !((valor as ValorListaColaboradores | null)?.colaboradores?.length)
    case 'UNIDAD_CHECKLIST':
      return !((valor as ValorUnidadChecklist | null)?.unidades?.length)
    default:
      return false
  }
}

function Contenido({ item, valor, onChange, shopId, branchId }: { item: Item; valor: unknown; onChange: (v: unknown) => void; shopId?: string | null; branchId?: string | null }) {
  switch (item.tipo) {
    case 'CUMPLE_NO_CUMPLE': {
      const v = (valor as ValorCumple | null) ?? { value: null, evidencias: [] }
      const value = v.value ?? null
      const evidencias = v.evidencias ?? []
      const informativo = v.informativo ?? false
      const setValue = (valor2: boolean) => onChange({ ...v, value: valor2 })
      const setEvidencias = (evs: EvidenciaCumple[]) => onChange({ ...v, evidencias: evs })
      const setInformativo = (b: boolean) => onChange({ ...v, informativo: b })
      return (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <BotonCumple activo={value === true} onPick={() => setValue(true)} />
            <BotonNoCumple activo={value === false} onPick={() => setValue(false)} />
          </div>
          <BotonInformativo activo={informativo} onClick={() => setInformativo(!informativo)}>
            Informativo · no descuenta puntos
          </BotonInformativo>
          <EvidenciasEditor evidencias={evidencias} onChange={setEvidencias} />
        </div>
      )
    }
    case 'CHECKLIST': {
      const value = ((valor as ValorChecklist | null) ?? { selected: [], informativos: [], evidencias: {} })
      const seleccion = value.selected ?? []
      const informativos = value.informativos ?? []
      const evidencias = value.evidencias ?? {}
      const opts = (item.opciones ?? []) as Opcion[]
      if (!opts.length) return <p className="text-sm text-slate-400">Sin opciones definidas.</p>
      const conPuntos = opts.length > 0 && opts.every((o) => typeof o.puntos === 'number' && o.puntos > 0)
      const toggle = (id: string) => {
        const existe = seleccion.includes(id)
        if (existe) {
          const valores2 = { ...(value.valores ?? {}) }
          delete valores2[id]
          onChange({ ...value, selected: seleccion.filter((x) => x !== id), valores: valores2 })
        } else {
          onChange({ ...value, selected: [...seleccion, id] })
        }
      }
      const setValorRango = (id: string, texto: string) => {
        const valores2 = { ...(value.valores ?? {}) }
        const n = Number(texto)
        if (texto.trim() === '' || !Number.isFinite(n)) delete valores2[id]
        else valores2[id] = n
        onChange({ ...value, valores: valores2 })
      }
      const toggleInformativo = (id: string) => {
        const existe = informativos.includes(id)
        onChange({ ...value, informativos: existe ? informativos.filter((x) => x !== id) : [...informativos, id] })
      }
      const setEvidencia = (id: string, photoIds: string[]) => {
        onChange({ ...value, evidencias: { ...evidencias, [id]: { photoIds } } })
      }
      const quitarEvidencia = (id: string, photoId: string) => {
        void deletePhoto(photoId)
        setEvidencia(id, (evidencias[id]?.photoIds ?? []).filter((x) => x !== photoId))
      }
      return (
        <div className="space-y-2">
          <p className="text-xs text-slate-400">
            {conPuntos
              ? 'El ítem otorga los puntos de las opciones marcadas. Marca “Informativo” en la opción cuya falla corresponde a otra área; no descontará puntos.'
              : 'Marca “Informativo” en la opción cuya falla corresponde a otra área; no descontará puntos.'}
          </p>
          {opts.map((o) => {
            const activo = seleccion.includes(o.id)
            const esInformativo = informativos.includes(o.id)
            const idsEv = evidencias[o.id]?.photoIds ?? []
            const esRango = o.tipo_respuesta === 'RANGO'
            const valorRango = activo && esRango ? (value.valores?.[o.id] ?? null) : null
            const rangoOk = esRango && typeof valorRango === 'number' && typeof o.minimo === 'number' && valorRango >= o.minimo
            return (
              <div
                key={o.id}
                className={cn(
                  'rounded-xl border transition-colors',
                  esInformativo
                    ? 'border-amber-200 bg-amber-50'
                    : activo && esRango && !rangoOk
                      ? 'border-red-200 bg-red-50'
                      : activo
                        ? 'border-primary bg-primary-50'
                        : 'border-slate-200 bg-white'
                )}
              >
                <div className="flex items-center gap-2 px-3 py-2.5">
                  <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                    <input
                      type="checkbox"
                      className="h-5 w-5 shrink-0 accent-primary"
                      checked={activo}
                      onChange={() => toggle(o.id)}
                    />
                    <span className="text-sm text-slate-700">{o.etiqueta}</span>
                    {esRango ? (
                      <span className="ml-1 shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                        {o.tipo_respuesta === 'RANGO' ? `Valor (mín. ${o.minimo ?? '—'}${o.unidad ? ` ${o.unidad}` : ''})` : ''}
                      </span>
                    ) : null}
                    {o.responsable ? <span className="ml-1 shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">{o.responsable}</span> : null}
                    {o.puntos != null && o.puntos > 0 ? <span className="ml-1 shrink-0 rounded-full bg-primary-50 px-2 py-0.5 text-[11px] font-bold tabular-nums text-primary-700">{o.puntos} pts</span> : null}
                  </label>
                  <button
                    type="button"
                    onClick={() => toggleInformativo(o.id)}
                    title="Informativo: no descuenta puntos (falla de otra área)"
                    className={cn(
                      'inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold transition-colors',
                      esInformativo ? 'bg-amber-100 text-amber-800' : 'text-slate-400 hover:bg-amber-50 hover:text-amber-600'
                    )}
                  >
                    <Info className="h-3 w-3" />
                    {esInformativo ? 'Informativo' : 'Marcar'}
                  </button>
                  {!activo ? (
                    <FotoOpcion
                      photoIds={idsEv}
                      onChange={(ids) => setEvidencia(o.id, ids)}
                    />
                  ) : null}
                </div>
                {esRango && activo ? (
                  <div className="space-y-1.5 px-3 pb-3">
                    <div className="flex items-center gap-2">
                      <span className="shrink-0 text-[11px] font-semibold text-slate-500">Valor ingresado</span>
                      <Input
                        type="number"
                        inputMode="decimal"
                        step="any"
                        value={valorRango ?? ''}
                        onChange={(e) => setValorRango(o.id, e.target.value)}
                        placeholder={`Mín. ${o.minimo ?? '—'}${o.unidad ? ` ${o.unidad}` : ''}`}
                        aria-label={`Valor de ${o.etiqueta}`}
                      />
                      {o.unidad ? <span className="shrink-0 text-xs text-slate-500">{o.unidad}</span> : null}
                    </div>
                    {typeof valorRango === 'number' && typeof o.minimo === 'number' && valorRango < o.minimo ? (
                      <p className="text-[11px] font-semibold text-red-600">Debe ser ≥ {o.minimo}{o.unidad ? ` ${o.unidad}` : ''} para considerar el punto cumplido.</p>
                    ) : null}
                  </div>
                ) : null}
                {!activo && idsEv.length > 0 ? (
                  <div className="px-3 pb-3">
                    <MinaFotos photoIds={idsEv} onQuitar={(fid) => quitarEvidencia(o.id, fid)} />
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      )
    }
    case 'CONCILIACION':
      return <ConciliacionEditor valor={valor} onChange={onChange} shopId={shopId} />
    case 'LISTA_COLABORADORES':
      return <ColaboradoresEditor item={item} valor={valor} onChange={onChange} shopId={shopId} branchId={branchId} />
    case 'UNIDAD_CHECKLIST':
      return <UnidadesEditor item={item} valor={valor} onChange={onChange} />
    default:
      return null
  }
}

export function ConciliacionEditor({ valor, onChange, shopId }: { valor: unknown; onChange: (v: unknown) => void; shopId?: string | null }) {
  const [escaneando, setEscaneando] = useState(false)
  const [consultando, setConsultando] = useState(false)
  const [info, setInfo] = useState('')
  const [exito, setExito] = useState('')
  const [verLista, setVerLista] = useState(false)
  const [aEliminar, setAEliminar] = useState<{ producto: ProductoConciliacion; index: number } | null>(null)
  const [editando, setEditando] = useState<number | null>(null)
  const [edicion, setEdicion] = useState<{ teorica: number | null; fisica: number | null }>({ teorica: null, fisica: null })
  const [borrador, setBorrador] = useState<ProductoConciliacion>({ sku: '', nombre: null, teorica: null, fisica: null })

  const v = (valor as ValorConciliacion | null) ?? { productos: [] }
  const productos = v.productos ?? []
  const informativo = v.informativo ?? false

  const actualizar = (items: ProductoConciliacion[]) => onChange({ ...v, productos: items })
  const actualizarProducto = (i: number, patch: Partial<ProductoConciliacion>) =>
    actualizar(productos.map((p, idx) => (idx === i ? { ...p, ...patch } : p)))
  const promedio = conciliacionTotal(v)

  const conciliadas = productos.filter((p) => p.teorica != null && p.fisica != null && (p.teorica ?? 0) > 0 && p.fisica === p.teorica).length
  const desconciliadas = productos.filter((p) => p.teorica != null && p.fisica != null && (p.teorica ?? 0) > 0 && p.fisica !== p.teorica).length

  const codigoActual = borrador.sku.trim()
  const existenteIdx = codigoActual ? productos.findIndex((p) => p.sku === codigoActual) : -1
  const existente = existenteIdx >= 0 ? productos[existenteIdx] : null
  const fisicaResultante =
    borrador.fisica == null
      ? null
      : existente
        ? (existente.fisica ?? 0) + borrador.fisica
        : borrador.fisica

  const aplicarCodigo = async () => {
    const codigo = borrador.sku.trim()
    setInfo('')
    setExito('')
    if (!codigo) return
    const ya = productos.find((p) => p.sku === codigo)
    if (ya) {
      // Ya fue escaneado en esta evaluación: trae el producto con su teórica y
      // deja la física vacía para cargar solo el nuevo conteo (se sumará al guardar).
      setBorrador({ sku: codigo, nombre: ya.nombre, teorica: ya.teorica, fisica: null })
      return
    }
    if (!shopId) {
      setInfo('Nº tienda (shop_id) no configurado en la sucursal.')
      return
    }
    setConsultando(true)
    const r = await buscarProducto(codigo, shopId)
    setConsultando(false)
    if (r.nombre) {
      setBorrador((b) => ({ ...b, nombre: r.nombre }))
    } else {
      setInfo(r.mensaje ?? 'Producto no encontrado.')
    }
  }

  const agregar = () => {
    const sku = borrador.sku.trim()
    if (!sku || borrador.teorica == null || borrador.fisica == null) {
      setInfo('Completa el SKU y ambas cantidades para agregar.')
      return
    }
    if (existente) {
      // Re-escaneo: el físico nuevo se suma al previo en lugar de duplicar el producto.
      const previo = existente.fisica ?? 0
      const total = previo + borrador.fisica
      actualizar(
        productos.map((p, idx) =>
          idx === existenteIdx ? { ...p, nombre: borrador.nombre ?? p.nombre, teorica: borrador.teorica, fisica: total } : p
        )
      )
      setExito(`Sumado: FP ${previo} + ${borrador.fisica} = ${total}`)
    } else {
      actualizar([...productos, { sku, nombre: borrador.nombre, teorica: borrador.teorica, fisica: borrador.fisica }])
      setExito('')
    }
    setBorrador({ sku: '', nombre: null, teorica: null, fisica: null })
    setInfo('')
  }

  const pctBorrador = conciliacionPorcentaje({ teorica: borrador.teorica, fisica: fisicaResultante })

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <BotonInformativo activo={informativo} onClick={() => onChange({ ...v, informativo: !informativo })}>
          Informativo · no descuenta puntos
        </BotonInformativo>
      </div>

      <div className="space-y-2 rounded-xl border-2 border-dashed border-primary/40 bg-slate-50 p-3">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Escanea y agrega un producto</p>
        <div className="flex items-center gap-2">
          <Input
            placeholder="SKU / código interno del producto"
            value={borrador.sku}
            onChange={(e) => {
              const sku = e.target.value
              const codigo = sku.trim()
              const ya = codigo ? productos.find((p) => p.sku === codigo) : undefined
              setInfo('')
              setExito('')
              setBorrador(
                ya
                  ? { sku, nombre: ya.nombre, teorica: ya.teorica, fisica: null }
                  : { sku, nombre: null, teorica: null, fisica: null }
              )
            }}
            onKeyDown={(e) => { if (e.key === 'Enter') void aplicarCodigo() }}
          />
          <button
            type="button"
            onClick={() => setEscaneando(true)}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-slate-200 text-slate-600 hover:bg-slate-300"
            title="Escanear código de barras"
          >
            <ScanLine className="h-5 w-5" />
          </button>
          <Button type="button" variant="secondary" className="shrink-0 min-h-0 px-3 py-2" disabled={!borrador.sku.trim()} onClick={() => void aplicarCodigo()}>
            Buscar
          </Button>
        </div>
        {consultando ? (
          <p className="flex items-center gap-2 text-xs text-slate-500"><Spinner /> Consultando producto…</p>
        ) : info ? (
          <p className="text-xs font-medium text-amber-600">{info}</p>
        ) : null}
        {existente ? (
          <div className="rounded-xl border border-primary-200 bg-primary-50 p-2.5 text-xs leading-relaxed">
            <p className="font-bold text-primary-900">Código ya escaneado · {existente.nombre ?? existente.sku}</p>
            <p className="mt-0.5 text-primary-700">
              Teórica: {borrador.teorica ?? '—'} · Físico previo (FP): <strong>{existente.fisica ?? 0}</strong>
            </p>
            <p className="mt-0.5 font-semibold text-primary-900">
              {borrador.fisica != null && fisicaResultante != null
                ? `Al guardar: ${existente.fisica ?? 0} + ${borrador.fisica} = ${fisicaResultante}`
                : 'Ingresa la nueva cantidad física; al guardar se sumará al previo.'}
            </p>
          </div>
        ) : null}
        <Input
          placeholder="Nombre del producto (se autocompleta al buscar)"
          value={borrador.nombre ?? ''}
          onChange={(e) => setBorrador((b) => ({ ...b, nombre: e.target.value }))}
        />
        <div className="flex flex-wrap items-end gap-2">
          <CampoConciliacion
            etiqueta="Teórica (sistema)"
            valor={borrador.teorica}
            onChange={(n) => setBorrador((b) => ({ ...b, teorica: n }))}
          />
          <CampoConciliacion
            etiqueta={existente ? 'Física nueva (suma al previo)' : 'Física (contada)'}
            valor={borrador.fisica}
            onChange={(n) => setBorrador((b) => ({ ...b, fisica: n }))}
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          {exito ? (
            <p className="text-xs font-bold text-green-600">{exito}</p>
          ) : pctBorrador != null ? (
            <p className={cn('text-sm font-bold', pctBorrador === 100 ? 'text-green-600' : 'text-red-600')}>
              Conciliación: {pctBorrador}%
            </p>
          ) : (
            <p className="text-xs text-slate-400">Ingresa ambas cantidades para ver el %.</p>
          )}
          <Button
            type="button"
            variant="primary"
            className="shrink-0 min-h-0 px-4 py-2"
            disabled={!borrador.sku.trim() || borrador.teorica == null || borrador.fisica == null}
            onClick={agregar}
          >
            <Check className="h-4 w-4" /> Agregar
          </Button>
        </div>
      </div>

      {productos.length > 0 ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <ResumenConciliacion etiqueta="SKU agregados" valor={String(productos.length)} color="text-primary-900" />
            <ResumenConciliacion etiqueta="Match" valor={String(conciliadas)} color="text-green-600" />
            <ResumenConciliacion etiqueta="No Match" valor={String(desconciliadas)} color={desconciliadas > 0 ? 'text-red-600' : 'text-slate-400'} />
            <ResumenConciliacion etiqueta="Prom. conciliación" valor={promedio != null ? `${promedio}%` : '—'} color={promedio != null ? (promedio === 100 ? 'text-green-600' : 'text-red-600') : 'text-slate-400'} />
          </div>

          <div className="rounded-xl bg-white">
            <button
              type="button"
              onClick={() => setVerLista((x) => !x)}
              className="flex w-full items-center justify-between gap-2 px-4 py-3 text-sm font-bold text-primary-900"
            >
              <span>Productos agregados ({productos.length})</span>
              <ChevronDown className={cn('h-4 w-4 transition-transform', verLista ? 'rotate-180' : '')} />
            </button>
            {verLista ? (
              <>
                <p className="border-t border-slate-100 px-3 pt-2 text-[11px] font-medium text-slate-400">
                  Desliza un producto: derecha para editar · izquierda para eliminar.
                </p>
                <ul className="space-y-2 p-3">
                  {productos.map((p, i) => {
                    const pct = conciliacionPorcentaje(p)
                    if (editando === i) {
                      return (
                        <li key={i} className="space-y-2 rounded-xl border-2 border-primary bg-white px-3 py-2">
                          <p className="flex items-center gap-2 text-sm">
                            <span className="font-semibold text-slate-800">{p.sku}</span>
                            {p.nombre ? <span className="min-w-0 flex-1 truncate text-slate-500">{p.nombre}</span> : <span className="flex-1" />}
                          </p>
                          <div className="flex flex-wrap items-end gap-2">
                            <CampoConciliacion etiqueta="T · Teórica" valor={edicion.teorica} onChange={(n) => setEdicion((d) => ({ ...d, teorica: n }))} />
                            <CampoConciliacion etiqueta="F · Física" valor={edicion.fisica} onChange={(n) => setEdicion((d) => ({ ...d, fisica: n }))} />
                          </div>
                          <div className="flex justify-end gap-2">
                            <Button variant="ghost" onClick={() => setEditando(null)}>Cancelar</Button>
                            <Button variant="success" onClick={() => {
                              actualizarProducto(i, { teorica: edicion.teorica, fisica: edicion.fisica })
                              setEditando(null)
                            }}>
                              <Check className="h-4 w-4" /> Confirmar
                            </Button>
                          </div>
                        </li>
                      )
                    }
                    const editar = () => {
                      setEdicion({ teorica: p.teorica, fisica: p.fisica })
                      setEditando(i)
                    }
                    const eliminar = () => setAEliminar({ producto: p, index: i })
                    return (
                      <li key={i}>
                        <SwipeAcciones
                          acciones={[
                            {
                              lado: 'izq',
                              onDisparar: editar,
                              contenido: (
                                <button
                                  type="button"
                                  onClick={editar}
                                  title="Editar"
                                  aria-label="Editar"
                                  className="flex w-full items-center justify-center border-0 bg-primary text-white"
                                >
                                  <Pencil className="h-5 w-5" />
                                </button>
                              )
                            },
                            {
                              lado: 'der',
                              onDisparar: eliminar,
                              contenido: (
                                <button
                                  type="button"
                                  onClick={eliminar}
                                  title="Eliminar"
                                  aria-label="Eliminar"
                                  className="flex w-full items-center justify-center border-0 bg-red-600 text-white"
                                >
                                  <Trash2 className="h-5 w-5" />
                                </button>
                              )
                            }
                          ]}
                        >
                          <div className="bg-white px-3 py-1.5 text-sm">
                            <div className="flex items-center gap-2">
                              <span className="min-w-0 flex-1 truncate text-[15px] font-semibold leading-tight text-slate-800">
                                {p.nombre ?? p.sku}
                              </span>
                              <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold leading-none text-slate-500">
                                {p.sku}
                              </span>
                            </div>
                            <div className="mt-0.5 flex items-center justify-between gap-2">
                              <span className="text-xs leading-tight text-slate-500">
                                Teórica: {p.teorica ?? '—'} · Física: {p.fisica ?? '—'}
                              </span>
                              <span className={cn('text-xs font-bold leading-tight', pct != null && pct === 100 ? 'text-green-600' : 'text-red-600')}>
                                {pct != null ? `${pct}%` : '—'}
                              </span>
                            </div>
                          </div>
                        </SwipeAcciones>
                      </li>
                    )
                  })}
                </ul>
              </>
            ) : null}
          </div>
        </>
      ) : (
        <p className="text-sm text-slate-400">Aún no hay productos agregados. Escanea el primer código para comenzar.</p>
      )}

      {escaneando ? (
        <BarcodeScanner
          open={escaneando}
          onClose={() => setEscaneando(false)}
          onDetect={(codigo) => {
            setEscaneando(false)
            setInfo('')
            setExito('')
            const ya = productos.find((p) => p.sku === codigo)
            if (ya) {
              // Ya escaneado en esta evaluación: trae el producto y deja la física
              // vacía para el nuevo conteo (se sumará al guardar).
              setBorrador({ sku: codigo, nombre: ya.nombre, teorica: ya.teorica, fisica: null })
              return
            }
            const mismo = borrador.sku.trim() === codigo
            setBorrador(
              mismo ? (b) => b : { sku: codigo, nombre: null, teorica: null, fisica: null }
            )
            void (async () => {
              if (!shopId) {
                setInfo('Nº tienda (shop_id) no configurado en la sucursal.')
                return
              }
              setConsultando(true)
              const r = await buscarProducto(codigo, shopId)
              setConsultando(false)
              if (r.nombre) {
                setBorrador((b) => ({ ...b, nombre: r.nombre }))
              } else {
                setInfo(r.mensaje ?? 'Producto no encontrado.')
              }
            })()
          }}
        />
      ) : null}

      {aEliminar ? (
        <Confirmar
          open
          texto={`¿Quitar el producto ${aEliminar.producto.sku}${aEliminar.producto.nombre ? ` (${aEliminar.producto.nombre})` : ''}? El cambio se guardará en la nube.`}
          onConfirm={() => {
            actualizar(productos.filter((_, idx) => idx !== aEliminar.index))
            setAEliminar(null)
          }}
          onCancel={() => setAEliminar(null)}
        />
      ) : null}
    </div>
  )
}

function ColaboradoresEditor({ item, valor, onChange, shopId, branchId }: { item: Item; valor: unknown; onChange: (v: unknown) => void; shopId?: string | null; branchId?: string | null }) {
  const [cargando, setCargando] = useState(false)
  const [info, setInfo] = useState('')
  const [abiertoDni, setAbiertoDni] = useState<number | null>(null)

  const v = (valor as ValorListaColaboradores | null) ?? { colaboradores: [] }
  const colaboradores = v.colaboradores ?? []
  const opts = (item.opciones ?? []) as Opcion[]
  const filtro = item.colaboradores_filtro ?? 'ACTIVOS'
  const etiquetaFiltro = filtro === 'TODOS' ? 'activos e inactivos' : filtro === 'ACTIVOS' ? 'solo activos' : 'solo inactivos'
  // La API de trabajadores usa un ID de sucursal propio (branch_id) que puede
  // diferir del shop_id (productos). Si no está configurado, cae al shop_id.
  const idTrabajadores = branchId ?? shopId

  const actualizar = (cols: ColaboradorItem[]) => onChange({ ...v, colaboradores: cols })
  const toggleAbierto = (dni: number) => {
    setAbiertoDni((prev) => (prev === dni ? null : dni))
  }

  const cargar = async () => {
    setInfo('')
    if (!idTrabajadores) {
      setInfo('No está configurado el ID de trabajadores (branch_id) ni el Nº tienda (shop_id) en la sucursal.')
      return
    }
    if (!opts.length) {
      setInfo('Este ítem no tiene checklist definido. El Líder debe configurarlo desde Ítems de evaluación.')
      return
    }
    setCargando(true)
    const r = await listarColaboradores(idTrabajadores)
    setCargando(false)
    if (r.mensaje) {
      setInfo(r.mensaje)
      return
    }
    const nuevos: ColaboradorItem[] = r.colaboradores
      .filter((c) => filtro === 'TODOS' || c.active === (filtro === 'ACTIVOS'))
      .map((c) => ({
        dni: typeof c.dni === 'number' ? c.dni : Number(c.dni ?? 0),
        nationality: c.nationality,
        name: c.name ?? '',
        lastname: c.lastname ?? '',
        role_id: c.role_id,
        role_name: c.role_name ?? '',
        branch_id: c.branch_id,
        branch_name: c.branch_name ?? '',
        active: c.active !== false,
        aplica: true,
        selected: []
      }))
    if (!nuevos.length) {
      setInfo(`No hay colaboradores para el filtro configurado (${etiquetaFiltro}).`)
    }
    actualizar(nuevos)
    setAbiertoDni(null)
  }

  const marcarAplica = (dni: number) => {
    actualizar(colaboradores.map((c) => (c.dni === dni ? { ...c, aplica: !c.aplica } : c)))
  }

  const toggleCheck = (dni: number, opcionId: string) => {
    actualizar(colaboradores.map((c) => {
      if (c.dni !== dni) return c
      const sel = c.selected.includes(opcionId) ? c.selected.filter((x) => x !== opcionId) : [...c.selected, opcionId]
      return { ...c, selected: sel }
    }))
  }

  const aplicando = colaboradores.filter((c) => c.aplica)
  const cumplidos = aplicando.filter((c) => colaboradorCumple(c, opts)).length

  if (!opts.length) {
    return <p className="text-sm text-slate-400">Sin checklist definido para cada colaborador. El Líder debe configurarlo al crear el ítem.</p>
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border-2 border-dashed border-primary/40 bg-slate-50 p-3">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Colaboradores de la tienda</p>
        {colaboradores.length ? (
          <>
            <p className="mt-1 text-sm text-slate-600">
              {aplicando.length} colaboradores en cuenta ({etiquetaFiltro}) · {cumplidos}/{aplicando.length} con checklist completo
            </p>
          </>
        ) : (
          <p className="mt-1 text-xs text-slate-500">
            El ítem cumple cuando todos los colaboradores en cuenta ({etiquetaFiltro}) tienen su checklist completo.
          </p>
        )}
        <div className="mt-3 flex items-center gap-2">
          <Button type="button" variant="secondary" className="shrink-0 min-h-0 px-3 py-2" disabled={cargando} onClick={() => void cargar()}>
            {colaboradores.length ? <RefreshCw className="h-4 w-4" /> : <Check className="h-4 w-4" />}
            {cargando ? 'Cargando…' : colaboradores.length ? 'Actualizar listado' : 'Cargar colaboradores'}
          </Button>
        </div>
        {cargando ? (
          <p className="mt-2 flex items-center gap-2 text-xs text-slate-500"><Spinner /> Consultando colaboradores…</p>
        ) : info ? (
          <p className="mt-2 text-xs font-medium text-amber-600">{info}</p>
        ) : null}
      </div>

      {colaboradores.length ? (
        <div className="space-y-2">
          {colaboradores.map((c) => {
            const abierto = abiertoDni === c.dni
            const cumple = colaboradorCumple(c, opts)
            return (
              <div key={c.dni} className={cn('rounded-xl border transition-colors', c.aplica ? (cumple ? 'border-green-200 bg-white' : 'border-slate-200 bg-white') : 'border-slate-100 bg-slate-50')}>
                <div className="flex items-center gap-2 px-3 py-2.5">
                  <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                    <input type="checkbox" className="h-5 w-5 shrink-0 accent-primary" checked={c.aplica} onChange={() => marcarAplica(c.dni)} title="Cuenta para el puntaje" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-slate-800">{c.name} {c.lastname}</span>
                      <span className="block text-[11px] text-slate-500">
                        C.I. {c.nationality ?? ''}{c.dni} · {c.role_name || 'Sin rol'}
                        <span className={cn('ml-1.5 font-semibold', c.active ? 'text-green-600' : 'text-slate-400')}>{c.active ? '· Activo' : '· Inactivo'}</span>
                      </span>
                    </span>
                  </label>
                  <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold', cumple ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500')}>
                    {cumple ? 'Cumple' : `${c.selected.length}/${opts.length}`}
                  </span>
                  <button
                    type="button"
                    onClick={() => toggleAbierto(c.dni)}
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-slate-100"
                    title={abierto ? 'Cerrar checklist' : 'Abrir checklist'}
                  >
                    <ChevronDown className={cn('h-4 w-4 transition-transform', abierto ? 'rotate-180' : '')} />
                  </button>
                </div>
                {abierto ? (
                  <div className="space-y-1 border-t border-slate-100 px-3 pb-3 pt-2">
                    {opts.map((o) => {
                      const esta = c.selected.includes(o.id)
                      return (
                        <label key={o.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 hover:bg-slate-50">
                          <input
                            type="checkbox"
                            className="h-5 w-5 shrink-0 accent-primary"
                            checked={esta}
                            onChange={() => toggleCheck(c.dni, o.id)}
                          />
                          <span className={cn('text-sm', c.aplica ? 'text-slate-700' : 'text-slate-400')}>{o.etiqueta}</span>
                          {o.responsable ? <span className="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">{o.responsable}</span> : null}
                        </label>
                      )
                    })}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : (
        <p className="text-sm text-slate-400">Aún no hay colaboradores cargados. Pulsa “Cargar colaboradores” para traerlos de la tienda.</p>
      )}
    </div>
  )
}

function UnidadesEditor({ item, valor, onChange }: { item: Item; valor: unknown; onChange: (v: unknown) => void }) {
  const [info, setInfo] = useState('')
  const [codigo, setCodigo] = useState('')
  const [abiertoIdx, setAbiertoIdx] = useState<number | null>(null)

  const v = (valor as ValorUnidadChecklist | null) ?? { unidades: [] }
  const unidades = v.unidades ?? []
  const opts = (item.opciones ?? []) as Opcion[]

  const actualizar = (unids: UnidadChecklist[]) => onChange({ ...v, unidades: unids })

  const agregar = () => {
    const c = codigo.trim()
    setInfo('')
    if (!c) {
      setInfo('Escribe un valor para la unidad.')
      return
    }
    if (unidades.some((u) => u.codigo.toLowerCase() === c.toLowerCase())) {
      setInfo(`La unidad "${c}" ya está agregada.`)
      return
    }
    if (!opts.length) {
      setInfo('Este ítem no tiene checklist definido. El Líder debe configurarlo desde Ítems de evaluación.')
      return
    }
    actualizar([...unidades, { codigo: c, selected: [] }])
    setCodigo('')
    setAbiertoIdx(unidades.length)
  }

  const quitar = (idx: number) => {
    actualizar(unidades.filter((_, i) => i !== idx))
    setAbiertoIdx(null)
  }

  const toggleCheck = (idx: number, opcionId: string) => {
    actualizar(unidades.map((u, i) => {
      if (i !== idx) return u
      const sel = u.selected.includes(opcionId) ? u.selected.filter((x) => x !== opcionId) : [...u.selected, opcionId]
      return { ...u, selected: sel }
    }))
  }

  const cumplidos = unidades.filter((u) => unidadCumple(u, opts)).length

  return (
    <div className="space-y-3">
      <div className="rounded-xl border-2 border-dashed border-primary/40 bg-slate-50 p-3">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Agregar unidad</p>
        <div className="mt-2 flex items-center gap-2">
          <Input
            placeholder="Valor alfanumérico (ej. PATIO-01)"
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); agregar() } }}
          />
          <Button type="button" variant="primary" className="shrink-0 min-h-0 px-3 py-2" disabled={!codigo.trim()} onClick={agregar}>
            Agregar
          </Button>
        </div>
        {info ? <p className="mt-2 text-xs font-medium text-amber-600">{info}</p> : null}
      </div>

      {unidades.length ? (
        <>
          <p className="text-sm text-slate-600">
            {unidades.length} unidades en cuenta · {cumplidos}/{unidades.length} con checklist completo
          </p>
          <div className="space-y-2">
            {unidades.map((u, i) => {
              const abierto = abiertoIdx === i
              const cumple = unidadCumple(u, opts)
              return (
                <div key={`${u.codigo}-${i}`} className="rounded-xl border border-slate-200 bg-white">
                  <div className="flex items-center gap-2 px-3 py-2.5">
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800">{u.codigo}</span>
                    <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold', cumple ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500')}>
                      {cumple ? 'Cumple' : `${u.selected.length}/${opts.length}`}
                    </span>
                    <button
                      type="button"
                      onClick={() => { setAbiertoIdx(abierto ? null : i) }}
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-slate-100"
                      title={abierto ? 'Cerrar checklist' : 'Abrir checklist'}
                    >
                      <ChevronDown className={cn('h-4 w-4 transition-transform', abierto ? 'rotate-180' : '')} />
                    </button>
                    <button
                      type="button"
                      onClick={() => quitar(i)}
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-red-400 hover:bg-red-50 hover:text-red-500"
                      title="Quitar unidad"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  {abierto ? (
                    <div className="space-y-1 border-t border-slate-100 px-3 pb-3 pt-2">
                      {opts.map((o) => {
                        const esta = u.selected.includes(o.id)
                        return (
                          <label key={o.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 hover:bg-slate-50">
                            <input
                              type="checkbox"
                              className="h-5 w-5 shrink-0 accent-primary"
                              checked={esta}
                              onChange={() => toggleCheck(i, o.id)}
                            />
<span className="text-sm text-slate-700">{o.etiqueta}</span>
                            {o.responsable ? <span className="ml-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">{o.responsable}</span> : null}
                          </label>
                        )
                      })}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        </>
      ) : (
        <p className="text-sm text-slate-400">Aún no hay unidades. Agrega la primera para comenzar.</p>
      )}
    </div>
  )
}

function ResumenConciliacion({ etiqueta, valor, color }: { etiqueta: string; valor: string; color: string }) {
  return (
    <div className="rounded-xl bg-white px-3 py-2.5 text-center">
      <p className={cn('text-lg font-extrabold tabular-nums', color)}>{valor}</p>
      <p className="mt-0.5 break-words text-[11px] font-medium leading-tight text-slate-500">{etiqueta}</p>
    </div>
  )
}

function EvidenciasEditor({ evidencias, onChange }: { evidencias: EvidenciaCumple[]; onChange: (evs: EvidenciaCumple[]) => void }) {
  const agregar = () => onChange([...evidencias, { photoIds: [], comentario: '' }])
  const quitar = (i: number) => onChange(evidencias.filter((_, idx) => idx !== i))
  const actualizar = (i: number, patch: Partial<EvidenciaCumple>) =>
    onChange(evidencias.map((e, idx) => (idx === i ? { ...e, ...patch } : e)))

  if (!evidencias.length) {
    return (
      <Button type="button" variant="secondary" className="w-full" onClick={agregar}>
        + Agregar evidencia (foto + comentario)
      </Button>
    )
  }

  return (
    <div className="space-y-3">
      {evidencias.map((ev, i) => (
        <div key={i} className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold uppercase text-slate-500">Evidencia {i + 1}</p>
            <button
              type="button"
              onClick={() => quitar(i)}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-slate-400 hover:bg-red-50 hover:text-red-500"
            >
              <X className="h-3.5 w-3.5" /> Quitar
            </button>
          </div>
          <PhotoCapture photoIds={ev.photoIds} onChange={(photoIds) => actualizar(i, { photoIds })} />
          <Textarea
            rows={2}
            placeholder="Comentario de la evidencia…"
            value={ev.comentario}
            onChange={(e) => actualizar(i, { comentario: e.target.value })}
          />
        </div>
      ))}
      <Button type="button" variant="secondary" className="w-full" onClick={agregar}>
        + Agregar otra evidencia
      </Button>
    </div>
  )
}

function BotonCumple({ activo, onPick }: { activo: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      className={cn(
        'flex min-h-[56px] flex-col items-center justify-center gap-1 rounded-xl border-2 px-3 py-3 transition-colors',
        activo ? 'border-green-600 bg-green-50 text-green-800' : 'border-slate-200 bg-white text-slate-500'
      )}
    >
      <Check className="text-2xl" strokeWidth={2.5} />
      <span className="text-sm font-bold">Cumple</span>
    </button>
  )
}

function BotonNoCumple({ activo, onPick }: { activo: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      className={cn(
        'flex min-h-[56px] flex-col items-center justify-center gap-1 rounded-xl border-2 px-3 py-3 transition-colors',
        activo ? 'border-red-600 bg-red-50 text-red-700' : 'border-slate-200 bg-white text-slate-500'
      )}
    >
      <X className="text-2xl" strokeWidth={2.5} />
      <span className="text-sm font-bold">No cumple</span>
    </button>
  )
}

function BotonInformativo({ activo, onClick, children }: { activo: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition-colors',
        activo
          ? 'border-amber-300 bg-amber-100 text-amber-800'
          : 'border-slate-200 bg-white text-slate-400 hover:border-amber-200 hover:bg-amber-50 hover:text-amber-700'
      )}
    >
      <Info className="h-3.5 w-3.5" />
      {children}
    </button>
  )
}

function CampoConciliacion({ etiqueta, valor, onChange }: { etiqueta: string; valor: number | null; onChange: (n: number | null) => void }) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <label className="min-w-0 flex-1 truncate text-xs font-medium text-slate-500">{etiqueta}</label>
      <div className="w-28 shrink-0 sm:w-32">
        <Input
          type="number"
          inputMode="decimal"
          min={0}
          placeholder="0"
          value={valor ?? ''}
          onChange={(e) => {
            const n = Number(e.target.value)
            onChange(Number.isFinite(n) && e.target.value !== '' ? n : null)
          }}
        />
      </div>
    </div>
  )
}

function FotoOpcion({ photoIds, onChange }: { photoIds: string[]; onChange: (ids: string[]) => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [subiendo, setSubiendo] = useState(false)

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        className="hidden"
        onChange={(e) => {
          void (async () => {
            setSubiendo(true)
            const nuevos = await guardarFotosDe(e.target.files)
            setSubiendo(false)
            if (nuevos.length) onChange([...photoIds, ...nuevos])
          })()
          e.target.value = ''
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={subiendo}
        aria-label="Tomar foto de evidencia"
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-white transition-colors hover:bg-primary-700 disabled:opacity-50"
      >
        {subiendo ? <Spinner className="h-4 w-4 border-white border-t-transparent" /> : <Camera className="h-4 w-4" />}
      </button>
    </>
  )
}