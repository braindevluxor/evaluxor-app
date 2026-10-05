import { useEffect, useMemo, useRef, useState } from 'react'
import { Ban, Camera, Check, ChevronDown, Info, Pencil, RefreshCw, ScanLine, Trash2, X } from 'lucide-react'
import type { Item, Opcion } from '../lib/types'
import { etiquetaTipo, conciliacionPorcentaje, conciliacionTotal, colaboradorCumple, colaboradoresQueCuentan, esColaboradorRevisado, opcionesAplicablesColaborador, unidadCumple, formatearLastSync, formatearPrecioBase, guardarPerdidaConciliacion, opcionCumplida, valorBinario, responsablesDeOpcion, referenciaConciliacion, estaVacioItem, type ContraDatoConciliacion, type ValorChecklist, type ValorConciliacion, type ProductoConciliacion, type ValorCumple, type EvidenciaCumple, type ValorListaColaboradores, type ColaboradorItem, type ValorUnidadChecklist, type UnidadChecklist } from '../lib/scoring'
import { buscarProducto, type ResultadoScan } from '../lib/data/precios'
import { listarColaboradores, ordenarTrabajadores } from '../lib/data/colaboradores'
import { aplicarHistorial, combinarPorDni } from '../lib/data/colaboradoresEstado'
import { estadosCompletosDeEvaluacionesAnteriores } from '../lib/data/colaboradoresHistorico'
import { useProgresoCarga } from '../lib/progresoCarga'
import { formatearValorConsulta } from '../lib/data/apis'
import { Badge, cn, Input, Textarea, Button, Spinner, Confirmar, ProgressBar } from './ui'
import { SwipeAcciones } from './SwipeAcciones'
import { guardarFotosDe, MinaFotos, PhotoCapture } from './PhotoCapture'
import { BarcodeScanner } from './BarcodeScanner'
import { deletePhoto } from '../lib/offline/db'
import { BotonNoAplica, SelectorResponsables } from './WidgetsEvaluacion'
import { PlanoEditor } from './PlanoEditor'

interface Props {
  item: Item
  valor: unknown
  onChange: (valor: unknown) => void
  index: number
  total: number
  shopId?: string | null
  branchId?: string | null
  /** Nombre del gerente de la sucursal: destino por defecto de cada punto cuando el evaluador no elige responsables. */
  gerente?: string | null
  /**
   * Sucursal y fecha de la evaluación en curso. Solo las usa LISTA_COLABORADORES,
   * para buscar qué trabajadores de esta tienda ya salieron completos en una
   * evaluación anterior. Sin estos dosprops el listado funciona igual: se ve
   * entero y no se oculta nadie.
   */
  sucursalId?: string
  fechaEvaluacion?: string
}

/** Responsables elegibles para un check: los configurados en el check; si el check no tiene, los del ítem. */
function responsablesDeCheck(item: { responsables?: string[] | null }, o: Opcion): string[] {
  const deOpcion = responsablesDeOpcion(o)
  return deOpcion.length ? deOpcion : (item.responsables ?? [])
}

/** ¿Un check NO está cumplido (punto incumplido)? CHECKLIST: no marcado o rango bajo el mínimo. LISTA/UNIDAD: no todas las filas lo tienen. Sin filas puntuables → false. */
function checkIncumplido(item: Item, o: Opcion, valor: unknown): boolean {
  if (item.tipo === 'CHECKLIST') {
    const v = valor as ValorChecklist | null
    if ((v?.informativos ?? []).includes(o.id)) return false
    return !opcionCumplida(o, v, o.id)
  }
  if (item.tipo === 'LISTA_COLABORADORES') {
    const v = valor as ValorListaColaboradores | null
    const aplican = colaboradoresQueCuentan(v?.colaboradores)
    if (!aplican.length) return false
    return !aplican.every((c) => (c.selected ?? []).includes(o.id))
  }
  if (item.tipo === 'UNIDAD_CHECKLIST') {
    const v = valor as ValorUnidadChecklist | null
    const unids = v?.unidades ?? []
    if (!unids.length) return false
    return !unids.every((u) => (u.selected ?? []).includes(o.id))
  }
  return false
}

export function ItemRenderer({ item, valor, onChange, index, total, shopId, branchId, gerente, sucursalId, fechaEvaluacion }: Props) {
  const preg = `${index + 1}. ${item.texto}` + (item.requerido ? ' *' : '')
  const tipoColor =
    item.tipo === 'CUMPLE_NO_CUMPLE' ? 3 : item.tipo === 'CONCILIACION' ? 6 : item.tipo === 'CHECKLIST' ? 5 : item.tipo === 'LISTA_COLABORADORES' || item.tipo === 'UNIDAD_CHECKLIST' ? 1 : item.tipo === 'PLANO_XY' ? 2 : 4

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-start justify-between gap-2">
        <p className="font-semibold text-slate-800">{preg}</p>
        <Badge color={tipoColor}>{etiquetaTipo(item.tipo)}</Badge>
      </div>
      <Contenido item={item} valor={valor} onChange={onChange} shopId={shopId} branchId={branchId} gerente={gerente} sucursalId={sucursalId} fechaEvaluacion={fechaEvaluacion} />
      {item.requerido && estaVacioItem(item, valor) ? (
        <p className="mt-2 text-xs font-medium text-red-600">Obligatorio para enviar la evaluación.</p>
      ) : null}
      <p className="mt-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Pregunta {index + 1} de {total}</p>
    </section>
  )
}

function Contenido({ item, valor, onChange, shopId, branchId, gerente, sucursalId, fechaEvaluacion }: { item: Item; valor: unknown; onChange: (v: unknown) => void; shopId?: string | null; branchId?: string | null; gerente?: string | null; sucursalId?: string; fechaEvaluacion?: string }) {
  // Hornea el gerente como destino por defecto de los puntos incumplidos cuando
  // el ítem tiene responsables configurables (a nivel del ítem o por check) y el
  // valor es un objeto: sin selección de la falla → gerente.
  const tieneRespConfig = (item.responsables?.length ?? 0) > 0 || (item.opciones ?? []).some((o) => responsablesDeOpcion(o).length)
  const guardar = (v: unknown) => {
    const esObjeto = !!v && typeof v === 'object' && !Array.isArray(v)
    if (item.tipo !== 'CONTENEDOR' && tieneRespConfig && esObjeto) {
      onChange({ ...(v as object), responsablesGerente: gerente ?? null })
    } else {
      onChange(v)
    }
  }
  switch (item.tipo) {
    case 'CUMPLE_NO_CUMPLE': {
      const v = (valor as ValorCumple | null) ?? { value: null, evidencias: [] }
      const value = v.value ?? null
      const evidencias = v.evidencias ?? []
      const noAplica = v.informativo ?? false
      const setValue = (valor2: boolean) => guardar({ ...v, value: valor2 })
      const setEvidencias = (evs: EvidenciaCumple[]) => guardar({ ...v, evidencias: evs })
      const setNoAplica = (b: boolean) => guardar({ ...v, informativo: b })
      return (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <BotonCumple activo={value === true} onPick={() => setValue(true)} />
            <BotonNoCumple activo={value === false} onPick={() => setValue(false)} />
          </div>
          <BotonNoAplica activo={noAplica} onClick={() => setNoAplica(!noAplica)}>
            No aplica · se excluye del puntaje
          </BotonNoAplica>
          <EvidenciasEditor evidencias={evidencias} onChange={setEvidencias} />
          {value === false ? (
            <div className="rounded-xl border border-red-100 bg-red-50/60 p-2.5">
              <SelectorResponsables
                etiqueta="Responsable de que no cumpla"
                responsables={item.responsables ?? []}
                seleccion={v.responsables ?? []}
                gerente={gerente}
                onChange={(sel) => guardar({ ...v, responsables: sel })}
              />
            </div>
          ) : null}
        </div>
      )
    }
    case 'CHECKLIST': {
      const value = ((valor as ValorChecklist | null) ?? { selected: [], informativos: [], evidencias: {} })
      const seleccion = value.selected ?? []
      const noAplican = value.informativos ?? []
      const evidencias = value.evidencias ?? {}
      const opts = (item.opciones ?? []) as Opcion[]
      if (!opts.length) return <p className="text-sm text-slate-400">Sin opciones definidas.</p>
      const conPuntos = opts.length > 0 && opts.every((o) => typeof o.puntos === 'number' && o.puntos > 0)
      const toggle = (id: string) => {
        const existe = seleccion.includes(id)
        if (existe) {
          const valores2 = { ...(value.valores ?? {}) }
          delete valores2[id]
          guardar({ ...value, selected: seleccion.filter((x) => x !== id), valores: valores2 })
        } else {
          guardar({ ...value, selected: [...seleccion, id] })
        }
      }
      const setValorRango = (id: string, n: number) => {
        guardar({
          ...value,
          selected: seleccion.includes(id) ? seleccion : [...seleccion, id],
          valores: { ...(value.valores ?? {}), [id]: n }
        })
      }
      const toggleNoAplica = (id: string) => {
        const existe = noAplican.includes(id)
        guardar({ ...value, informativos: existe ? noAplican.filter((x) => x !== id) : [...noAplican, id] })
      }
      const setEvidencia = (id: string, photoIds: string[]) => {
        guardar({ ...value, evidencias: { ...evidencias, [id]: { photoIds } } })
      }
      const quitarEvidencia = (id: string, photoId: string) => {
        void deletePhoto(photoId)
        setEvidencia(id, (evidencias[id]?.photoIds ?? []).filter((x) => x !== photoId))
      }
      return (
        <>
        <div className="space-y-2">
          <p className="text-xs text-slate-400">
            {conPuntos
              ? 'El ítem otorga los puntos de las opciones validadas. Marca “No aplica” en las opciones que no corresponden; se excluyen del puntaje.'
              : 'Marca “No aplica” en las opciones que no corresponden; se excluyen del puntaje.'}
          </p>
          {opts.map((o) => {
            const activo = seleccion.includes(o.id)
            const esNoAplica = noAplican.includes(o.id)
            const idsEv = evidencias[o.id]?.photoIds ?? []
            const esRango = o.tipo_respuesta === 'RANGO'
            const valorRango = esRango ? (value.valores?.[o.id] ?? null) : null
            const cumpleOpcion = opcionCumplida(o, value, o.id)
            const respFallidos = responsablesDeCheck(item, o).length > 0
            return (
              <div
                key={o.id}
                className={cn(
                  'min-w-0 overflow-hidden rounded-xl border transition-colors',
                  esNoAplica
                    ? 'border-amber-200 bg-amber-50'
                    : cumpleOpcion
                      ? 'border-slate-200 bg-white'
                      : 'border-red-300 bg-red-50'
                )}
              >
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5 px-3 py-2.5">
                  <span className="min-w-0 flex-1 break-words text-sm text-slate-700">{o.etiqueta}</span>
                  {esRango ? (
                    <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                      Valor (mín. {o.minimo ?? '—'}{o.unidad ? ` ${o.unidad}` : ''})
                    </span>
                  ) : null}
                  {o.puntos != null && o.puntos > 0 ? (
                    <span className="shrink-0 rounded-full bg-primary-50 px-2 py-0.5 text-[11px] font-bold tabular-nums text-primary-700">{o.puntos} pts</span>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => toggleNoAplica(o.id)}
                    title="No aplica: se excluye del puntaje"
                    className={cn(
                      'inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold transition-colors',
                      esNoAplica ? 'bg-amber-100 text-amber-800' : 'text-slate-400 hover:bg-amber-50 hover:text-amber-600'
                    )}
                  >
                    <Info className="h-3 w-3" />
                    {esNoAplica ? 'No aplica' : 'Marcar no aplica'}
                  </button>
                  {/* La foto se puede adjuntar en cualquier estado: el punto puede estar
                      validado (cumple) o sin cumplir, y en los dos casos sirve de evidencia. */}
                  <FotoOpcion
                    photoIds={idsEv}
                    onChange={(ids) => setEvidencia(o.id, ids)}
                  />
                </div>
                {esRango ? (
                  <div className="space-y-2 px-3 pb-3 pt-1">
                    <BarraRango
                      etiqueta={o.etiqueta}
                      minimo={o.minimo}
                      maximo={o.maximo}
                      unidad={o.unidad}
                      valor={typeof valorRango === 'number' ? valorRango : null}
                      onChange={(n) => setValorRango(o.id, n)}
                    />
                  </div>
                ) : null}
                {idsEv.length > 0 ? (
                  <div className="px-3 pb-3">
                    <MinaFotos photoIds={idsEv} onQuitar={(fid) => quitarEvidencia(o.id, fid)} />
                  </div>
                ) : null}
                {!esNoAplica ? (
                  cumpleOpcion ? (
                    // Estado neutro (validado): sin alerta roja y sin responsables.
                    <div className="flex min-w-0 flex-wrap items-center gap-2 border-t border-slate-100 px-3 py-2.5">
                      {esRango ? (
                        <span className="text-xs font-semibold text-green-700">
                          Punto validado <span className="font-normal text-slate-400">· valor {valorRango ?? '—'}{o.unidad ? ` ${o.unidad}` : ''}</span>
                        </span>
                      ) : (
                        <label className="flex cursor-pointer items-center gap-2">
                          <input
                            type="checkbox"
                            className="h-4 w-4 shrink-0 accent-green-600"
                            checked={activo}
                            onChange={() => toggle(o.id)}
                          />
                          <span className="text-xs font-semibold text-green-700">Punto validado</span>
                        </label>
                      )}
                    </div>
                  ) : (
                    // Estado de error (sin cumplir): validar el punto + responsables de la falla.
                    <div className="min-w-0 border-t border-red-100 bg-red-50/60 px-3 py-2.5">
                      {esRango ? (
                        <>
                          <p className="mb-1 text-xs font-semibold text-slate-600">
                            Responsables de los puntos incumplidos <span className="font-semibold text-red-500">· sin cumplir</span>
                          </p>
                          <p className="mb-2 text-[10px] text-slate-400">
                            Ingresa un valor mayor o igual a {o.minimo ?? '—'}{o.unidad ? ` ${o.unidad}` : ''} para validar el punto.
                          </p>
                        </>
                      ) : (
                        <label className="mb-2 flex cursor-pointer items-center gap-2">
                          <input
                            type="checkbox"
                            className="h-4 w-4 shrink-0 accent-primary"
                            checked={activo}
                            onChange={() => toggle(o.id)}
                          />
                          <span className="text-xs font-bold text-slate-600">
                            Responsables de los puntos incumplidos <span className="font-semibold text-red-500">· sin cumplir</span>
                          </span>
                        </label>
                      )}
                      {respFallidos ? (
                        <SelectorResponsables
                          responsables={responsablesDeCheck(item, o)}
                          seleccion={value.responsablesPorOpcion?.[o.id] ?? []}
                          gerente={gerente}
                          onChange={(sel) =>
                            guardar({ ...value, responsablesPorOpcion: { ...(value.responsablesPorOpcion ?? {}), [o.id]: sel } })
                          }
                        />
                      ) : null}
                    </div>
                  )
                ) : null}
              </div>
            )
          })}
        </div>
      </>
    )
    }
    case 'CONCILIACION':
      return <ConciliacionEditor valor={valor} onChange={guardar} shopId={shopId} item={item} gerente={gerente} />
    case 'LISTA_COLABORADORES':
      return <ColaboradoresEditor item={item} valor={valor} onChange={guardar} shopId={shopId} branchId={branchId} gerente={gerente} sucursalId={sucursalId} fechaEvaluacion={fechaEvaluacion} />
    case 'UNIDAD_CHECKLIST':
      return <UnidadesEditor item={item} valor={valor} onChange={guardar} gerente={gerente} />
    case 'PLANO_XY':
      return <PlanoEditor item={item} valor={valor} onChange={guardar} gerente={gerente} />
    default:
      return null
  }
}

/** Aplica el resultado del escaneo al borrador: autocompleta la Teórica (sistema) con el contra dato elegido (SOH o precio base) y conserva la info consultada. */
function aplicarResultadoScan(b: ProductoConciliacion, r: ResultadoScan, contraDato: ContraDatoConciliacion): ProductoConciliacion {
  return {
    ...b,
    nombre: r.nombre ?? b.nombre,
    teorica: referenciaConciliacion(r, contraDato) ?? b.teorica,
    soh: r.soh,
    lastSync: r.lastSync,
    finalBase: r.finalBase
  }
}

/** ¿El borrador tiene info consultada del sistema (SOH / última sync / precio) para mostrar? */
function tieneInfoSistema(p: { soh?: number | null; lastSync?: string | null; finalBase?: number | null } | null | undefined): boolean {
  return !!(p && (p.soh != null || p.lastSync || p.finalBase != null))
}

export function ConciliacionEditor({ valor, onChange, shopId, item, gerente }: { valor: unknown; onChange: (v: unknown) => void; shopId?: string | null; item?: Item; gerente?: string | null }) {
  const [escaneando, setEscaneando] = useState(false)
  const [consultando, setConsultando] = useState(false)
  const [info, setInfo] = useState('')
  const [exito, setExito] = useState('')
  const [verLista, setVerLista] = useState(false)
  const [aEliminar, setAEliminar] = useState<{ producto: ProductoConciliacion; index: number } | null>(null)
  const [editando, setEditando] = useState<number | null>(null)
  const [edicion, setEdicion] = useState<{ teorica: number | null; fisica: number | null }>({ teorica: null, fisica: null })
  const [borrador, setBorrador] = useState<ProductoConciliacion>({ sku: '', nombre: null, teorica: null, fisica: null, soh: null, lastSync: null, finalBase: null })

  const v = (valor as ValorConciliacion | null) ?? { productos: [] }
  const productos = v.productos ?? []
  const noAplica = v.informativo ?? false
  // El contra dato (SOH o precio base) se elige al crear el ítem en Config: aquí
  // solo se usa para autocompletar la teórica al escanear o consultar un producto.
  const contraDato = item?.contra_dato ?? 'SOH'

  // La conciliación no cumple cuando hay productos escaneados, todos con ambas
  // cantidades, y al menos uno no coincide: ahí aparece el selector de responsables.
  const noCumple = item ? valorBinario({ tipo: item.tipo, opciones: item.opciones ?? null }, valor) === false : false

  const actualizar = (items: ProductoConciliacion[]) =>
    onChange({
      ...v,
      productos: items.map((producto) => guardarPerdidaConciliacion(producto, contraDato))
    })
  const actualizarProducto = (i: number, patch: Partial<ProductoConciliacion>) =>
    actualizar(productos.map((p, idx) => (idx === i ? { ...p, ...patch } : p)))
  const promedio = conciliacionTotal(v)

  const conciliadas = productos.filter((p) => p.teorica != null && p.fisica != null && p.fisica === p.teorica).length
  const desconciliadas = productos.filter((p) => p.teorica != null && p.fisica != null && p.fisica !== p.teorica).length

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
      setBorrador({ sku: codigo, nombre: ya.nombre, teorica: ya.teorica, fisica: null, soh: ya.soh, lastSync: ya.lastSync, finalBase: ya.finalBase })
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
      setBorrador((b) => aplicarResultadoScan(b, r, contraDato))
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
          idx === existenteIdx
            ? {
                ...p,
                nombre: borrador.nombre ?? p.nombre,
                teorica: borrador.teorica,
                fisica: total,
                soh: borrador.soh ?? p.soh,
                lastSync: borrador.lastSync ?? p.lastSync,
                finalBase: borrador.finalBase ?? p.finalBase
              }
            : p
        )
      )
      setExito(`Sumado: FP ${previo} + ${borrador.fisica} = ${total}`)
    } else {
      actualizar([
        ...productos,
        {
          sku,
          nombre: borrador.nombre,
          teorica: borrador.teorica,
          fisica: borrador.fisica,
          soh: borrador.soh,
          lastSync: borrador.lastSync,
          finalBase: borrador.finalBase
        }
      ])
      setExito('')
    }
    setBorrador({ sku: '', nombre: null, teorica: null, fisica: null })
    setInfo('')
  }

  const pctBorrador = conciliacionPorcentaje({ teorica: borrador.teorica, fisica: fisicaResultante })

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <BotonNoAplica activo={noAplica} onClick={() => onChange({ ...v, informativo: !noAplica })}>
          No aplica · se excluye del puntaje
        </BotonNoAplica>
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
                  ? { sku, nombre: ya.nombre, teorica: ya.teorica, fisica: null, soh: ya.soh, lastSync: ya.lastSync, finalBase: ya.finalBase }
                  : { sku, nombre: null, teorica: null, fisica: null }
              )
            }}
            onKeyDown={(e) => { if (e.key === 'Enter') void aplicarCodigo() }}
          />
          <button
            type="button"
            onClick={() => setEscaneando(true)}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-slate-200 text-slate-600 hover:bg-slate-300"
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
        {tieneInfoSistema(borrador) ? (
          <p className="text-[11px] leading-relaxed text-slate-400">
            SOH (sistema): <strong className="text-slate-600">{borrador.soh ?? '—'}</strong> · Últ. sync:{' '}
            {formatearLastSync(borrador.lastSync)} · Precio: {formatearPrecioBase(borrador.finalBase)}
          </p>
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
            etiqueta={contraDato === 'FINAL_BASE' ? 'Teórica (precio)' : 'Teórica (SOH)'}
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
            <ResumenConciliacion etiqueta="Prom. conciliación" valor={promedio != null ? `${promedio}%` : '—'} color={promedio != null ? (promedio === 0 ? 'text-green-600' : 'text-red-600') : 'text-slate-400'} />
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
                            <span className="max-w-[55%] overflow-x-auto whitespace-nowrap text-[10px] font-semibold leading-none text-slate-800" title={p.sku}>{p.sku}</span>
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
                                  className="flex w-full items-center justify-center rounded-full border-0 bg-primary text-white"
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
                                  className="flex w-full items-center justify-center rounded-full border-0 bg-red-600 text-white"
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
                              <span
                                className="max-w-[48%] shrink-0 overflow-x-auto whitespace-nowrap rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold tabular-nums leading-none text-slate-500"
                                title={p.sku}
                              >
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
                            {tieneInfoSistema(p) ? (
                              <p className="mt-0.5 text-[10px] leading-tight text-slate-400">
                                SOH: {p.soh ?? '—'} · Sync: {formatearLastSync(p.lastSync)} · Precio: {formatearPrecioBase(p.finalBase)}
                              </p>
                            ) : null}
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
              setBorrador({ sku: codigo, nombre: ya.nombre, teorica: ya.teorica, fisica: null, soh: ya.soh, lastSync: ya.lastSync, finalBase: ya.finalBase })
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
                setBorrador((b) => aplicarResultadoScan(b, r, contraDato))
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
      {noCumple ? (
        <div className="rounded-xl border border-red-100 bg-red-50/60 p-2.5">
          <SelectorResponsables
            etiqueta="Responsable de que no concilie"
            responsables={item?.responsables ?? []}
            seleccion={v.responsables ?? []}
            gerente={gerente}
            onChange={(sel) => onChange({ ...v, responsables: sel })}
          />
        </div>
      ) : null}
    </div>
  )
}

function ColaboradoresEditor({ item, valor, onChange, shopId, branchId, gerente, sucursalId, fechaEvaluacion }: { item: Item; valor: unknown; onChange: (v: unknown) => void; shopId?: string | null; branchId?: string | null; gerente?: string | null; sucursalId?: string; fechaEvaluacion?: string }) {
  const [cargando, setCargando] = useState(false)
  const [info, setInfo] = useState('')
  const [abiertoDni, setAbiertoDni] = useState<number | null>(null)
  const [busqueda, setBusqueda] = useState('')
  const [confirmarLimpiar, setConfirmarLimpiar] = useState(false)
  /**
   * Trabajadores que ya estaban completos en la evaluación anterior de esta
   * tienda, con el estado que tenían entonces. Se ocultan de la lista pero NO
   * se sacan del valor guardado: si se sacaran con las casillas vacías, el
   * tablero los contaría como incumplidos.
   */
  const [resueltosAntes, setResueltosAntes] = useState<Map<number, ColaboradorItem>>(new Map())
  const [mostrarResueltos, setMostrarResueltos] = useState(false)
  /**
   * La combinación esperando confirmación: la lista nueva ya combinada y a quién
   * se le está por perder el trabajo. Se guarda entera y no solo los nombres
   * porque al confirmar hay que aplicar la misma lista que se iba a aplicar, no
   * una segunda versión recalculada.
   */
  const [pendienteCombinacion, setPendienteCombinacion] = useState<{ colaboradores: ColaboradorItem[]; perdidos: ColaboradorItem[]; historial: Map<number, ColaboradorItem> } | null>(null)
  /** Evita volver a pedir el historial en cada remount del ítem. */
  const historicoPedido = useRef(false)
  /**
   * Ya se sabe qué trabajadores estaban completos antes. `false` hasta que se
   * consulta (o hasta que se decide que no hay nada que consultar). Es lo único
   * que separa "lista depurada" de "lista entera".
   */
  const [historialResuelto, setHistorialResuelto] = useState(false)

  const v = (valor as ValorListaColaboradores | null) ?? { colaboradores: [] }
  const colaboradores = ordenarTrabajadores(v.colaboradores ?? [])
  /**
   * Los que ya estaban completos y quedan ocultos. Se filtran acá, al pintar, y
   * no al guardar: el valor guardado los conserva (con su estado de la evaluación
   * anterior) para que el tablero y el puntaje sigan contando a toda la
   * plantilla. Si se ocultaran guardándolos fuera, el porcentaje del ítem se
   * deformaría y la tienda mejorada parecería peor.
   *
   * Además, si un trabajador queda completo AHORA (acabás de tildar todo), se
   * oculta para limpiar la lista. Si lo buscás por cédula o nombre, sigue
   * apareciendo igual: eso permite volver a revisarlo si querés.
   */
  const hayBusqueda = busqueda.trim().length > 0
  const ocultosHistorial = mostrarResueltos ? new Set<number>() : new Set(resueltosAntes.keys())
  const ocultosAhora = mostrarResueltos ? new Set<number>() : new Set<number>()
  const optsCalculo = (item.opciones ?? []) as Opcion[]
  if (!mostrarResueltos && !hayBusqueda && historialResuelto) {
    for (const c of colaboradores) {
      if (!c.aplica) continue
      const checksAplicables = opcionesAplicablesColaborador(c, optsCalculo)
      if (checksAplicables.length === 0) continue
      if (colaboradorCumple(c, optsCalculo)) {
        ocultosAhora.add(c.dni)
      }
    }
  }
  const ocultos = new Set<number>([...ocultosHistorial, ...ocultosAhora])
  const colaboradoresFiltrados = colaboradores.filter((c) => {
    const q = busqueda.trim().toLowerCase()
    if (!q) return true
    const documento = String(c.dni ?? '').toLowerCase()
    const nombre = `${c.name ?? ''} ${c.lastname ?? ''}`.toLowerCase()
    return documento.includes(q) || (c.name ?? '').toLowerCase().includes(q) || (c.lastname ?? '').toLowerCase().includes(q) || nombre.includes(q)
  })
  const colaboradoresVisibles = colaboradoresFiltrados.filter((c) => {
    if (!ocultos.has(c.dni)) return true
    return hayBusqueda
  })
  const ocultosVisibles = colaboradoresFiltrados.length - colaboradoresVisibles.length
  const opts = useMemo(() => (item.opciones ?? []) as Opcion[], [item.opciones])
  // Solo los ids, y en un useMemo, porque es lo único que la consulta del
  // historial necesita. Si el efecto dependiera del arreglo de opciones entero,
  // se volvería a disparar en cada render cuando el ítem no tiene checklist: ahí
  // `(item.opciones ?? [])` crea un `[]` nuevo en cada vuelta.
  const idsChecks = useMemo(() => opts.map((o) => o.id), [opts])
  const filtro = item.colaboradores_filtro ?? 'ACTIVOS'
  const etiquetaFiltro = filtro === 'TODOS' ? 'activos e inactivos' : filtro === 'ACTIVOS' ? 'solo activos' : 'solo inactivos'
  // La API de trabajadores usa un ID de sucursal propio (branch_id) que puede
  // diferir del shop_id (productos). Si no está configurado, cae al shop_id.
  const idTrabajadores = branchId ?? shopId
  // Si no hay sucursal, fecha o checks, no hay historial que traer: la lista se
  // muestra entera desde el primer render y no hay barra.
  const puedeConsultarHistorial = !!sucursalId && !!fechaEvaluacion && idsChecks.length > 0
  const historialPendiente = !historialResuelto && puedeConsultarHistorial && colaboradores.length > 0

  const actualizar = (cols: ColaboradorItem[]) => onChange({ ...v, colaboradores: cols })
  const limpiar = () => {
    setConfirmarLimpiar(false)
    setPendienteCombinacion(null)
    setBusqueda('')
    setAbiertoDni(null)
    setInfo('')
    // Se olvida el historial también: si no, al recargar la lista volverían a
    // ocultarse los que ya estaban completos y el evaluador no vería a quién
    // le puso "no aplica" a propósito.
    setResueltosAntes(new Map())
    setMostrarResueltos(false)
    // Y se libera la consulta: la lista quedó vacía, así que al recargarla hay
    // que volver a preguntarle al servidor cuáles eran los resueltos.
    historicoPedido.current = false
    setHistorialResuelto(false)
    actualizar([])
  }
  const ocultarResueltos = (historial: Map<number, ColaboradorItem>, lista: ColaboradorItem[]) => {
    setResueltosAntes(historial)
    setMostrarResueltos(false)
    setPendienteCombinacion(null)
    actualizar(lista)
    setAbiertoDni(null)
  }

  const ocultarAunSinCargar = async () => {
    // El guard NO puede mirar `resueltosAntes`: al remontar viene vacío, así que
    // preguntar "hay alguno ya resuelto" ahí siempre da falso y nunca se consulta.
    // Lo único que se sabe sin consultar es si hay lista cargada; si no hay
    // colaboradores, no hay nada que ocultar.
    if (historicoPedido.current || !puedeConsultarHistorial || !colaboradores.length) return
    historicoPedido.current = true
    const historial = await estadosCompletosDeEvaluacionesAnteriores(sucursalId!, item.id, fechaEvaluacion!, idsChecks)
    setResueltosAntes(historial)
    setHistorialResuelto(true)
  }

  /**
   * Si la lista todavía no se sabe depurada, no se muestra.
   *
   * No es un estado con `useState` a propósito. Sale de lo que se sabe, no de
   * lo que alguien se acordara de apagar. Así no hay forma de que la barra quede
   * girando para siempre porque un `return` temprano se olvidó de apagarla: si
   * no hay nada que consultar, `puedeConsultarHistorial` da falso y no hay barra
   * desde el primer render.
   *
   * Esto tapa los dos casos en que la lista se veía entera y después se
   * acortaba sola: apretar "Actualizar listado" y volver al ítem desde otro
   * paso. En los dos, hasta saber quién ya estaba completo, no se muestra nada.
   */
  const hayAlgoQueEsperar = cargando || historialPendiente

  /**
   * El avance de la barra. Los tres mensajes van marcando por dónde va la
   * carga, para que la espera se vea como avance y no como app clavada.
   *
   * Un texto fijo no decía nada, y arrancar la barra en 40% se leía como que ya
   * algo había pasado. Arranca en 14% y se frena al acercarse: el techo es 88, no
   * 100, así que mientras hay trabajo en vuelo el automático no puede declarar
   * "listo". Cuando la consulta responde, la barra salta a 100 y se queda llena
   * un instante antes de que entre la lista.
   *
   * El gate del render es `visible`, no `hayAlgoQueEsperar`: cuando el trabajo
   * terminó, `hayAlgoQueEsperar` ya es falso pero la barra sigue visible un
   * instante, y si el gate fuera el otro la lista entraría tapando el final de
   * la barra.
   */
  const { avance, visible: barraVisible, mensaje } = useProgresoCarga(hayAlgoQueEsperar)

  // Al volver al ítem el componente se vuelve a montar y el estado local se
  // pierde. Los que estaban ocultos siguen guardados en el valor (con su estado
  // de la evaluación anterior), así que sin esto aparecerían todos otra vez.
  //
  // La lógica va adentro del efecto y no en una función aparte porque esa
  // función se recrea en cada render, y ponerla en las dependencias dispararía
  // el efecto siempre. Las dependencias son solo los valores que de verdad lee.
  useEffect(() => {
    void ocultarAunSinCargar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colaboradores.length, sucursalId, fechaEvaluacion, item.id, idsChecks])

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
    // El historial va en paralelo con el listado: los dos necesitan red y el
    // segundo nunca tira (devuelve el mapa vacío si algo falla), así que no
    // puede dejar sin resultado al primero.
    const [r, historial] = await Promise.all([
      listarColaboradores(idTrabajadores),
      sucursalId && fechaEvaluacion
        ? estadosCompletosDeEvaluacionesAnteriores(sucursalId, item.id, fechaEvaluacion, idsChecks)
        : Promise.resolve(new Map<number, ColaboradorItem>())
    ])
    setCargando(false)
    // El historial ya está en la mano: se marca como pedido para que el efecto de
    // remount no vuelva a preguntar lo mismo. Y como ya se sabe qué estaba
    // completo, la lista se puede pintar depurada. Va antes de los `return` de
    // error a propósito: si la consulta falló y se devuelve el mapa vacío, la
    // lista se ve entera, pero no debe quedar la barra girando.
    historicoPedido.current = true
    setHistorialResuelto(true)
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
        admission_date: c.admission_date ?? null,
        active: c.active !== false,
        aplica: true,
        selected: []
      }))
    if (!nuevos.length) {
      setInfo(`No hay trabajadores para el filtro configurado (${etiquetaFiltro}).`)
    }
    // A los que ya salieron bien se les carga el estado de la evaluación anterior,
    // para que no cuenten como incumplidos solo por estar ocultos.
    const conHistorial = aplicarHistorial(nuevos, historial)
    const { colaboradores: combinados, perdidos } = combinarPorDni(colaboradores, conHistorial)

    if (perdidos.length) {
      // Hay trabajo humano que la API ya no trae. No se descarta solo: se pregunta.
      // El historial se aplica igual, para que la lista que se ve detrás del
      // diálogo no sea la entera cuando el filtro ya se sabe.
      setResueltosAntes(historial)
      setPendienteCombinacion({ colaboradores: combinados, perdidos, historial })
      return
    }
    setResueltosAntes(historial)
    setPendienteCombinacion(null)
    actualizar(combinados)
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

  const marcarNoAplica = (dni: number, opcionId: string) => {
    actualizar(colaboradores.map((c) => {
      if (c.dni !== dni) return c
      const noAplica = c.noAplica ?? []
      const marcar = !noAplica.includes(opcionId)
      const responsablesPorOpcion = { ...(c.responsablesPorOpcion ?? {}) }
      if (marcar) delete responsablesPorOpcion[opcionId]
      return {
        ...c,
        noAplica: marcar ? [...noAplica, opcionId] : noAplica.filter((id) => id !== opcionId),
        selected: marcar ? c.selected.filter((id) => id !== opcionId) : c.selected,
        responsablesPorOpcion
      }
    }))
  }

  const marcarResponsables = (dni: number, opcionId: string, rs: string[]) => {
    actualizar(colaboradores.map((c) => (c.dni === dni ? { ...c, responsablesPorOpcion: { ...(c.responsablesPorOpcion ?? {}), [opcionId]: rs } } : c)))
  }

  const enCuenta = colaboradores.filter((c) => c.aplica)
  // Los que el evaluador no llegó a tocar NO entran en el puntaje. Se cuentan
  // aparte para que la diferencia sea explícita y nadie lea "sin marcar" como
  // "reprobado": la lista entera arranca destildada y no revisar es una decisión
  // legítima cuando el tiempo no alcanza.
  const aplicando = colaboradoresQueCuentan(colaboradores)
  const conChecksAplicables = aplicando.filter((c) => opcionesAplicablesColaborador(c, opts).length > 0)
  const cumplidos = conChecksAplicables.filter((c) => colaboradorCumple(c, opts)).length
  const sinRevisar = enCuenta.length - aplicando.length
  const totalAplicables = conChecksAplicables.length

  if (!opts.length) {
    return <p className="text-sm text-slate-400">Sin checklist definido para cada trabajador. El Líder debe configurarlo al crear el ítem.</p>
  }

  return (
    <div className="space-y-3">
      <div className="rounded-xl border-2 border-dashed border-primary/40 bg-slate-50 p-3">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Trabajadores de la tienda</p>
        {colaboradores.length ? (
          <>
            <p className="mt-1 text-sm text-slate-600">
              {aplicando.length} trabajadores en cuenta ({etiquetaFiltro})
              {totalAplicables > 0 ? (
                <>
                  {' · '}
                  {totalAplicables - cumplidos} incompletos · {cumplidos} completos
                </>
              ) : enCuenta.length > aplicando.length ? (
                ` · ${enCuenta.length - aplicando.length} sin puntos aplicables`
              ) : null}
            </p>
            {/* El aviso que evita el error de lectura: "Sin marcar" no es "reprobado". */}
            {sinRevisar > 0 ? (
              <p className="mt-1 text-xs text-slate-500">
                {sinRevisar} trabajador{sinRevisar === 1 ? '' : 'es'} sin revisar: su checklist está destildado y
                <span className="font-semibold text-slate-700"> no entran en el puntaje</span>. Revisalos si necesitás
                contarlos.
              </p>
            ) : null}
          </>
        ) : (
          <p className="mt-1 text-xs text-slate-500">
            El ítem se puntúa por trabajador: cada revisado completo vale su parte, y los que quedan destildados sin tocar todavía no cuentan ({etiquetaFiltro}).
          </p>
        )}
        <div className="mt-3 flex items-center gap-2">
          <Button type="button" variant="secondary" className="shrink-0 min-h-0 px-3 py-2" disabled={cargando} onClick={() => void cargar()} title="Trae los cambios de la API sin perder lo que ya revisaste">
            {colaboradores.length ? <RefreshCw className="h-4 w-4" /> : <Check className="h-4 w-4" />}
            {cargando ? 'Cargando…' : colaboradores.length ? 'Actualizar listado' : 'Cargar trabajadores'}
          </Button>
          {colaboradores.length ? (
            <Button
              type="button"
              variant="ghost"
              className="shrink-0 min-h-0 px-3 py-2 text-red-600 hover:bg-red-50 hover:text-red-700"
              onClick={() => setConfirmarLimpiar(true)}
            >
              <Trash2 className="h-4 w-4" />
              Limpiar lista
            </Button>
          ) : null}
        </div>
        {cargando ? null : info ? (
          <p className="mt-2 text-xs font-medium text-amber-600">{info}</p>
        ) : null}
      </div>

      {/*
        La barra va arriba de la lista y no adentro, porque mientras está no hay
        lista: hasta saber quién ya estaba completo, mostrar los diez y después
        sacar cinco se lee como que la app se arrepintió. También reemplaza al
        spinner del header, que decía lo mismo en otra parte y dejaba dos
        indicadores para una sola espera.

        El número del relleno es de adorno (`valorAprox`, no `value`): por eso no
        se anuncia. Lo que anuncia el avance es el mensaje, que sí va cambiando.

        La barra se queda llena un instante después de que la consulta respondió
        (`mensaje` pasa a `null`), y recién ahí entra la lista. Sin esa pausa el
        salto al 100% no se ve: la lista taparía el final de la barra.
      */}
      {barraVisible ? (
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <ProgressBar valorAprox={avance} />
          {mensaje ? <p className="mt-2 text-xs text-slate-500">{mensaje}</p> : null}
        </div>
      ) : null}

      {/*
        Los que ya estaban completos. El aviso va fuera de la lista y antes del
        buscador porque es lo primero que hay que entender al abrir el ítem: si
        no, un evaluador ve "9 de 10 completos" y una sola persona en pantalla y
        piensa que faltan nueve.

        Todo lo de abajo —aviso, buscador y lista— se esconde mientras la barra está a
        la vista. Si no, al volver al ítem se veían los diez un instante y al
        terminar la consulta quedaban cinco: el flash es justo lo que esta barra
        viene a tapar.
      */}
      {!barraVisible && resueltosAntes.size ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-3 py-2">
          <Check className="h-4 w-4 shrink-0 text-green-600" />
          <p className="min-w-0 flex-1 text-xs text-green-800">
            {mostrarResueltos
              ? `Se están mostrando los ${resueltosAntes.size} que ya estaban completos. Siguen contando en el puntaje.`
              : `${resueltosAntes.size} ${resueltosAntes.size === 1 ? 'trabajador estaba' : 'trabajadores estaban'} completo${resueltosAntes.size === 1 ? '' : 's'} en la evaluación anterior y no se vuelve a revisar. Siguen contando en el puntaje.`}
          </p>
          <button
            type="button"
            onClick={() => setMostrarResueltos((v) => !v)}
            className="shrink-0 rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-green-800 shadow-sm hover:bg-green-100"
          >
            {mostrarResueltos ? 'Ocultarlos' : 'Verlos'}
          </button>
        </div>
      ) : null}

      {!barraVisible && colaboradores.length ? (
        <div className="space-y-3">
          {/* Buscador fijo: no se pierde al hacer scroll en listas largas. Se pega
              debajo de la cabecera sticky del layout (top-16 = 64px) y -mx-4/px-4
              lo estira hasta los bordes de la tarjeta blanca que lo contiene. */}
          <div className="sticky top-16 z-20 -mx-4 border-b border-slate-200 bg-white px-4 py-2.5 shadow-sm">
            <Input
              type="text"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar por documento, nombre o apellido"
              className="w-full"
            />
          </div>

          {colaboradoresVisibles.length ? (
            <div className="space-y-2">
              {colaboradoresVisibles.map((c) => {
                const abierto = abiertoDni === c.dni
                const checksAplicables = opcionesAplicablesColaborador(c, opts)
                const todosNoAplican = checksAplicables.length === 0
                const cumple = !todosNoAplican && colaboradorCumple(c, opts)
                // Sin nada registrado la fila dice "Sin revisar", no "Incompleto":
                // no es un incumplimiento, es un trabajador que todavía no entró
                // en la evaluación.
                const estado = todosNoAplican ? 'No aplica' : cumple ? 'Completo' : esColaboradorRevisado(c) ? 'Incompleto' : 'Sin revisar'
                const estadoClass = todosNoAplican ? 'bg-slate-200 text-slate-600' : cumple ? 'bg-green-100 text-green-700' : esColaboradorRevisado(c) ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-400'
                return (
                  <div key={c.dni} className={cn('rounded-xl border transition-colors', c.aplica ? (cumple ? 'border-green-200 bg-white' : 'border-slate-200 bg-white') : 'border-slate-100 bg-slate-50')}>
                    <div className="flex items-center gap-2 px-3 py-2.5">
                      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                        <input type="checkbox" className="h-5 w-5 shrink-0 accent-primary" checked={c.aplica} onChange={() => marcarAplica(c.dni)} title="Cuenta para el puntaje" />
                        <span className="min-w-0 flex-1">
                          <span className="block whitespace-normal break-words text-sm font-semibold leading-snug text-slate-800">{c.lastname} {c.name}</span>
                          <span className="block text-[11px] text-slate-500">
                            C.I. {c.nationality ?? ''}{c.dni} · {c.role_name || 'Sin rol'}
                            <span className={cn('ml-1.5 font-semibold', c.active ? 'text-green-600' : 'text-slate-400')}>{c.active ? '· Activo' : '· Inactivo'}</span>
                          </span>
                          {c.admission_date ? (
                            <>
                              <span className="mt-0.5 block text-[11px] text-slate-500">Ingreso: {formatearValorConsulta(c.admission_date)}</span>
                              {c.active && requisitoContrato(c.admission_date) ? <span className="block text-[11px] font-semibold text-primary-700">{requisitoContrato(c.admission_date)}</span> : null}
                            </>
                          ) : null}
                        </span>
                      </label>
                      <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold', estadoClass)}>
                        {estado}
                      </span>
                      <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold', todosNoAplican ? 'bg-slate-200 text-slate-600' : cumple ? 'bg-green-100 text-green-700' : esColaboradorRevisado(c) ? 'bg-slate-100 text-slate-500' : 'bg-slate-100 text-slate-400')}>
                        {todosNoAplican ? 'No aplica' : cumple ? `${checksAplicables.length}/${checksAplicables.length}` : esColaboradorRevisado(c) ? `${c.selected.filter((id) => checksAplicables.some((o) => o.id === id)).length}/${checksAplicables.length}` : `0/${checksAplicables.length} · sin revisar`}
                      </span>
                      <button
                        type="button"
                        onClick={() => toggleAbierto(c.dni)}
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-slate-400 hover:bg-slate-100"
                        title={abierto ? 'Cerrar checklist' : 'Abrir checklist'}
                      >
                        <ChevronDown className={cn('h-4 w-4 transition-transform', abierto ? 'rotate-180' : '')} />
                      </button>
                    </div>
                    {abierto ? (
                      <div className="space-y-1 border-t border-slate-100 px-3 pb-3 pt-2">
                        {opts.map((o) => {
                          const esta = c.selected.includes(o.id)
                          const noAplica = (c.noAplica ?? []).includes(o.id)
                          const respFallidos = responsablesDeCheck(item, o).length > 0
                          return (
                            <div
                              key={o.id}
                              className={cn(
                                'min-w-0 overflow-hidden rounded-xl border transition-colors',
                                noAplica ? 'border-slate-200 bg-slate-50' : esta ? 'border-slate-200 bg-white' : 'border-red-300 bg-red-50'
                              )}
                            >
                              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5 px-3 py-2.5">
                                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                                  <input
                                    type="checkbox"
                                    className={cn('h-4 w-4 shrink-0', esta ? 'accent-green-600' : 'accent-primary')}
                                    checked={esta && !noAplica}
                                    disabled={noAplica}
                                    onChange={() => toggleCheck(c.dni, o.id)}
                                  />
                                  <span className={cn('min-w-0 flex-1 break-words text-sm', noAplica ? 'text-slate-400' : 'text-slate-700')}>{o.etiqueta}</span>
                                </label>
                                {o.puntos != null && o.puntos > 0 ? (
                                  <span className="shrink-0 rounded-full bg-primary-50 px-2 py-0.5 text-[11px] font-bold tabular-nums text-primary-700">{o.puntos} pts</span>
                                ) : null}
                                <button
                                  type="button"
                                  aria-pressed={noAplica}
                                  onClick={() => marcarNoAplica(c.dni, o.id)}
                                  className={cn(
                                    'inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold transition-colors',
                                    noAplica ? 'bg-slate-200 text-slate-700' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700'
                                  )}
                                  title={noAplica ? 'Quitar marca de no aplica' : 'Este punto no aplica a este trabajador'}
                                >
                                  <Ban className="h-3.5 w-3.5" />
                                  No aplica
                                </button>
                              </div>
                              {noAplica ? (
                                <p className="border-t border-slate-200 px-3 py-2 text-xs font-medium text-slate-500">Este punto no se evalúa para este trabajador.</p>
                              ) : !esta ? (
                                // Punto sin marcar de ESTE trabajador: responsables de la falla junto al punto, como en CHECKLIST/UNIDAD.
                                <div className="min-w-0 border-t border-red-100 bg-red-50/60 px-3 py-2.5">
                                  <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                                    Responsables de los puntos incumplidos <span className="font-semibold text-red-500">· sin cumplir</span>
                                  </p>
                                  {respFallidos ? (
                                    <SelectorResponsables
                                      responsables={responsablesDeCheck(item, o)}
                                      seleccion={c.responsablesPorOpcion?.[o.id] ?? []}
                                      gerente={gerente}
                                      onChange={(sel) => marcarResponsables(c.dni, o.id, sel)}
                                    />
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                          )
                        })}
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          ) : ocultosVisibles > 0 && !busqueda.trim() ? (
            // Todo lo que queda en pantalla está oculto por historial. No es un
            // error ni una búsqueda sin resultados: es que ya no hay nada por
            // revisar acá.
            <p className="rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
              No queda nadie por revisar: los {ocultosVisibles} de la lista ya estaban completos en la evaluación anterior.
            </p>
          ) : (
            <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500">
              No se encontraron trabajadores con “{busqueda}”.
            </p>
          )}
        </div>
      ) : !barraVisible ? (
        <p className="text-sm text-slate-400">Aún no hay trabajadores cargados. Pulsa “Cargar trabajadores” para traerlos de la tienda.</p>
      ) : null}
      <Confirmar
        open={confirmarLimpiar}
        texto="¿Querés vaciar la lista de trabajadores? Se quitarán todos y se descartan los avances del checklist. Después podés volver a cargarla desde la tienda con «Cargar trabajadores»."
        textoConfirmar="Vaciar lista"
        onConfirm={limpiar}
        onCancel={() => setConfirmarLimpiar(false)}
      />
      {/*
        Descartar a alguien que ya no trabaja en la tienda es otra cosa que vaciar
        la lista: acá se va trabajo ya revisado y no se puede recuperar. Por eso
        `Confirmar` muestra el texto pero el botón va en color normal, no en rojo
        de "se va a borrar": lo que se está por hacer es aplicar la lista nueva.
      */}
      <Confirmar
        open={!!pendienteCombinacion}
        texto={
          pendienteCombinacion
            ? `Estos trabajadores ya no están en la tienda y sus respuestas se van a descartar: ${pendienteCombinacion.perdidos
                .slice(0, 6)
                .map((c) => `${c.lastname} ${c.name}`.trim())
                .join(', ')}${pendienteCombinacion.perdidos.length > 6 ? ` y ${pendienteCombinacion.perdidos.length - 6} más` : ''}. Si solo se inactivaron, se los quita de la lista, no de la API.`
            : ''
        }
        textoConfirmar="Actualizar igual"
        variant="secondary"
        onConfirm={() => {
          if (pendienteCombinacion) ocultarResueltos(pendienteCombinacion.historial, pendienteCombinacion.colaboradores)
        }}
        onCancel={() => setPendienteCombinacion(null)}
      />
    </div>
  )
}

function UnidadesEditor({ item, valor, onChange, gerente }: { item: Item; valor: unknown; onChange: (v: unknown) => void; gerente?: string | null }) {
  const [info, setInfo] = useState('')
  const [codigo, setCodigo] = useState('')
  const [abiertoIdx, setAbiertoIdx] = useState<number | null>(null)

  const v = (valor as ValorUnidadChecklist | null) ?? { unidades: [] }
  const unidades = v.unidades ?? []
  const opts = (item.opciones ?? []) as Opcion[]

  const actualizar = (unids: UnidadChecklist[]) => onChange({ ...v, unidades: unids })

  // Carga única (repetible = false): el checklist se marca una sola vez.
  if (item.repetible === false) {
    const unica = unidades[0] ?? { codigo: 'Única', selected: [] }
    const marcadas = unica.selected ?? []
    const completas = unidadCumple(unica, opts)
    const toggleCheck = (opcionId: string) => {
      const sel = marcadas.includes(opcionId) ? marcadas.filter((x) => x !== opcionId) : [...marcadas, opcionId]
      actualizar([{ ...unica, selected: sel }])
    }
    const setCodigoUnica = (codigo: string) => {
      actualizar([{ ...unica, codigo }])
    }
    const codigoVisible = unica.codigo && unica.codigo !== 'Única' ? unica.codigo : ''
    return (
      <div className="space-y-3">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Checklist (una sola carga)</p>
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-500">Identificador (ej. Nº de serie)</p>
          <Input
            placeholder="Ej. serial de la impresora fiscal"
            value={codigoVisible}
            onChange={(e) => setCodigoUnica(e.target.value)}
          />
          <p className="mt-1.5 text-[10px] text-slate-400">
            Identifica a qué elemento corresponde este checklist (impresora fiscal, caja registradora, etc.).
          </p>
        </div>
        {!opts.length ? (
          <p className="text-xs font-medium text-amber-600">Este ítem no tiene checklist definido. El Líder debe configurarlo desde Ítems de evaluación.</p>
        ) : (
          <div className="space-y-2">
            {opts.map((o) => {
              const esta = marcadas.includes(o.id)
              const respFallidos = responsablesDeCheck(item, o).length > 0
              return (
                <div
                  key={o.id}
                  className={cn(
                    'min-w-0 overflow-hidden rounded-xl border transition-colors',
                    esta ? 'border-slate-200 bg-white' : 'border-red-300 bg-red-50'
                  )}
                >
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5 px-3 py-2.5">
                    <span className="min-w-0 flex-1 break-words text-sm text-slate-700">{o.etiqueta}</span>
                    {o.puntos != null && o.puntos > 0 ? (
                      <span className="shrink-0 rounded-full bg-primary-50 px-2 py-0.5 text-[11px] font-bold tabular-nums text-primary-700">{o.puntos} pts</span>
                    ) : null}
                  </div>
                  {esta ? (
                    // Estado neutro (validado): sin alerta roja ni responsables.
                    <div className="flex min-w-0 flex-wrap items-center gap-2 border-t border-slate-100 px-3 py-2.5">
                      <label className="flex cursor-pointer items-center gap-2">
                        <input
                          type="checkbox"
                          className="h-4 w-4 shrink-0 accent-green-600"
                          checked={esta}
                          onChange={() => toggleCheck(o.id)}
                        />
                        <span className="text-xs font-semibold text-green-700">Punto validado</span>
                      </label>
                    </div>
                  ) : (
                    // Estado de error (sin cumplir): validar el punto + responsables de la falla, en el mismo espacio del check.
                    <div className="min-w-0 border-t border-red-100 bg-red-50/60 px-3 py-2.5">
                      <label className="mb-2 flex cursor-pointer items-center gap-2">
                        <input
                          type="checkbox"
                          className="h-4 w-4 shrink-0 accent-primary"
                          checked={esta}
                          onChange={() => toggleCheck(o.id)}
                        />
                        <span className="text-xs font-bold text-slate-600">
                          Responsables de los puntos incumplidos <span className="font-semibold text-red-500">· sin cumplir</span>
                        </span>
                      </label>
                      {respFallidos ? (
                        <SelectorResponsables
                          responsables={responsablesDeCheck(item, o)}
                          seleccion={v.responsablesPorOpcion?.[o.id] ?? []}
                          gerente={gerente}
                          onChange={(sel) =>
                            onChange({ ...v, responsablesPorOpcion: { ...(v.responsablesPorOpcion ?? {}), [o.id]: sel } })
                          }
                        />
                      ) : null}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
        {marcadas.length ? (
          <p className="text-sm text-slate-600">
            {codigoVisible ? <span className="font-semibold text-slate-700">{codigoVisible} · </span> : null}
            {marcadas.length}/{opts.length} requerimientos · {completas ? 'Completo' : 'Incompleto'}
          </p>
        ) : null}
      </div>
    )
  }

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
                      {cumple ? 'Completo' : `${u.selected.length}/${opts.length}`}
                    </span>
                    <button
                      type="button"
                      onClick={() => { setAbiertoIdx(abierto ? null : i) }}
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-slate-400 hover:bg-slate-100"
                      title={abierto ? 'Cerrar checklist' : 'Abrir checklist'}
                    >
                      <ChevronDown className={cn('h-4 w-4 transition-transform', abierto ? 'rotate-180' : '')} />
                    </button>
                    <button
                      type="button"
                      onClick={() => quitar(i)}
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-red-400 hover:bg-red-50 hover:text-red-500"
                      title="Quitar unidad"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  {abierto ? (
                    <div className="space-y-2 border-t border-slate-100 px-3 pb-3 pt-2">
                      {opts.map((o) => {
                        const esta = u.selected.includes(o.id)
                        const incumple = checkIncumplido(item, o, v)
                        const respFallidos = responsablesDeCheck(item, o).length > 0
                        return (
                          <div
                            key={o.id}
                            className={cn(
                              'min-w-0 overflow-hidden rounded-xl border transition-colors',
                              incumple ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-white'
                            )}
                          >
                            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5 px-3 py-2.5">
                              <span className="min-w-0 flex-1 break-words text-sm text-slate-700">{o.etiqueta}</span>
                              {o.puntos != null && o.puntos > 0 ? (
                                <span className="shrink-0 rounded-full bg-primary-50 px-2 py-0.5 text-[11px] font-bold tabular-nums text-primary-700">{o.puntos} pts</span>
                              ) : null}
                            </div>
                            {incumple ? (
                              // Estado de error (sin cumplir): validar el punto + responsables de la falla, en el mismo espacio del check.
                              <div className="min-w-0 border-t border-red-100 bg-red-50/60 px-3 py-2.5">
                                <label className="mb-2 flex cursor-pointer items-center gap-2">
                                  <input
                                    type="checkbox"
                                    className="h-4 w-4 shrink-0 accent-primary"
                                    checked={esta}
                                    onChange={() => toggleCheck(i, o.id)}
                                  />
                                  <span className="text-xs font-bold text-slate-600">
                                    Responsables de los puntos incumplidos <span className="font-semibold text-red-500">· sin cumplir</span>
                                  </span>
                                </label>
                                {respFallidos ? (
                                  <SelectorResponsables
                                    responsables={responsablesDeCheck(item, o)}
                                    seleccion={v.responsablesPorOpcion?.[o.id] ?? []}
                                    gerente={gerente}
                                    onChange={(sel) =>
                                      onChange({ ...v, responsablesPorOpcion: { ...(v.responsablesPorOpcion ?? {}), [o.id]: sel } })
                                    }
                                  />
                                ) : null}
                              </div>
                            ) : (
                              // Estado neutro (validado): sin alerta roja ni responsables.
                              <div className="flex min-w-0 flex-wrap items-center gap-2 border-t border-slate-100 px-3 py-2.5">
                                <label className="flex cursor-pointer items-center gap-2">
                                  <input
                                    type="checkbox"
                                    className="h-4 w-4 shrink-0 accent-green-600"
                                    checked={esta}
                                    onChange={() => toggleCheck(i, o.id)}
                                  />
                                  <span className="text-xs font-semibold text-green-700">Punto validado</span>
                                </label>
                              </div>
                            )}
                          </div>
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
              className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium text-slate-400 hover:bg-red-50 hover:text-red-500"
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

function diasDesdeIngreso(fecha: string): number | null {
  const fechaBase = /^\d{4}-\d{2}-\d{2}$/.test(fecha) ? `${fecha}T00:00:00` : fecha
  const ingreso = new Date(fechaBase)
  if (Number.isNaN(ingreso.getTime())) return null
  const hoy = new Date()
  ingreso.setHours(0, 0, 0, 0)
  hoy.setHours(0, 0, 0, 0)
  const dias = Math.floor((hoy.getTime() - ingreso.getTime()) / 86400000)
  return dias >= 0 ? dias : null
}

function requisitoContrato(fecha: string): string | null {
  const dias = diasDesdeIngreso(fecha)
  if (dias == null) return null
  if (dias < 30) return 'Requiere contrato 1'
  if (dias < 90) return 'Requiere contratos 1, 2 y 3'
  return 'Requiere contrato fijo en el expediente'
}

function BotonCumple({ activo, onPick }: { activo: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      className={cn(
        'flex min-h-[56px] flex-col items-center justify-center gap-1 rounded-full border-2 px-3 py-3 transition-colors',
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
        'flex min-h-[56px] flex-col items-center justify-center gap-1 rounded-full border-2 px-3 py-3 transition-colors',
        activo ? 'border-red-600 bg-red-50 text-red-700' : 'border-slate-200 bg-white text-slate-500'
      )}
    >
      <X className="text-2xl" strokeWidth={2.5} />
      <span className="text-sm font-bold">No cumple</span>
    </button>
  )
}

function CampoConciliacion({ etiqueta, valor, onChange }: { etiqueta: string; valor: number | null; onChange: (n: number | null) => void }) {
  return (
    <div className="min-w-0 flex-1">
      <label className="mb-1 block text-xs font-medium text-slate-500">{etiqueta}</label>
      <div className="w-full">
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
        {subiendo ? <Spinner size={16} light /> : <Camera className="h-4 w-4" />}
      </button>
    </>
  )
}

/** Deslizador horizontal con degradado difuminado rojo → amarillo → verde.
 *  El tope derecho es `maximo` (o un máximo derivado); el color del pulgar y el
 *  veredicto dependen del `minimo` configurado. */
function BarraRango({ etiqueta, minimo, maximo, unidad, valor, onChange }: { etiqueta: string; minimo?: number; maximo?: number; unidad?: string; valor: number | null; onChange: (n: number) => void }) {
  const min = typeof minimo === 'number' && minimo >= 0 ? minimo : 0
  // Máximo: el configurado si supera al mínimo; si no, un tope derivado sensible.
  const max = typeof maximo === 'number' && maximo > min ? maximo : Math.max(100, min * 2, min + 1)
  // Posición del mínimo sobre la barra (allí empieza a "teñirse" de verde).
  const pctMin = Math.max(8, Math.min(90, (min / max) * 100))
  const gradiente = `linear-gradient(90deg, #dc2626 0%, #f59e0b ${pctMin}%, #22c55e 100%)`
  const fmt = (n: number) => `${Math.round(n * 10) / 10}`
  const cumple = valor != null && min > 0 ? valor >= min : valor != null
  const colorThumb = valor == null ? '#64748b' : cumple ? '#16a34a' : '#dc2626'
  const sufijo = unidad ? ` ${unidad}` : ''

  return (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-semibold text-slate-500">Indicá el valor sobre la barra</p>
        <span
          className={cn(
            'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold',
            valor == null ? 'bg-slate-100 text-slate-500' : cumple ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
          )}
        >
          {valor == null ? 'Sin valor' : cumple ? 'Cumple' : 'No alcanza el mínimo'}
        </span>
      </div>

      <div className="relative flex h-7 items-center">
        <div className="absolute inset-x-0 top-1/2 h-3.5 -translate-y-1/2 rounded-full" style={{ background: gradiente }} aria-hidden />
        <div
          className="absolute top-1/2 h-6 w-0.5 -translate-y-1/2 rounded-full bg-white shadow ring-1 ring-slate-800/30"
          style={{ left: `calc(${pctMin}% - 1px)` }}
          title={min > 0 ? `Mínimo: ${fmt(min)}${sufijo}` : 'Valor mínimo: 0'}
          aria-hidden
        />
        <input
          type="range"
          className="barra-rango relative"
          min={0}
          max={max}
          step="any"
          value={valor ?? 0}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-label={`Valor de ${etiqueta}`}
          style={{ '--barra-thumb': colorThumb } as React.CSSProperties}
        />
      </div>

      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] text-slate-400">
          Mín. aceptable: {fmt(min)}{sufijo} · escala 0–{fmt(max)}{sufijo}
        </span>
        <span className="text-sm font-extrabold tabular-nums text-slate-800">
          {valor != null ? `${fmt(valor)}${sufijo}` : '—'}
        </span>
      </div>
    </>
  )
}