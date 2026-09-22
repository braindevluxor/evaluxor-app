import { useState } from 'react'
import type { Item, Opcion } from '../lib/types'
import { etiquetaTipo, conciliacionPorcentaje, conciliacionTotal, type ValorConciliacion, type ProductoConciliacion, type ValorCumple, type EvidenciaCumple } from '../lib/scoring'
import { buscarProducto } from '../lib/data/precios'
import { Badge, cn, Input, Textarea, Button, Spinner } from './ui'
import { PhotoCapture } from './PhotoCapture'
import { BarcodeScanner } from './BarcodeScanner'

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
    item.tipo === 'CUMPLE_NO_CUMPLE' ? 3 : item.tipo === 'CONCILIACION' ? 6 : item.tipo === 'FOTO' ? 0 : item.tipo === 'CHECKLIST' ? 5 : 4

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
    case 'COMENTARIO':
    case 'DESCRIPCION':
      return !(typeof valor === 'string' && valor.trim())
    case 'CANTIDAD':
      return !(typeof valor === 'number')
    case 'CONCILIACION': {
      const ps = (valor as ValorConciliacion | null)?.productos ?? []
      return ps.length === 0 || ps.some((p) => !p.sku.trim() || p.teorica == null || p.fisica == null)
    }
    case 'FOTO':
      return !((valor as { photoIds?: string[] } | null)?.photoIds?.length)
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
      const setValue = (valor2: boolean) => onChange({ ...v, value: valor2 })
      const setEvidencias = (evs: EvidenciaCumple[]) => onChange({ ...v, evidencias: evs })
      return (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <BotonCumple activo={value === true} onPick={() => setValue(true)} />
            <BotonNoCumple activo={value === false} onPick={() => setValue(false)} />
          </div>
          <EvidenciasEditor evidencias={evidencias} onChange={setEvidencias} />
        </div>
      )
    }
    case 'CHECKLIST': {
      const seleccion = (valor as { selected?: string[] } | null)?.selected ?? []
      const opts = (item.opciones ?? []) as Opcion[]
      if (!opts.length) return <p className="text-sm text-slate-400">Sin opciones definidas.</p>
      const toggle = (id: string) => {
        const existe = seleccion.includes(id)
        onChange({ selected: existe ? seleccion.filter((x) => x !== id) : [...seleccion, id] })
      }
      return (
        <div className="space-y-2">
          {opts.map((o) => (
            <label
              key={o.id}
              className={cn(
                'flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-3 transition-colors',
                seleccion.includes(o.id) ? 'border-primary bg-primary-50' : 'border-slate-200 bg-white'
              )}
            >
              <input
                type="checkbox"
                className="h-5 w-5 accent-primary"
                checked={seleccion.includes(o.id)}
                onChange={() => toggle(o.id)}
              />
              <span className="text-sm text-slate-700">{o.etiqueta}</span>
            </label>
          ))}
        </div>
      )
    }
    case 'COMENTARIO':
      return (
        <Textarea
          rows={3}
          placeholder="Escribe un comentario…"
          value={typeof valor === 'string' ? valor : ''}
          onChange={(e) => onChange(e.target.value)}
        />
      )
    case 'DESCRIPCION':
      return (
        <Textarea
          rows={4}
          placeholder="Describe la situación…"
          value={typeof valor === 'string' ? valor : ''}
          onChange={(e) => onChange(e.target.value)}
        />
      )
    case 'CANTIDAD':
      return (
        <Input
          type="number"
          inputMode="decimal"
          min={0}
          placeholder="0"
          value={typeof valor === 'number' ? valor : ''}
          onChange={(e) => {
            const n = Number(e.target.value)
            onChange(Number.isFinite(n) && e.target.value !== '' ? n : null)
          }}
        />
      )
    case 'CONCILIACION':
      return <ConciliacionEditor valor={valor} onChange={onChange} shopId={shopId} />
    case 'FOTO': {
      const ids = (valor as { photoIds?: string[] } | null)?.photoIds ?? []
      return <PhotoCapture photoIds={ids} onChange={(photoIds) => onChange({ photoIds })} />
    }
    default:
      return null
  }
}

function ConciliacionEditor({ valor, onChange, shopId }: { valor: unknown; onChange: (v: unknown) => void; shopId?: string | null }) {
  const [escaneandoIndice, setEscaneandoIndice] = useState<number | null>(null)
  const [consultando, setConsultando] = useState<Record<number, boolean>>({})
  const [info, setInfo] = useState<Record<number, string>>({})
  const v = (valor as ValorConciliacion | null) ?? { productos: [] }
  const productos = v.productos ?? []

  const actualizar = (items: ProductoConciliacion[]) => onChange({ productos: items })
  const actualizarUno = (i: number, patch: Partial<ProductoConciliacion>) =>
    actualizar(productos.map((p, idx) => (idx === i ? { ...p, ...patch } : p)))
  const total = conciliacionTotal(v)

  const aplicarCodigo = async (i: number, codigo: string) => {
    const p = productos[i]
    actualizarUno(i, { sku: codigo, nombre: null })
    setInfo((old) => ({ ...old, [i]: '' }))
    if (!shopId) {
      setInfo((old) => ({ ...old, [i]: 'Nº tienda (shop_id) no configurado en la sucursal.' }))
      return
    }
    if (p?.nombre && p.nombre !== '') return
    setConsultando((old) => ({ ...old, [i]: true }))
    const r = await buscarProducto(codigo, shopId)
    setConsultando((old) => ({ ...old, [i]: false }))
    if (r.nombre) {
      actualizarUno(i, { sku: codigo, nombre: r.nombre })
      setInfo((old) => ({ ...old, [i]: '' }))
    } else {
      setInfo((old) => ({ ...old, [i]: r.mensaje ?? 'Producto no encontrado.' }))
    }
  }

  return (
    <div className="space-y-3">
      {productos.length === 0 ? (
        <p className="text-sm text-slate-400">Agrega productos para conciliar (escanea o escribe el código).</p>
      ) : (
        productos.map((p, i) => {
          const pct = conciliacionPorcentaje(p)
          return (
            <div key={i} className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center gap-2">
                <Input
                  placeholder="SKU / código interno del producto"
                  value={p.sku}
                  onChange={(e) => actualizarUno(i, { sku: e.target.value })}
                  onBlur={() => {
                    const codigo = p.sku.trim()
                    if (codigo && codigo !== p.nombre) void aplicarCodigo(i, codigo)
                  }}
                  required
                />
                <button
                  type="button"
                  onClick={() => setEscaneandoIndice(i)}
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-slate-200 text-lg hover:bg-slate-300"
                  title="Escanear código de barras"
                >
                  🔍
                </button>
                <button
                  type="button"
                  onClick={() => actualizar(productos.filter((_, idx) => idx !== i))}
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-slate-400 hover:bg-red-50 hover:text-red-500"
                  title="Quitar producto"
                >
                  ✕
                </button>
              </div>
              {p.nombre ? (
                <p className="text-sm font-medium text-primary-900">{p.nombre}</p>
              ) : consultando[i] ? (
                <p className="flex items-center gap-2 text-xs text-slate-500"><Spinner /> Consultando producto…</p>
              ) : info[i] ? (
                <p className="text-xs font-medium text-amber-600">{info[i]}</p>
              ) : null}
              <div className="flex gap-2">
                <CampoConciliacion
                  etiqueta="Teórica (sistema)"
                  valor={p.teorica}
                  onChange={(n) => actualizarUno(i, { teorica: n })}
                />
                <CampoConciliacion
                  etiqueta="Física (contada)"
                  valor={p.fisica}
                  onChange={(n) => actualizarUno(i, { fisica: n })}
                />
              </div>
              {pct != null ? (
                <p className={cn('text-sm font-bold', pct >= 100 ? 'text-green-600' : 'text-red-600')}>
                  Conciliación: {pct}%
                </p>
              ) : (
                <p className="text-xs text-slate-400">Ingresa ambas cantidades.</p>
              )}
            </div>
          )
        })
      )}

      <Button type="button" variant="secondary" className="w-full" onClick={() => actualizar([...productos, { sku: '', nombre: null, teorica: null, fisica: null }])}>
        + Agregar producto
      </Button>

      {total != null ? (
        <div className="flex items-center justify-between rounded-xl border px-4 py-3">
          <span className="text-sm text-slate-500">Conciliación total</span>
          <span className={cn('text-lg font-extrabold', total >= 100 ? 'text-green-600' : 'text-red-600')}>{total}%</span>
        </div>
      ) : null}

      {escaneandoIndice != null ? (
        <BarcodeScanner
          open={escaneandoIndice != null}
          onClose={() => setEscaneandoIndice(null)}
          onDetect={(codigo) => {
            const i = escaneandoIndice
            setEscaneandoIndice(null)
            if (i != null) void aplicarCodigo(i, codigo)
          }}
        />
      ) : null}
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
              className="rounded-lg px-2 py-1 text-xs font-medium text-slate-400 hover:bg-red-50 hover:text-red-500"
            >
              ✕ Quitar
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
      <span className="text-xl">✓</span>
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
      <span className="text-xl">✗</span>
      <span className="text-sm font-bold">No cumple</span>
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