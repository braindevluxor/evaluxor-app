import { useCallback, useEffect, useState, Fragment } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Check, FileDown, FolderOpen, RefreshCw, Tag, X } from 'lucide-react'
import { useOffline } from '../context/OfflineContext'
import { obtenerEvaluacion, resumirEvaluacion, listarPerfilesSync, type DetalleEvaluacion } from '../lib/data/indicadores'
import { descargarInformePdf } from '../lib/pdf'
import { supabase } from '../lib/supabase'
import { itemsEnOrdenJerarquico, hijosOrdenados } from '../lib/hierarchy'
import { raicesDeModulo } from '../lib/pasos'
import { causaSubida, detalleTecnico, mensajeSubida } from '../lib/subida'
import { etiquetaTipo, itemsProporcion, conciliacionTotal, conciliacionPorcentaje, conciliacionComparable, colaboradorCumple, opcionesAplicablesColaborador, opcionCumplida, responsablesDeOpcion, unidadCumple, incumplimientosPorResponsable, valorPorResponsable, veredictoItem, formatearLastSync, formatearPrecioBase, tieneRespuesta, type ValorConciliacion, type ValorCumple, type ValorChecklist, type ValorListaColaboradores, type ValorUnidadChecklist, type VeredictoItem } from '../lib/scoring'
import { esColorHex, etiquetaDeCampo, formatearValorConsulta } from '../lib/data/apis'
import type { Foto, Item, Opcion, SucursalOpcion } from '../lib/types'
import { Badge, Button, Card, Puntaje, Skeleton, SkeletonTarjetas, Spinner, cn } from '../components/ui'
import { UltimaSync } from '../components/UltimaSync'
import { IncidenciasEvaluacion } from '../components/IncidenciasEvaluacion'
import { Fotogaleria, FotogaleriaRutas } from '../components/dashboard/Fotogaleria'
import { PlanoLectura } from '../components/PlanoEditor'
import { pathsEvidenciaChecklist, pathsEvidenciaCumple, pathsEvidenciaOpcion } from '../lib/evidencias'

function estadoBadge(puntaje: number | null): { texto: string; color: number } {
  if (puntaje == null) return { texto: 'Sin puntaje', color: 4 }
  if (puntaje >= 80) return { texto: 'Cumple', color: 2 }
  if (puntaje >= 60) return { texto: 'En riesgo', color: 3 }
  return { texto: 'No cumple', color: 4 }
}

function fmt(n: number): string {
  return Number.isInteger(n) ? `${n}` : `${Math.round(n * 100) / 100}`
}

function opcionesQueAplican(sucursalId: string, sucursalOpciones: SucursalOpcion[]): Map<string, string[]> {
  const mapa = new Map<string, string[]>()
  for (const o of sucursalOpciones.filter((x) => x.sucursal_id === sucursalId && x.activa)) {
    const arr = mapa.get(o.item_id) ?? []
    arr.push(o.opcion_id)
    mapa.set(o.item_id, arr)
  }
  return mapa
}

/**
 * Etiqueta de una opción del checklist. Las de tipo RANGO llevan el valor cargado
 * contra el mínimo: sin ese par no se puede saber qué falta para cumplir.
 */
function etiquetaOpcion(o: Opcion, v: ValorChecklist | null | undefined): string {
  if (o.tipo_respuesta === 'RANGO') {
    return `${o.etiqueta}: ${v?.valores?.[o.id] ?? '—'}${o.unidad ? ` ${o.unidad}` : ''} (mín. ${o.minimo ?? '—'})`
  }
  return o.etiqueta
}

/**
 * Las opciones que quedaron sin tildar, que en un ítem con checklist son
 * justamente lo no cumplido. Se nombran una por una porque "3 de 5" no dice qué
 * falta, y lo que falta es lo que hay que ir a buscar a la tienda.
 */
function opcionesSinTildar(opciones: Opcion[], v: ValorChecklist | null | undefined): Opcion[] {
  const noAplican = v?.informativos ?? []
  return opciones.filter((o) => !noAplican.includes(o.id) && !opcionCumplida(o, v, o.id))
}

/**
 * Clave de una fila del detalle: el ítem más el registro (contenedor) al que
 * pertenece. Es la que usan el veredicto y `respuestaDe`, así que las dos cosas
 * hablan siempre de la misma fila.
 */
function claveFila(itemId: string, instId?: string | null): string {
  return `${itemId}|${instId ?? ''}`
}

/** Bloque de lo que quedó pendiente, común a los tres ítems con checklist. */
function Pendientes({ titulo, etiquetas }: { titulo: string; etiquetas: string[] }) {
  if (!etiquetas.length) return null
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-bold uppercase tracking-wide text-red-700">
        {titulo} · {etiquetas.length}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {etiquetas.map((e) => (
          <span key={e} className="rounded-full border border-dashed border-red-300 bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-700">
            {e}
          </span>
        ))}
      </div>
    </div>
  )
}

export function ValorRespuesta({
  item,
  valor,
  soloIncumplimientos = false
}: {
  item: Item
  valor: unknown
  soloIncumplimientos?: boolean
}) {
  switch (item.tipo) {
    case 'CUMPLE_NO_CUMPLE': {
      const v = valor as ValorCumple | null
      if (v?.value == null) return <p className="text-sm text-slate-400">Sin responder</p>
      const comentarios = (v.evidencias ?? []).map((e) => e.comentario?.trim()).filter(Boolean) as string[]
      return (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {v.informativo ? (
              <span className="inline-flex rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-bold text-amber-800">No aplica · se excluye del puntaje</span>
            ) : null}
            <span className={cn('inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold', v.value ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700')}>
              {v.value ? 'Cumple' : 'No cumple'}
            </span>
          </div>
          {comentarios.length ? (
            <div className="space-y-1">
              {comentarios.map((c, i) => (
                <p key={i} className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">“{c}”</p>
              ))}
            </div>
          ) : null}
        </div>
      )
    }
    case 'CHECKLIST': {
      const v = valor as ValorChecklist | null
      const opcionesNoAplican = v?.informativos ?? []
      const opciones = (item.opciones ?? []) as Opcion[]
      const sel = (v?.selected ?? []).filter((id) => !opcionesNoAplican.includes(id))
      if (!sel.length && !opcionesNoAplican.length) return <p className="text-sm text-slate-400">Ninguna opción marcada</p>
      const pendientes = opcionesSinTildar(opciones, v)
      const opcionesVisibles = (soloIncumplimientos ? pendientes : opciones)
        .filter((opcion) => !opcionesNoAplican.includes(opcion.id))
        .sort((a, b) => Number(opcionCumplida(b, v, b.id)) - Number(opcionCumplida(a, v, a.id)))
      const mostrarResponsables = pendientes.length > 0
      return (
        <div className="overflow-hidden rounded-lg border border-slate-200">
          <table className="w-full table-fixed text-left text-xs">
            <thead className="bg-slate-50 text-[10px] font-bold uppercase tracking-wide text-slate-500">
              <tr>
                <th scope="col" className={cn('px-3 py-2', mostrarResponsables ? 'w-[46%]' : 'w-[58%]')}>Descripción</th>
                {mostrarResponsables ? <th scope="col" className="w-[22%] px-2 py-2">Responsable</th> : null}
                <th scope="col" className={cn('px-2 py-2', mostrarResponsables ? 'w-[32%]' : 'w-[42%]')}>Foto</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {opcionesVisibles.map((opcion) => {
                const cumplida = opcionCumplida(opcion, v, opcion.id)
                const seleccionados = v?.responsablesPorOpcion?.[opcion.id] ?? []
                const responsables = cumplida || !mostrarResponsables
                  ? []
                  : seleccionados.length
                    ? seleccionados
                    : v?.responsablesGerente
                      ? [v.responsablesGerente]
                      : responsablesDeOpcion(opcion).length
                        ? responsablesDeOpcion(opcion)
                        : item.responsables ?? []
                const fotos = pathsEvidenciaOpcion(v?.evidencias?.[opcion.id])
                return (
                  <tr key={opcion.id} className={cn(cumplida ? 'bg-white' : 'bg-red-50/40')}>
                    <td className="break-words px-3 py-2.5 align-top text-slate-700">
                      <span className="flex items-start gap-2">
                        <span
                          aria-label={cumplida ? 'Cumple' : 'No cumple'}
                          title={cumplida ? 'Cumple' : 'No cumple'}
                          className={cn(
                            'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-black leading-none',
                            cumplida ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                          )}
                        >
                          {cumplida ? '✓' : '×'}
                        </span>
                        <span>{etiquetaOpcion(opcion, v)}</span>
                      </span>
                    </td>
                    {mostrarResponsables ? (
                      <td className="break-words px-2 py-2.5 align-top text-slate-600">
                        {responsables.length ? responsables.join(', ') : '—'}
                      </td>
                    ) : null}
                    <td className="px-2 py-2 align-top">
                      {fotos.length
                        ? <FotogaleriaRutas paths={fotos} compacta />
                        : <span className="text-slate-300">—</span>}
                    </td>
                  </tr>
                )
              })}
              {!opcionesVisibles.length ? (
                <tr>
                  <td colSpan={mostrarResponsables ? 3 : 2} className="px-3 py-3 text-center text-slate-400">
                    No hay opciones incumplidas.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )
    }
    case 'LISTA_COLABORADORES': {
      const v = valor as ValorListaColaboradores | null
      const cols = v?.colaboradores ?? []
      if (!cols.length) return <p className="text-sm text-slate-400">Sin colaboradores</p>
      const opts = (item.opciones ?? []) as Opcion[]
      const aplican = cols.filter((c) => c.aplica)
      const conChecksAplicables = aplican.filter((c) => opcionesAplicablesColaborador(c, opts).length > 0)
      const cumplen = conChecksAplicables.filter((c) => colaboradorCumple(c, opts)).length
      const colaboradoresVisibles = cols.filter((c) => {
        if (!c.aplica) return false
        if (!soloIncumplimientos) return true
        const checks = opcionesAplicablesColaborador(c, opts)
        return checks.length > 0 && !colaboradorCumple(c, opts)
      })
      return (
        <div className="space-y-3">
          {v?.informativo ? (
            <p className="text-xs font-bold text-amber-700">No aplica · se excluye del puntaje</p>
          ) : null}
          <p className="text-sm font-semibold text-slate-700">
            {soloIncumplimientos
              ? `${colaboradoresVisibles.length} colaborador(es) con incumplimientos`
              : <>
                  {aplican.length} colaboradores en cuenta · {cumplen}/{conChecksAplicables.length} completos
                  {conChecksAplicables.length < aplican.length ? ` · ${aplican.length - conChecksAplicables.length} sin puntos aplicables` : ''}
                </>}
          </p>
          <ul className="space-y-2">
            {colaboradoresVisibles.map((c) => {
              const checksAplicables = opcionesAplicablesColaborador(c, opts)
              const cumple = checksAplicables.length > 0 && colaboradorCumple(c, opts)
              const marcadas = (c.selected ?? []).map((id) => opts.find((o) => o.id === id)?.etiqueta ?? id)
              // Lo que a este colaborador le falta tildar: es lo que lo deja incompleto.
              const pendientes = checksAplicables.filter((o) => !(c.selected ?? []).includes(o.id)).map((o) => o.etiqueta)
              return (
                <li key={c.dni} className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <span className="min-w-0 font-medium text-slate-800">
                      {c.name} {c.lastname}
                      <span className="ml-1.5 text-xs font-normal text-slate-500">C.I. {c.nationality ?? ''}{c.dni} · {c.role_name || 'Sin rol'}</span>
                    </span>
                    <span className="shrink-0">
                      <EstadoColaborador aplica={c.aplica} cumple={cumple} sinPuntosAplicables={c.aplica && checksAplicables.length === 0} />
                    </span>
                  </div>
                  {!soloIncumplimientos && c.aplica && marcadas.length ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {marcadas.map((l) => (
                        <span key={l} className="rounded-full bg-primary-50 px-2 py-0.5 text-[11px] font-semibold text-primary-700">{l}</span>
                      ))}
                    </div>
                  ) : null}
                  {c.aplica ? <Pendientes titulo={soloIncumplimientos ? 'No cumplidas' : 'Sin tildar'} etiquetas={pendientes} /> : null}
                </li>
              )
            })}
          </ul>
        </div>
      )
    }
    case 'UNIDAD_CHECKLIST': {
      const v = valor as ValorUnidadChecklist | null
      const unids = v?.unidades ?? []
      if (!unids.length) return <p className="text-sm text-slate-400">Sin unidades</p>
      const opts = (item.opciones ?? []) as Opcion[]
      const cumplen = unids.filter((u) => unidadCumple(u, opts)).length
      const unidadesVisibles = soloIncumplimientos ? unids.filter((u) => !unidadCumple(u, opts)) : unids
      return (
        <div className="space-y-3">
          {v?.informativo ? (
            <p className="text-xs font-bold text-amber-700">No aplica · se excluye del puntaje</p>
          ) : null}
          <p className="text-sm font-semibold text-slate-700">
            {soloIncumplimientos
              ? `${unidadesVisibles.length} unidad(es) con incumplimientos`
              : `${unids.length} unidades en cuenta · ${cumplen}/${unids.length} completas`}
          </p>
          <ul className="space-y-2">
            {unidadesVisibles.map((u, i) => {
              const cumple = unidadCumple(u, opts)
              const marcadas = (u.selected ?? []).map((id) => opts.find((o) => o.id === id)?.etiqueta ?? id)
              const pendientes = opts.filter((o) => !(u.selected ?? []).includes(o.id)).map((o) => o.etiqueta)
              return (
                <li key={`${u.codigo}-${i}`} className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <span className="min-w-0 font-medium text-slate-800">{u.codigo}</span>
                    <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold', cumple ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500')}>
                      {cumple ? 'Completo' : 'Incompleto'}
                    </span>
                  </div>
                  {!soloIncumplimientos && marcadas.length ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {marcadas.map((l) => (
                        <span key={l} className="rounded-full bg-primary-50 px-2 py-0.5 text-[11px] font-semibold text-primary-700">{l}</span>
                      ))}
                    </div>
                  ) : null}
                  <Pendientes titulo={soloIncumplimientos ? 'No cumplidas' : 'Sin tildar'} etiquetas={pendientes} />
                </li>
              )
            })}
          </ul>
        </div>
      )
    }
    case 'PLANO_XY':
      return <PlanoLectura valor={valor} soloIncumplimientos={soloIncumplimientos} />
    case 'CONCILIACION': {
      const v = valor as ValorConciliacion | null
      const ps = v?.productos ?? []
      if (!ps.length) return <p className="text-sm text-slate-400">Sin productos</p>
      const total = conciliacionTotal(v)
      // La columna del contra dato sigue la configuración del ítem, que es el mismo
      // número que el evaluador tenía delante mientras escaneaba.
      const esPrecio = item.contra_dato === 'FINAL_BASE'
      const filas = ps.map((p, i) => {
        const teorica = typeof p.teorica === 'number' ? p.teorica : null
        const fisica = typeof p.fisica === 'number' ? p.fisica : null
        const comparable = conciliacionComparable(p)
        const variacion = comparable
          ? {
              cantidad: Math.abs(p.fisica - p.teorica),
              verbo: p.fisica > p.teorica
                ? (Math.abs(p.fisica - p.teorica) === 1 ? 'sobra' : 'sobran')
                : (Math.abs(p.fisica - p.teorica) === 1 ? 'falta' : 'faltan')
            }
          : null
        return { p, indice: i, teorica, fisica, comparable, variacion, descuadra: comparable && p.fisica !== p.teorica }
      })
      const descuadrados = filas.filter((f) => f.descuadra).length
      const filasVisibles = soloIncumplimientos ? filas.filter((f) => f.descuadra) : filas
      return (
        <div className="space-y-3">
          {v?.informativo ? (
            <p className="text-xs font-bold text-amber-700">No aplica · se excluye del puntaje</p>
          ) : null}
          <div className="rounded-xl border border-slate-200">
            <table className="w-full table-fixed text-xs sm:text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                  <th scope="col" className="w-[13%] break-words px-1.5 py-2 font-bold sm:px-2">SKU</th>
                  <th scope="col" className="w-[23%] break-words px-1.5 py-2 font-bold sm:px-2">Producto</th>
                  <th scope="col" className="w-[12%] break-words px-1.5 py-2 text-right font-bold sm:px-2">{esPrecio ? 'Sistema' : 'Teórica'}</th>
                  <th scope="col" className="w-[12%] break-words px-1.5 py-2 text-right font-bold sm:px-2">{esPrecio ? 'Hablador' : 'Física'}</th>
                  <th scope="col" className="w-[18%] break-words px-1.5 py-2 font-bold sm:px-2">{esPrecio ? 'Precio base' : 'Sync'}</th>
                  <th scope="col" className="w-[22%] break-words px-1.5 py-2 text-right font-bold sm:px-2">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filasVisibles.map(({ p, indice, teorica, fisica, comparable, variacion, descuadra }) => (
                  <tr key={`${p.sku}-${indice}`} className={cn(descuadra && 'bg-red-50/50')}>
                    <td className="break-all px-1.5 py-2 font-medium text-slate-800 sm:px-2">{p.sku || '—'}</td>
                    <td className="break-words px-1.5 py-2 text-slate-600 sm:px-2">{p.nombre || '—'}</td>
                    <td className="break-all px-1.5 py-2 text-right tabular-nums text-slate-700 sm:px-2">{teorica ?? '—'}</td>
                    <td className="break-all px-1.5 py-2 text-right tabular-nums text-slate-700 sm:px-2">{fisica ?? '—'}</td>
                    <td className="break-words px-1.5 py-2 text-slate-600 sm:px-2">
                      {esPrecio ? <span className="block tabular-nums">{formatearPrecioBase(p.finalBase)}</span> : null}
                      {p.lastSync ? <span className="block text-[11px] text-slate-400">{formatearLastSync(p.lastSync)}</span> : null}
                    </td>
                    <td className="break-words px-1.5 py-2 text-right sm:px-2">
                      {!comparable ? (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-500">Sin datos</span>
                      ) : descuadra ? (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-700">
                          {conciliacionPorcentaje(p) ?? '—'}% concilia,{' '}
                          {variacion
                            ? `${variacion.verbo} ${fmt(variacion.cantidad)}`
                            : ''}
                        </span>
                      ) : (
                        <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-bold text-green-700">Concilia</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-sm text-slate-600">
            {soloIncumplimientos ? `${descuadrados} producto(s) con descuadre` : `${filas.length} producto(s) escaneado(s) · `}
            {!soloIncumplimientos && (descuadrados ? `${descuadrados} con descuadre` : 'todos concilian')}
            {total != null ? ` · tasa de descuadre ${total}%` : ''}
          </p>
        </div>
      )
    }
    default:
      return <p className="text-sm text-slate-400">Sin respuesta</p>
  }
}

export function EvaluacionDetalle() {
  const { evaluacionId = '' } = useParams()
  const navigate = useNavigate()
  const [detalle, setDetalle] = useState<DetalleEvaluacion | null>(null)
  // Nombre y última subida a la nube de quienes respondieron en esta evaluación.
  const [evaluadores, setEvaluadores] = useState<Record<string, { nombre: string; ultima_sync: string | null }>>({})
  const [estado, setEstado] = useState<'cargando' | 'error' | 'ok'>('cargando')
  const [descargando, setDescargando] = useState(false)
  const [sincronizando, setSincronizando] = useState(false)
  const [aviso, setAviso] = useState<{ texto: string; ok: boolean } | null>(null)
  const [error, setError] = useState('')
  const [moduloActivoId, setModuloActivoId] = useState('')
  /**
   * Filtro del detalle. El veredicto sale del mismo `proporcionItem` que calcula
   * el puntaje, así que "No cumplido" es exactamente lo que el tablero descuenta:
   * un checklist con un check sin tildar entra acá, y uno completo no.
   */
  const [filtro, setFiltro] = useState<'ambos' | 'cumple' | 'no-cumple'>('ambos')
  const { online, pendientes, sync } = useOffline()
  const moduloIdsKey = detalle?.modulos.map((modulo) => modulo.id).join('|') ?? ''

  useEffect(() => {
    const moduloIds = moduloIdsKey ? moduloIdsKey.split('|') : []
    if (!moduloIds.length) {
      setModuloActivoId('')
      return
    }
    setModuloActivoId((actual) => moduloIds.includes(actual) ? actual : moduloIds[0])
    if (typeof IntersectionObserver === 'undefined') return

    const observer = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
      const id = visible[0]?.target.id.replace(/^modulo-/, '')
      if (id) setModuloActivoId(id)
    }, { rootMargin: '-20% 0px -65% 0px', threshold: 0 })

    for (const id of moduloIds) {
      const section = document.getElementById(`modulo-${id}`)
      if (section) observer.observe(section)
    }
    return () => observer.disconnect()
  }, [moduloIdsKey])

  const recargar = useCallback(async () => {
    const d = await obtenerEvaluacion(evaluacionId)
    if (!d) return
    setDetalle(d)
    // Quién respondió y cuándo subió su avance por última vez: se refresca junto
    // con la evaluación (en vivo cada 15 s) para ver al instante si alguien sube.
    const ids = Array.from(new Set(d.respuestas.map((r) => r.respondido_por).filter((x): x is string => !!x)))
    void listarPerfilesSync(ids).then(setEvaluadores)
  }, [evaluacionId])

  useEffect(() => {
    if (!aviso) return
    const t = window.setTimeout(() => setAviso(null), 6000)
    return () => window.clearTimeout(t)
  }, [aviso])

  // Sincronización manual: sube lo que quedó pendiente en el dispositivo (el
  // Líder también puede haber respondido algo) y vuelve a traer la evaluación
  // del servidor. La vista en vivo ya refresca sola cada 15 s; esto es para
  // hacerlo en el momento.
  const sincronizar = useCallback(async () => {
    if (sincronizando) return
    if (!online) {
      setAviso({ texto: 'Sin conexión: no se puede sincronizar ahora.', ok: false })
      return
    }
    setSincronizando(true)
    try {
      let mensaje: { texto: string; ok: boolean } = { texto: 'Datos actualizados.', ok: true }
      if (pendientes > 0) {
        const r = await sync()
        if (r.fail) mensaje = { texto: `Se subieron ${r.ok}, pero ${r.fail} no se pudieron guardar.`, ok: false }
        else if (r.ok) mensaje = { texto: `Se guardaron ${r.ok} evaluación(es) pendiente(s) y se actualizaron los datos.`, ok: true }
      }
      await recargar()
      setAviso(mensaje)
    } catch (e) {
      // Se nombra la causa real: un rechazo del servidor no se arregla con WiFi.
      const causa = causaSubida(e)
      setAviso({ texto: `${mensajeSubida(causa, 'sincronizar').titulo}. Detalle: ${detalleTecnico(e)}`, ok: false })
    } finally {
      setSincronizando(false)
    }
  }, [online, pendientes, sync, recargar, sincronizando])

  useEffect(() => {
    void (async () => {
      const d = await obtenerEvaluacion(evaluacionId)
      if (d) {
        setDetalle(d)
        setEstado('ok')
      } else {
        setEstado('error')
      }
    })()
  }, [evaluacionId])

  const estadoEval = detalle?.evaluacion.estado

  useEffect(() => {
    if (estadoEval !== 'ACTIVA') return
    const channel = supabase
      .channel(`ev-vivo-${evaluacionId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'respuestas', filter: `evaluacion_id=eq.${evaluacionId}` },
        () => void recargar()
      )
      .subscribe()
    const iv = window.setInterval(() => void recargar(), 15000)
    return () => {
      void supabase.removeChannel(channel)
      window.clearInterval(iv)
    }
  }, [evaluacionId, estadoEval, recargar])

  if (estado === 'cargando') {
    return (
      <div className="space-y-4">
        <div className="space-y-2">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-4 w-80" />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <div className="space-y-4 py-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-16 w-full" />
            </div>
          </Card>
          <Card>
            <div className="space-y-4 py-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-24 w-full" />
            </div>
          </Card>
        </div>
        <SkeletonTarjetas n={2} cols="sm:grid-cols-2" />
      </div>
    )
  }

  if (estado === 'error' || !detalle) {
    return (
      <div className="min-h-screen bg-slate-50 p-4">
        <div className="rounded-2xl border border-slate-200 bg-white py-12 text-center text-slate-500">
          <p className="font-bold text-slate-700">Evaluación no disponible</p>
          <p className="mt-1 text-sm">No tienes permiso para verla o no existe.</p>
          <Button variant="secondary" className="mt-4" onClick={() => navigate(-1)}><ArrowLeft className="h-4 w-4" /> Volver</Button>
        </div>
      </div>
    )
  }

  const { evaluacion, respuestas, items, modulos, fotos, sucursalOpciones, instancias } = detalle
  const { puntaje } = resumirEvaluacion(evaluacion, respuestas, items, sucursalOpciones)
  const est = estadoBadge(puntaje)
  const aplicaOpciones = opcionesQueAplican(evaluacion.sucursal_id, sucursalOpciones)
  const aplicarOpciones = (item: Item) => {
    if (item.tipo !== 'CHECKLIST' || !item.opciones?.length) return item
    const ids = aplicaOpciones.get(item.id)
    if (!ids?.length) return item
    return { ...item, opciones: item.opciones.filter((o) => ids.includes(o.id)) }
  }

  const incumplimientos = new Map<string, number>()
  for (const r of respuestas) {
    const it = items.find((i) => i.id === r.item_id)
    if (!it) continue
    for (const a of incumplimientosPorResponsable(aplicarOpciones(it), r.valor)) {
      incumplimientos.set(a.responsable, (incumplimientos.get(a.responsable) ?? 0) + a.puntos)
    }
  }

  // Ítems con respuesta real por evaluador (mismo criterio que los contadores de
  // avance: una respuesta vacía no cuenta) para ver cuánto subió cada uno.
  const porEvaluador = new Map<string, number>()
  for (const r of respuestas) {
    if (!r.respondido_por) continue
    const it = items.find((i) => i.id === r.item_id)
    if (!it || !tieneRespuesta(it, r.valor)) continue
    porEvaluador.set(r.respondido_por, (porEvaluador.get(r.respondido_por) ?? 0) + 1)
  }
  // Puntaje por responsable: cada ítem reparte su peso entre quienes participan en él
  // (peso ÷ nº de responsables); el % de cada responsable = logrado / posible.
  const valoresResp = valorPorResponsable(items.map(aplicarOpciones), respuestas)

  /**
   * Veredicto de cada fila que se pinta (ítem + registro), que es lo que el filtro
   * decide mostrar. La clave es la misma que usa `respuestaDe`, así que el filtro
   * no puede mostrar una fila que no se está pintando ni al revés.
   *
   * Se guarda solo la PRIMERA respuesta por clave porque el render también toma la
   * primera: si se contaran todas, el contador del módulo y el "N de M" no
   * coincidirían con las filas en pantalla.
   */
  const veredictoFila = new Map<string, { modulo_id: string; veredicto: VeredictoItem }>()
  const filaVistas = new Set<string>()
  for (const r of respuestas) {
    const it = items.find((i) => i.id === r.item_id)
    if (!it || it.tipo === 'CONTENEDOR') continue
    const clave = claveFila(r.item_id, r.instancia_id)
    if (filaVistas.has(clave)) continue
    filaVistas.add(clave)
    veredictoFila.set(clave, { modulo_id: it.modulo_id, veredicto: veredictoItem(aplicarOpciones(it), r.valor) })
  }
  const conteo: Record<VeredictoItem, number> = { cumple: 0, 'no-cumple': 0, 'no-aplica': 0, 'sin-veredicto': 0 }
  for (const f of veredictoFila.values()) conteo[f.veredicto]++

  /** ¿Esta fila entra en pantalla con el filtro actual? */
  const pasaFiltro = (v: VeredictoItem): boolean => {
    if (v === 'no-aplica') return false
    if (v === 'sin-veredicto') return false
    return filtro === 'ambos' || filtro === v
  }
  const visible = (itemId: string, instId?: string | null): boolean => {
    const f = veredictoFila.get(claveFila(itemId, instId))
    return f ? pasaFiltro(f.veredicto) : false
  }

  const descargar = async () => {
    setError('')
    setDescargando(true)
    try {
      await descargarInformePdf(evaluacion.id, filtro)
    } catch (error) {
      setError(`No se pudo descargar el PDF: ${detalleTecnico(error)}`)
    } finally {
      setDescargando(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-100 pb-10">
      <header className="sticky top-0 z-30 bg-primary text-white shadow-sm">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3 lg:max-w-7xl lg:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <button onClick={() => navigate(-1)} className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/10 hover:bg-white/20" title="Volver">
              <ArrowLeft className="h-4 w-4" />
            </button>
            <h1 className="truncate text-base font-extrabold">Detalle de evaluación</h1>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => void sincronizar()}
              disabled={sincronizando}
              title="Sincronizar: sube lo pendiente y recarga los datos"
              aria-label="Sincronizar evaluación"
              className="relative grid h-9 w-9 place-items-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 disabled:opacity-60"
            >
              <RefreshCw className={cn('h-4 w-4', sincronizando && 'animate-spin')} />
              {pendientes > 0 && !sincronizando ? (
                <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-amber-400 px-1 text-[10px] font-black text-amber-950">
                  {pendientes}
                </span>
              ) : null}
            </button>
            <Button
              variant="secondary"
              className="min-h-0 gap-1.5 bg-white/10 px-3 py-1.5 text-white hover:bg-white/20"
              disabled={descargando}
              onClick={() => void descargar()}
            >
              {descargando ? <Spinner size={16} /> : <FileDown className="h-4 w-4" />}
              {descargando ? 'Generando PDF…' : 'Descargar PDF'}
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-4 lg:max-w-7xl lg:grid lg:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] lg:items-start lg:gap-5 lg:px-6 lg:py-6 xl:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_10rem]">
        {/*
          En escritorio el detalle separa el contexto, las respuestas y el índice de
          módulos en tres columnas. En el teléfono todo fluye en una sola columna.
        */}
        <div className="space-y-4 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:space-y-5 lg:overflow-y-auto">
          {error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
          ) : null}
          {aviso ? (
            <div
              className={cn(
                'flex items-start gap-2 rounded-xl border px-3 py-2 text-sm',
                aviso.ok ? 'border-green-200 bg-green-50 text-green-800' : 'border-amber-200 bg-amber-50 text-amber-800'
              )}
            >
              {aviso.ok ? <Check className="mt-0.5 h-4 w-4 shrink-0" /> : <X className="mt-0.5 h-4 w-4 shrink-0" />}
              <span className="min-w-0 flex-1">{aviso.texto}</span>
              <button
                type="button"
                onClick={() => setAviso(null)}
                aria-label="Cerrar aviso"
                className={cn('shrink-0 hover:text-green-900', aviso.ok ? 'text-green-700' : 'text-amber-700')}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : null}

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-lg font-extrabold text-primary-900">{evaluacion.sucursal?.nombre ?? 'Sucursal'}</p>
                <p className="text-sm text-slate-500">
                  {[evaluacion.sucursal?.shop_id ? `Nº tienda ${evaluacion.sucursal.shop_id}` : '', evaluacion.sucursal?.direccion ?? ''].filter(Boolean).join(' · ') || 'Sin datos de tienda'}
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  {new Date(`${evaluacion.fecha}T12:00:00`).toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · {evaluacion.aperturador?.nombre ?? '—'}
                </p>
              </div>
              <div className="text-right">
                <Puntaje value={puntaje} />
                <div className="mt-1">
                  <Badge color={est.color}>{est.texto}</Badge>
                </div>
              </div>
            </div>
            {evaluacion.estado === 'ACTIVA' ? (
              <p className="mt-2 inline-flex items-center gap-2 rounded-full bg-green-50 px-3 py-1 text-[11px] font-bold text-green-700">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-green-600" />
                </span>
                EN VIVO · {respuestas.length} respuesta(s) registradas hasta ahora
              </p>
            ) : null}
            {evaluacion.comentario_general ? (
              <div className="mt-3 rounded-xl bg-amber-50 px-3 py-2">
                <p className="text-xs font-bold text-amber-700">Comentario general</p>
                <p className="text-sm text-amber-900">{evaluacion.comentario_general}</p>
              </div>
            ) : null}
          </section>

          <IncidenciasEvaluacion evaluacionId={evaluacion.id} />

          {porEvaluador.size ? (
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="font-bold text-primary-900">Avance por evaluador</p>
              <p className="mb-3 text-xs text-slate-400">
                Última vez que cada uno logró subir su avance a la nube. En rojo o sin marca puede tener el avance
                todavía solo en su teléfono.
              </p>
              <ul className="space-y-1.5">
                {[...porEvaluador.entries()]
                  .sort((a, b) => b[1] - a[1])
                  .map(([id, n]) => (
                    <li key={id} className="flex items-center justify-between gap-3 border-b border-slate-100 pb-2 last:border-0 last:pb-0">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-700">{evaluadores[id]?.nombre || 'Evaluador'}</p>
                        <p className="text-xs text-slate-400">
                          {n} ítem{n !== 1 ? 's' : ''} con respuesta
                        </p>
                      </div>
                      <UltimaSync ultimaSync={evaluadores[id]?.ultima_sync} />
                    </li>
                  ))}
              </ul>
            </section>
          ) : null}

          {valoresResp.length ? (
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="font-bold text-primary-900">Puntaje por responsable</p>
              <p className="mb-3 text-xs text-slate-400">Cada ítem reparte su valor entre quienes participan en él (peso ÷ nº de responsables del ítem). El % de cada responsable = logrado ÷ posible.</p>
              <div className="space-y-1.5">
                {valoresResp.map((v) => {
                  const fallas = incumplimientos.get(v.responsable) ?? 0
                  const nivel = v.porciento == null
                    ? 'bg-slate-100 text-slate-500'
                    : v.porciento >= 80
                      ? 'bg-green-50 text-green-700'
                      : v.porciento >= 50
                        ? 'bg-amber-50 text-amber-700'
                        : 'bg-red-50 text-red-600'
                  return (
                    <div key={v.responsable} className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2 last:border-0 last:pb-0">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-700">{v.responsable}</p>
                        <p className="text-xs text-slate-400">
                          <strong className="tabular-nums text-slate-600">{fmt(v.logrado)}</strong> / {fmt(v.posible)} pts
                          {fallas ? ` · ${fallas} falla${fallas !== 1 ? 's' : ''}` : ''}
                        </p>
                      </div>
                      <span className={cn('shrink-0 rounded-full px-2.5 py-0.5 text-sm font-bold tabular-nums', nivel)}>
                        {v.porciento == null ? '—' : `${v.porciento}%`}
                      </span>
                    </div>
                  )
                })}
              </div>
            </section>
          ) : null}
        </div>

        <div className="min-w-0 space-y-4 pt-4 lg:col-start-2 lg:row-start-1 lg:space-y-5 lg:pt-0">
          <FiltroCumplimiento
            filtro={filtro}
            onFiltro={setFiltro}
            conteo={conteo}
          />

          {modulos.map((m) => {
            const itemMod = itemsEnOrdenJerarquico(items.filter((i) => i.modulo_id === m.id))
            const respDe = (id: string, insId?: string | null) =>
              respuestas.find((r) => r.item_id === id && (r.instancia_id ?? null) === (insId ?? null))
            const raices = raicesDeModulo(itemMod)
            const instanciasDe = (itemId: string) =>
              instancias.filter((x) => x.item_id === itemId).sort((a, b) => a.orden - b.orden)
            const filaRespuesta = (item: Item, res: (typeof respuestas)[number]) => {
              const veredicto = veredictoFila.get(claveFila(item.id, res.instancia_id))?.veredicto
              if (!veredicto || !pasaFiltro(veredicto)) return null
              const fotosItem = fotos.filter(
                (f) => f.item_id === item.id && (f.instancia_id ?? null) === (res.instancia_id ?? null)
              )
              const pathsGuardados = item.tipo === 'CUMPLE_NO_CUMPLE'
                ? pathsEvidenciaCumple(res.valor)
                : item.tipo === 'CHECKLIST'
                  ? pathsEvidenciaChecklist(res.valor)
                  : []
              const fotosDeValor: Foto[] = pathsGuardados
                .map((path) => ({
                    id: path,
                    evaluacion_id: evaluacion.id,
                    item_id: item.id,
                    instancia_id: res.instancia_id ?? null,
                    path,
                    created_at: res.created_at
                  }))
              const pathsRegistrados = new Set(fotosItem.map((foto) => foto.path))
              const fotosRespuesta = [
                ...fotosItem,
                ...fotosDeValor.filter((foto) => !pathsRegistrados.has(foto.path))
              ]
              return (
                <div key={`${res.item_id}-${res.instancia_id ?? ''}-${res.id}`} className="space-y-3 px-5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="min-w-0 text-sm font-semibold leading-snug text-slate-700">{item.texto}</p>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {veredicto === 'cumple' ? (
                        <Badge color={2}>Completo</Badge>
                      ) : veredicto === 'no-cumple' ? (
                        <Badge color={4}>Incompleto</Badge>
                      ) : (
                        <Badge color={0}>Sin veredicto</Badge>
                      )}
                      <Badge color={0}>{etiquetaTipo(item.tipo)}</Badge>
                    </div>
                  </div>
                  <ValorRespuesta item={item} valor={res.valor} soloIncumplimientos={filtro === 'no-cumple'} />
                  {item.tipo !== 'CHECKLIST' ? <Fotogaleria fotos={fotosRespuesta} /> : null}
                </div>
              )
            }
            const vals = respuestas
              .filter((r) => itemMod.some((i) => i.id === r.item_id))
              .map((r) => ({ item: itemMod.find((i) => i.id === r.item_id), valor: r.valor }))
              .filter((x): x is { item: Item; valor: unknown } => !!x.item)
            const { ok, total } = itemsProporcion(vals.map((v) => ({ item: aplicarOpciones(v.item), valor: v.valor })))
            const punteo = total ? Math.round((ok / total) * 10000) / 100 : null
            // Cuántas filas del módulo quedan en pantalla con el filtro actual. El
            // puntaje del módulo NO se recalcula: es el del módulo entero, y bajarlo
            // con el filtro haría creer que el filtro cambió la evaluación.
            const propias = [...veredictoFila.entries()].filter(([, f]) => f.modulo_id === m.id)
            const visibles = propias.filter(([, f]) => pasaFiltro(f.veredicto)).length
            const ocultas = propias.length - visibles
            return (
              <section id={`modulo-${m.id}`} key={m.id} className="scroll-mt-24 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-5 py-3.5">
                  <p className="font-bold text-primary-900">{m.nombre}</p>
                  <p className="text-xs font-semibold text-slate-500">
                    {punteo != null ? `${punteo}%${total ? ` (${fmt(ok)}/${total})` : ''}` : 'Sin puntuable'}
                    {ocultas > 0 ? ` · ${visibles} de ${propias.length} ítems` : ''}
                  </p>
                </div>
                {/* Módulo sin nada que mostrar en este filtro: se lo dice en vez de
                    dejar una cabecera pelada que parece un módulo vacío. */}
                {visibles === 0 && ocultas > 0 ? (
                  <p className="px-5 py-4 text-sm text-slate-400">
                    Este módulo no tiene ítems en el filtro actual.
                  </p>
                ) : (
                  <div className="divide-y divide-slate-100">
                  {raices.map((item) => {
                    if (item.tipo === 'CONTENEDOR') {
                      const insts = instanciasDe(item.id)
                      const hijos = hijosOrdenados(itemMod, item.id)
                      // Un registro cuyas respuestas quedaron todas afuera no se
                      // pinta, y se conserva su número original para que "Registro 3"
                      // siga siendo el tercero y no parezca el primero.
                      const instsVisibles = insts
                        .map((inst, i) => ({ inst, numero: i + 1 }))
                        .filter(({ inst }) => hijos.some((hijo) => visible(hijo.id, inst.id)))
                      if (!instsVisibles.length && ocultas > 0) return null
                      return (
                        <Fragment key={item.id}>
                          <div className="flex items-center gap-2 bg-primary-50 px-5 py-3">
                            <FolderOpen className="h-4 w-4 shrink-0 text-primary" />
                            <p className="text-sm font-bold text-primary-900">{item.texto}</p>
                            <span className="ml-auto text-[11px] font-semibold text-slate-500">
                              {insts.length} registro(s) · {hijos.length} ítem(s) c/u
                            </span>
                          </div>
                          {instsVisibles.map(({ inst, numero }) => (
                            <Fragment key={inst.id}>
                              <div className="flex items-center gap-2 border-t border-primary-100 bg-primary-50/60 px-5 py-2">
                                <Tag className="h-3.5 w-3.5 shrink-0 text-primary" />
                                <p className="truncate text-xs font-bold text-primary-900">
                                  Registro {numero} · {inst.etiqueta}
                                </p>
                              </div>
                              {item.api_id && inst.datos && Object.keys(inst.datos).length ? (
                                <div className="flex flex-wrap gap-1.5 bg-primary-50/40 px-5 pb-2.5">
                                  {Object.entries(inst.datos)
                                    .filter(([, v]) => v != null && v !== '')
                                    .map(([k, v]) => (
                                      <span key={k} className="rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-semibold text-primary-800">
                                        {etiquetaDeCampo(item.api_id, k)}:{' '}
                                        {k === 'color' && esColorHex(v) ? (
                                          <span className="ml-0.5 inline-block h-3.5 w-3.5 align-[-0.15em] rounded-full border border-slate-300" style={{ backgroundColor: v }} title={v} aria-label={`Color ${v}`} />
                                        ) : formatearValorConsulta(v)}
                                      </span>
                                    ))}
                                </div>
                              ) : null}
                              {hijos.map((hijo) => {
                                const res = respDe(hijo.id, inst.id)
                                if (!res) return null
                                return filaRespuesta(hijo, res)
                              })}
                            </Fragment>
                          ))}
                        </Fragment>
                      )
                    }
                    const res = respDe(item.id, null)
                    if (!res) return null
                    return filaRespuesta(item, res)
                  })}
                  </div>
                )}
              </section>
            )
          })}
        </div>

        {modulos.length > 0 ? (
          <aside className="hidden xl:col-start-3 xl:row-start-1 xl:block">
            <nav
              aria-label="Índice de módulos"
              className="fixed top-20 z-20 hidden max-h-[calc(100vh-6rem)] w-40 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-3 shadow-sm xl:block"
              style={{ right: 'max(1.5rem, calc((100vw - 80rem) / 2 + 1.5rem))' }}
            >
              <p className="mb-2 px-2 text-xs font-extrabold uppercase tracking-wide text-slate-500">Módulos</p>
              <ol className="space-y-1">
                {modulos.map((modulo, index) => (
                  <li key={modulo.id}>
                    <a
                      href={`#modulo-${modulo.id}`}
                      aria-current={moduloActivoId === modulo.id ? 'location' : undefined}
                      onClick={() => setModuloActivoId(modulo.id)}
                      className={cn(
                        'flex items-start gap-2 rounded-lg px-2 py-2 text-sm font-semibold transition-colors',
                        moduloActivoId === modulo.id
                          ? 'bg-primary-100 text-primary-900 ring-1 ring-primary-300'
                          : 'text-slate-600 hover:bg-primary-50 hover:text-primary-900'
                      )}
                    >
                      <span className={cn(
                        'shrink-0 text-xs tabular-nums',
                        moduloActivoId === modulo.id ? 'text-primary-800' : 'text-slate-400'
                      )}>{index + 1}.</span>
                      <span className="min-w-0 break-words">{modulo.nombre}</span>
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          </aside>
        ) : null}
      </main>
    </div>
  )
}

/**
 * Selector de cumplimiento del detalle. Los tres botones llevan su cuenta para que
 * se sepa cuántos ítems hay de cada clase antes de filtrar, que es justo lo que
 * uno viene a ver.
 *
 * Las respuestas "No aplica" y las que todavía no tienen veredicto quedan fuera
 * de los filtros de cumplimiento.
 */
export function FiltroCumplimiento({
  filtro,
  onFiltro,
  conteo,
}: {
  filtro: 'ambos' | 'cumple' | 'no-cumple'
  onFiltro: (f: 'ambos' | 'cumple' | 'no-cumple') => void
  conteo: Record<VeredictoItem, number>
}) {
  const opciones: { id: 'ambos' | 'cumple' | 'no-cumple'; texto: string; n: number }[] = [
    { id: 'ambos', texto: 'Ambos', n: conteo.cumple + conteo['no-cumple'] },
    { id: 'cumple', texto: 'Cumple', n: conteo.cumple },
    { id: 'no-cumple', texto: 'No cumple', n: conteo['no-cumple'] }
  ]
  return (
    // En escritorio queda fijo arriba: al revisar veinte ítems no se va a tener que
    // subir a cambiar el filtro. En el teléfono fluye, porque ahí sí estorba.
    <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm lg:sticky lg:top-20 lg:z-20 lg:bg-white/95 lg:backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="Filtrar los ítems por cumplimiento" className="inline-flex rounded-full bg-slate-100 p-1">
          {opciones.map((o) => (
            <button
              key={o.id}
              type="button"
              aria-pressed={filtro === o.id}
              onClick={() => onFiltro(o.id)}
              className={cn(
                'rounded-full px-3.5 py-1.5 text-xs font-bold transition-colors',
                filtro === o.id ? 'bg-white text-primary-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              )}
            >
              {o.texto}
              <span className="ml-1.5 tabular-nums opacity-70">{o.n}</span>
            </button>
          ))}
        </div>
      </div>
      <p className="mt-2 text-[11px] leading-snug text-slate-400">
        {filtro === 'cumple'
          ? 'Solo los ítems que llegaron al 100%: todo lo que puntúa quedó validado.'
          : filtro === 'no-cumple'
            ? 'Solo los ítems que tienen algo pendiente. En los ítems con checklist, lo pendiente es lo que no está tildado.'
            : 'Todos los ítems con respuesta, en el orden del módulo. Las respuestas “No aplica” no se muestran.'}
      </p>
    </div>
  )
}

function EstadoColaborador({ aplica, cumple, sinPuntosAplicables }: { aplica: boolean; cumple: boolean; sinPuntosAplicables?: boolean }) {
  if (!aplica) return <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-bold text-slate-500">No aplica</span>
  if (sinPuntosAplicables) return <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-bold text-slate-600">Sin puntos aplicables</span>
  return <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-bold', cumple ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700')}>{cumple ? 'Completo' : 'Incompleto'}</span>
}
