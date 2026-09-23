import { useRef, useState } from 'react'
import { Camera, Check, ChevronDown, Info, ScanLine, X } from 'lucide-react'
import type { Item, Opcion } from '../lib/types'
import { etiquetaTipo, conciliacionPorcentaje, conciliacionTotal, type ValorChecklist, type ValorConciliacion, type ProductoConciliacion, type ValorCumple, type EvidenciaCumple } from '../lib/scoring'
import { buscarProducto } from '../lib/data/precios'
import { Badge, cn, Input, Textarea, Button, Spinner } from './ui'
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
}

export function ItemRenderer({ item, valor, onChange, index, total, shopId }: Props) {
  const preg = `${index + 1}. ${item.texto}` + (item.requerido ? ' *' : '')
  const tipoColor =
    item.tipo === 'CUMPLE_NO_CUMPLE' ? 3 : item.tipo === 'CONCILIACION' ? 6 : item.tipo === 'CHECKLIST' ? 5 : 4

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-start justify-between gap-2">
        <p className="font-semibold text-slate-800">{preg}</p>
        <Badge color={tipoColor}>{etiquetaTipo(item.tipo)}</Badge>
      </div>
      <Contenido item={item} valor={valor} onChange={onChange} shopId={shopId} />
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
    default:
      return false
  }
}

function Contenido({ item, valor, onChange, shopId }: { item: Item; valor: unknown; onChange: (v: unknown) => void; shopId?: string | null }) {
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
      const toggle = (id: string) => {
        const existe = seleccion.includes(id)
        onChange({ ...value, selected: existe ? seleccion.filter((x) => x !== id) : [...seleccion, id] })
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
          <p className="text-xs text-slate-400">Marca “Informativo” en la opción cuya falla corresponde a otra área; no descontará puntos.</p>
          {opts.map((o) => {
            const activo = seleccion.includes(o.id)
            const esInformativo = informativos.includes(o.id)
            const idsEv = evidencias[o.id]?.photoIds ?? []
            return (
              <div
                key={o.id}
                className={cn(
                  'rounded-xl border transition-colors',
                  esInformativo ? 'border-amber-200 bg-amber-50' : activo ? 'border-primary bg-primary-50' : 'border-slate-200 bg-white'
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
    default:
      return null
  }
}

function ConciliacionEditor({ valor, onChange, shopId }: { valor: unknown; onChange: (v: unknown) => void; shopId?: string | null }) {
  const [escaneando, setEscaneando] = useState(false)
  const [consultando, setConsultando] = useState(false)
  const [info, setInfo] = useState('')
  const [verLista, setVerLista] = useState(false)
  const [borrador, setBorrador] = useState<ProductoConciliacion>({ sku: '', nombre: null, teorica: null, fisica: null })

  const v = (valor as ValorConciliacion | null) ?? { productos: [] }
  const productos = v.productos ?? []
  const informativo = v.informativo ?? false

  const actualizar = (items: ProductoConciliacion[]) => onChange({ ...v, productos: items })
  const promedio = conciliacionTotal(v)

  const conciliadas = productos.filter((p) => p.teorica != null && p.fisica != null && (p.teorica ?? 0) > 0 && p.fisica === p.teorica).length
  const desconciliadas = productos.filter((p) => p.teorica != null && p.fisica != null && (p.teorica ?? 0) > 0 && p.fisica !== p.teorica).length

  const aplicarCodigo = async () => {
    const codigo = borrador.sku.trim()
    setInfo('')
    if (!codigo) return
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
    actualizar([...productos, { sku, nombre: borrador.nombre, teorica: borrador.teorica, fisica: borrador.fisica }])
    setBorrador({ sku: '', nombre: null, teorica: null, fisica: null })
    setInfo('')
  }

  const pctBorrador = conciliacionPorcentaje(borrador)

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
            onChange={(e) => setBorrador((b) => ({ ...b, sku: e.target.value, nombre: null }))}
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
        <Input
          placeholder="Nombre del producto (se autocompleta al buscar)"
          value={borrador.nombre ?? ''}
          onChange={(e) => setBorrador((b) => ({ ...b, nombre: e.target.value }))}
        />
        <div className="flex gap-2">
          <CampoConciliacion
            etiqueta="Teórica (sistema)"
            valor={borrador.teorica}
            onChange={(n) => setBorrador((b) => ({ ...b, teorica: n }))}
          />
          <CampoConciliacion
            etiqueta="Física (contada)"
            valor={borrador.fisica}
            onChange={(n) => setBorrador((b) => ({ ...b, fisica: n }))}
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          {pctBorrador != null ? (
            <p className={cn('text-sm font-bold', pctBorrador >= 100 ? 'text-green-600' : 'text-red-600')}>
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
            <ResumenConciliacion etiqueta="Conciliaciones" valor={String(conciliadas)} color="text-green-600" />
            <ResumenConciliacion etiqueta="Desconciliaciones" valor={String(desconciliadas)} color={desconciliadas > 0 ? 'text-red-600' : 'text-slate-400'} />
            <ResumenConciliacion etiqueta="Prom. conciliación" valor={promedio != null ? `${promedio}%` : '—'} color={promedio != null && promedio < 100 ? 'text-red-600' : 'text-green-600'} />
          </div>

          <div className="rounded-xl border border-slate-200 bg-white">
            <button
              type="button"
              onClick={() => setVerLista((x) => !x)}
              className="flex w-full items-center justify-between gap-2 px-4 py-3 text-sm font-bold text-primary-900"
            >
              <span>Productos agregados ({productos.length})</span>
              <ChevronDown className={cn('h-4 w-4 transition-transform', verLista ? 'rotate-180' : '')} />
            </button>
            {verLista ? (
              <ul className="space-y-2 border-t border-slate-100 p-3">
                {productos.map((p, i) => {
                  const pct = conciliacionPorcentaje(p)
                  return (
                    <li key={i} className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm">
                      <span className="font-semibold text-slate-800">{p.sku}</span>
                      {p.nombre ? <span className="min-w-0 flex-1 truncate text-slate-500">{p.nombre}</span> : <span className="flex-1" />}
                      <span className="text-xs text-slate-400">T: {p.teorica ?? '—'}</span>
                      <span className="text-xs text-slate-400">F: {p.fisica ?? '—'}</span>
                      <span className={cn('font-bold', pct != null && pct >= 100 ? 'text-green-600' : 'text-red-600')}>
                        {pct ?? '—'}%
                      </span>
                      <button
                        type="button"
                        onClick={() => actualizar(productos.filter((_, idx) => idx !== i))}
                        className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-500"
                        title="Quitar producto"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </li>
                  )
                })}
              </ul>
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
            setBorrador((b) => ({ ...b, sku: codigo }))
            void (async () => {
              setInfo('')
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
    </div>
  )
}

function ResumenConciliacion({ etiqueta, valor, color }: { etiqueta: string; valor: string; color: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-center">
      <p className={cn('text-lg font-extrabold tabular-nums', color)}>{valor}</p>
      <p className="mt-0.5 text-[11px] font-medium text-slate-500">{etiqueta}</p>
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
    <div className="flex items-center gap-3">
      <label className="min-w-0 flex-1 text-xs font-medium text-slate-500">{etiqueta}</label>
      <Input
        className="w-32"
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
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-white shadow-sm transition-colors hover:bg-primary-700 disabled:opacity-50"
      >
        {subiendo ? <Spinner className="h-4 w-4 border-white border-t-transparent" /> : <Camera className="h-4 w-4" />}
      </button>
    </>
  )
}