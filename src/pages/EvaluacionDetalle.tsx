import { useCallback, useEffect, useState, Fragment, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Check, ChevronRight, FileDown, FolderOpen, Pencil, RefreshCw, Tag, X } from 'lucide-react'
import { useOffline } from '../context/OfflineContext'
import { useAuth } from '../context/AuthContext'
import { obtenerEvaluacion, resumirEvaluacion, puntajeModuloDeRespuestas, type DetalleEvaluacion } from '../lib/data/indicadores'
import { cargosDelCentro, centroDisponible, separacionDisponible, useCargosPorCentro, type CatalogosCentro, type CentroOperaciones } from '../lib/data/cargosCentro'
import { descargarInformePdf } from '../lib/pdf'
import type { OpcionesPdf } from '../lib/pdf/opciones'
import { supabase } from '../lib/supabase'
import { itemsEnOrdenJerarquico, hijosOrdenados } from '../lib/hierarchy'
import { raicesDeModulo } from '../lib/pasos'
import { causaSubida, detalleTecnico, mensajeSubida } from '../lib/subida'
import { fallasDeResponsable, etiquetaTipo, itemsProporcion, conciliacionTotal, conciliacionComparable, agruparPorDepartamento, esSinHablador, productosParaConciliar, totalesConciliacion, formatearMontoPerdida, colaboradorCumple, colaboradoresQueCuentan, esColaboradorRevisado, opcionesAplicablesColaborador, opcionCumplida, responsablesDeOpcion, unidadCumple, valorPorResponsable, veredictoItem, formatearLastSync, formatearPrecioBase, montoSobranteConciliacion, perdidaGuardadaConciliacion, resumenPerdidaConciliacion, type ValorConciliacion, type ValorCumple, type ValorChecklist, type ValorListaColaboradores, type ValorUnidadChecklist, type VeredictoItem, type FallaResponsable } from '../lib/scoring'
import { esColorHex, etiquetaDeCampo, formatearValorConsulta } from '../lib/data/apis'
import type { Foto, Item, Opcion, SucursalOpcion } from '../lib/types'
import { Badge, Button, Card, InfoTooltip, Modal, ProgressBar, Skeleton, cn, colorFondoBadge } from '../components/ui'

import { IncidenciasEvaluacion, ListaIncidencias, incidenciaEsDeCargo, useIncidenciasEvaluacion } from '../components/IncidenciasEvaluacion'
import { SelectorPdf } from '../components/SelectorPdf'
import { Fotogaleria, FotogaleriaRutas } from '../components/dashboard/Fotogaleria'
import { PlanoLectura } from '../components/PlanoEditor'
import { pathsEvidenciaChecklist, pathsEvidenciaConciliacion, pathsEvidenciaCumple, pathsEvidenciaOpcion, pathsEvidenciaProducto } from '../lib/evidencias'
import { IconoModulo } from '../components/IconoModulo'
import { ordenarTrabajadores } from '../lib/data/colaboradores'

/** Desde acá arranca el "Cumple". Vive acá y no junto al badge para que el color del
 *  número, la etiqueta y el texto de "faltan N" no puedan quedar con umbrales
 *  distintos: son tres lecturas del mismo veredicto y se contradicen en pantalla. */
const UMBRAL_CUMPLE = 80

/**
 * El veredicto del puntaje. Solo devuelve el índice de la paleta y el texto: el
 * color del número grande lo saca `colorFondoBadge` del MISMO índice, así que el
 * número y su etiqueta no pueden quedar de distinto color el día que se cambie un
 * tono de la paleta.
 *
 * Sin puntaje es `0` (gris) y no `4` (rojo) como antes: que falte el número no es
 * una falla de la sucursal, es una visita que todavía no se cerró.
 */
function estadoBadge(puntaje: number | null): { texto: string; color: number } {
  if (puntaje == null) return { texto: 'Sin puntaje', color: 0 }
  if (puntaje >= UMBRAL_CUMPLE) return { texto: 'Cumple', color: 2 }
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
      const cols = ordenarTrabajadores(v?.colaboradores ?? [])
      if (!cols.length) return <p className="text-sm text-slate-400">Sin trabajadores</p>
      const opts = (item.opciones ?? []) as Opcion[]
      // Igual que en el scoring: solo los trabajadores revisados entran en la
      // evaluación. Los que quedaron destildados sin tocar se listan aparte para
      // que se vea que faltaron, sin que parezcan incumplimientos.
      const enCuenta = cols.filter((c) => c.aplica)
      const enPuntaje = colaboradoresQueCuentan(cols)
      const conChecksAplicables = enPuntaje.filter((c) => opcionesAplicablesColaborador(c, opts).length > 0)
      const cumplen = conChecksAplicables.filter((c) => colaboradorCumple(c, opts)).length
      const sinRevisar = enCuenta.length - enPuntaje.length
      const colaboradoresVisibles = cols.filter((c) => {
        if (!c.aplica) return false
        if (soloIncumplimientos) {
          const checks = opcionesAplicablesColaborador(c, opts)
          return esColaboradorRevisado(c) && checks.length > 0 && !colaboradorCumple(c, opts)
        }
        return true
      })
      return (
        <div className="space-y-3">
          {v?.informativo ? (
            <p className="text-xs font-bold text-amber-700">No aplica · se excluye del puntaje</p>
          ) : null}
          <p className="text-sm font-semibold text-slate-700">
            {soloIncumplimientos
              ? `${colaboradoresVisibles.length} trabajador${colaboradoresVisibles.length === 1 ? '' : 'es'} con incumplimientos`
              : <>
                  {enPuntaje.length} trabajador{enPuntaje.length === 1 ? '' : 'es'} en cuenta · {cumplen}/{conChecksAplicables.length} completos
                  {sinRevisar ? ` · ${sinRevisar} sin revisar (no suman al puntaje)` : ''}
                  {enCuenta.length > enPuntaje.length + sinRevisar ? ` · ${enCuenta.length - enPuntaje.length - sinRevisar} sin puntos aplicables` : ''}
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
                      {c.lastname} {c.name}
                      <span className="ml-1.5 text-xs font-normal text-slate-500">C.I. {c.nationality ?? ''}{c.dni} · {c.role_name || 'Sin rol'}</span>
                    </span>
                    <span className="shrink-0">
                      <EstadoColaborador aplica={c.aplica} cumple={cumple} sinPuntosAplicables={c.aplica && checksAplicables.length === 0} revisado={esColaboradorRevisado(c)} />
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
      // El número con el que se compara y se muestra sale de acá, una sola vez:
      // en una conciliación por precio, lo que manda es el valor con dos
      // decimales que se ve en la fila, no el float que vino del sistema.
      const contraDato = item.contra_dato ?? 'SOH'
      const ps = productosParaConciliar(v?.productos, contraDato)
      if (!ps.length) return <p className="text-sm text-slate-400">Sin productos</p>
      const total = conciliacionTotal(v)
      // La columna del contra dato sigue la configuración del ítem, que es el mismo
      // número que el evaluador tenía delante mientras escaneaba.
      const esPrecio = item.contra_dato === 'FINAL_BASE'
      const filas = ps.map((p, i) => {
        const teorica = typeof p.teorica === 'number' ? p.teorica : null
        const fisica = typeof p.fisica === 'number' ? p.fisica : null
        const comparable = conciliacionComparable(p)
        const sinHablador = esSinHablador(p)
        const perdida = perdidaGuardadaConciliacion(p, contraDato)
        const montoSobrante = montoSobranteConciliacion(p, contraDato)
        const variacion = comparable
          ? {
              cantidad: Math.abs(p.fisica - p.teorica),
              // El signo y no "sobran 3": el color del distintivo ya dice de qué
              // lado se fue, y con la palabra el número quedaba empujado al
              // borde de una columna que a lo que da es otro número.
              signo: p.fisica > p.teorica ? '+' : '-'
            }
          : null
        return { p, indice: i, teorica, fisica, comparable, sinHablador, variacion, perdida, montoSobrante, descuadra: sinHablador || (comparable && p.fisica !== p.teorica) }
      })
      const descuadrados = filas.filter((f) => f.descuadra).length
      const filaDe = new Map(ps.map((p, i) => [p, filas[i]]))
      // Se muestran agrupadas por departamento, porque el conteo se hace en la
      // góndola y las filas tienen que seguir el recorrido de los pasillos. Dentro
      // de cada grupo el orden de lectura sigue siendo por gravedad (primero lo
      // que más falta), y es el mismo que usa el PDF.
      const candidatos = soloIncumplimientos ? filas.filter((f) => f.descuadra).map((f) => f.p) : ps
      const grupos = agruparPorDepartamento(candidatos, contraDato)
        .map((grupo) => ({
          ...grupo,
          filas: grupo.productos.map((p) => filaDe.get(p)!),
          // Cuánta plata se fue en ese pasillo. Sale de la misma función que arma
          // la pérdida estimada del pie, pero aplicada solo a los productos del
          // grupo: como el descarte es por producto (los que sobran no aportan), la
          // suma de los rótulos da exactamente el total del pie.
          //
          // En conciliación por precio esto queda en 0, porque ahí la diferencia
          // son unidades y no plata. No hace falta un modo especial: lo decide la
          // misma función.
          perdida: resumenPerdidaConciliacion(grupo.productos, contraDato).monto
        }))
        .filter((grupo) => grupo.filas.length)
      const resumenPerdida = resumenPerdidaConciliacion(ps, contraDato)
      const totales = totalesConciliacion(ps)
      // Desglose por SKU para la vista completa: cuántos escaneados, cuántos con
      // faltante y cuántos con sobrante. El porcentaje va sobre el total escaneado
      // (igual que la tasa de descuadre a la que reemplaza): faltantes + sobrantes
      // cuadran con los descuadrados salvo los marcados "sin hablador".
      const skuFaltantes = filas.filter((f) => f.variacion?.signo === '-').length
      const skuSobrantes = filas.filter((f) => f.variacion?.signo === '+').length
      const pctFaltantes = filas.length ? Math.round((skuFaltantes / filas.length) * 100) : 0
      const pctSobrantes = filas.length ? Math.round((skuSobrantes / filas.length) * 100) : 0
      // Las fotos de evidencia están casadas a cada producto escaneado: la lista
      // es por SKU, no un bloque general donde no se sabría de qué evidencia se
      // trata. Solo las que se subieron (paths del bucket).
      const evidencias = ps
        .map((producto) => ({ producto, paths: pathsEvidenciaProducto(producto) }))
        .filter((e) => e.paths.length > 0)
      return (
        <div className="space-y-3">
          {v?.informativo ? (
            <p className="text-xs font-bold text-amber-700">No aplica · se excluye del puntaje</p>
          ) : null}
          <div className="rounded-xl border border-slate-200">
            <table className="w-full table-fixed text-xs sm:text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500">
                  <th scope="col" className="w-[22%] break-words px-1 py-2 font-bold sm:px-2">SKU</th>
                  <th scope="col" className="w-[18%] break-words px-1 py-2 font-bold sm:px-2">Producto</th>
                  <th scope="col" className="w-[10%] break-words px-1 py-2 text-right font-bold sm:px-2">{esPrecio ? 'Sistema' : 'Teórica'}</th>
                  <th scope="col" className="w-[10%] break-words px-1 py-2 text-right font-bold sm:px-2">{esPrecio ? 'Hablador' : 'Física'}</th>
                  {/* La columna es la misma en las dos conciliaciones y se llama igual: solo la
                      fecha del último sync. En precio el precio base ya no va
                      acá: queda como dato de referencia del cálculo de la pérdida
                      y no de esta fila. */}
                  <th scope="col" className="w-[16%] break-words px-1 py-2 font-bold sm:px-2">Sync</th>
                  <th scope="col" className="w-[22%] break-words px-1.5 py-2 text-right font-bold sm:px-2">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {/* Un solo recorrido: primero el rótulo del departamento y
                    enseguida sus productos. Tiene que ser así porque el conteo se
                    hace recorriendo la góndola y el evaluador necesita saber en qué
                    pasillo está cada fila.

                    Antes el rótulo y las filas iban en dos bucles separados (los
                    rótulos primero, y después todas las filas aplanadas con
                    flatMap), así que los nueve rótulos salían en bloque arriba y
                    los productos perdían el grupo.

                    El rótulo solo se muestra si hay más de un grupo: con uno solo
                    sería ruido. */}
                {grupos.map((grupo) => (
                  <Fragment key={`dep-${grupo.departamento ?? ''}`}>
                    {grupos.length > 1 ? (
                      <tr className="bg-slate-100/80">
                        <td colSpan={6} className="px-1.5 py-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-600 sm:px-2">
                          {grupo.departamento ?? 'Sin departamento'}
                          <span className="ml-1 font-medium normal-case tracking-normal text-slate-400">
                            ({grupo.filas.length})
                          </span>
                          {/* La plata perdida en ese departamento, junto al nombre
                              para no tener que sumar los renglones de abajo. Solo
                              cuando hay pérdida: un grupo que concilia con 0 solo
                              metería ruido. */}
                          {grupo.perdida > 0 ? (
                            <span className="ml-2 font-bold normal-case tracking-normal text-red-700">
                              Pérdida {formatearPrecioBase(grupo.perdida)}
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    ) : null}
                    {grupo.filas.map(({ p, indice, teorica, fisica, comparable, sinHablador, variacion, perdida, montoSobrante, descuadra }) => (
                      <tr
                        key={`${p.sku}-${indice}`}
                        className={cn(
                          descuadra && (fisica! > teorica! ? 'bg-amber-50/70' : 'bg-red-50/50')
                        )}
                      >
                        <td
                          className="overflow-hidden text-ellipsis whitespace-nowrap px-1 py-2 text-[11px] font-medium tabular-nums text-slate-800 sm:px-2"
                          title={p.sku}
                        >
                          {p.sku || '—'}
                        </td>
                        <td className="break-words px-1.5 py-2 text-slate-600 sm:px-2">
                          {p.nombre || '—'}
                          {/* El id del producto en la API y quién lo midió primero:
                              los dos datos con los que se cruza la fila contra el
                              sistema y contra quien la contó (el sku es solo el
                              código escaneado). */}
                          {p.apiId != null || p.escaneadoPor ? (
                            <span className="block text-[11px] text-slate-400">
                              {[
                                p.apiId != null ? `ID ${p.apiId}` : null,
                                p.escaneadoPor ? `Contado por ${p.escaneadoPor}` : null
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </span>
                          ) : null}
                        </td>
                        <td className="break-all px-1.5 py-2 text-right tabular-nums text-slate-700 sm:px-2">
                          {esPrecio ? formatearPrecioBase(teorica) : (teorica ?? '—')}
                        </td>
                        <td className="break-all px-1.5 py-2 text-right tabular-nums text-slate-700 sm:px-2">
                          {sinHablador ? (
                            <span className="font-bold text-red-600">Sin hablador</span>
                          ) : esPrecio ? formatearPrecioBase(fisica) : (fisica ?? '—')}
                        </td>
                        <td className="break-words px-1.5 py-2 text-slate-600 sm:px-2">
                          {p.lastSync ? <span className="block text-[11px] text-slate-400">{formatearLastSync(p.lastSync)}</span> : null}
                        </td>
                        <td className="break-words px-1.5 py-2 text-right sm:px-2">
                          {sinHablador ? (
                            <span className="rounded-full px-2 py-0.5 text-[11px] font-bold bg-red-100 text-red-700">No Match</span>
                          ) : !comparable ? (
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-500">Sin datos</span>
                          ) : descuadra ? (
                            <span className={cn(
                              'rounded-full px-2 py-0.5 text-[11px] font-bold',
                              fisica! > teorica! ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-700'
                            )}>
                              {/* El signo de plata va solo cuando la diferencia es plata. En la conciliación
                                de cantidades el número son unidades, y ponerle `$`
                                haría creer que sobraron tres dólares de producto. */}
                              {variacion
                                ? `${variacion.signo}${esPrecio ? formatearPrecioBase(variacion.cantidad) : fmt(variacion.cantidad)}`
                                : ''}
                            </span>
                          ) : (
                            <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-bold text-green-700">Concilia</span>
                          )}
                          {/* La pérdida solo tiene sentido donde algo falta. Con el conteo conciliado
                              la diferencia es cero y el texto era ruido que hacía pensar
                              que ahí también se estaba perdiendo plata. */}
                          {!esPrecio && descuadra && variacion?.signo === '-' ? (
                            <span className="mt-1 block text-[11px] font-semibold text-red-700">
                              Pérdida: {perdida == null ? 'sin precio base' : formatearPrecioBase(perdida)}
                            </span>
                          ) : !esPrecio && descuadra && variacion?.signo === '+' ? (
                            <span className="mt-1 block text-[11px] font-semibold text-amber-700">
                              Sobrante: {montoSobrante == null ? 'sin precio base' : formatearPrecioBase(montoSobrante)}
                            </span>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          {/* La evidencia va después de la tabla, rotulada con su SKU: así se ve
              de qué producto es cada foto. */}
          {evidencias.map(({ producto, paths }) => (
            <div key={producto.sku} className="space-y-1">
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
                Evidencia fotográfica · {producto.sku}
                {producto.nombre ? ` · ${producto.nombre}` : ''}
              </p>
              <FotogaleriaRutas paths={paths} compacta />
            </div>
          ))}
          {esPrecio ? (
            <p className="text-sm text-slate-600">
              {soloIncumplimientos ? `${descuadrados} producto(s) con descuadre` : `${filas.length} producto(s) escaneado(s) · `}
              {!soloIncumplimientos && (descuadrados ? `${descuadrados} con descuadre` : 'todos concilian')}
              {total != null ? ` · tasa de descuadre ${total}%` : ''}
            </p>
          ) : descuadrados > 0 ? (
            <p className="text-sm text-slate-600">
              {filas.length} SKU escaneados | {skuFaltantes} SKU con faltante ({pctFaltantes}%) | {skuSobrantes} SKU con sobrante ({pctSobrantes}%)
            </p>
          ) : soloIncumplimientos ? (
            <p className="text-sm text-slate-600">
              {soloIncumplimientos ? `${descuadrados} producto(s) con descuadre` : `${filas.length} producto(s) escaneado(s) · `}
              {!soloIncumplimientos && (descuadrados ? `${descuadrados} con descuadre` : 'todos concilian')}
              {total != null ? ` · tasa de descuadre ${total}%` : ''}
            </p>
          ) : (
            <p className="text-sm text-slate-600">{filas.length} SKU escaneados · todos concilian</p>
          )}
          {/* Cierre de la conciliación: cada lado en su propia línea, como en el
            PDF. El sobrante va primero, porque es mercadería a buscar y se valora
            al PVP solo para poder sumarla; lo que falta con su plata en rojo; y al
            final la pérdida absoluta (faltantes + sobrantes). El "sin precio base"
            baja aparte, para no romper la cuenta. */}
          {!esPrecio && (resumenPerdida.faltantesConPrecio + resumenPerdida.faltantesSinPrecio > 0 || totales.unidadesFaltantes > 0 || totales.unidadesSobrantes > 0) ? (
            <div className="space-y-1.5">
              {totales.unidadesSobrantes > 0 ? (
                <p className="text-sm font-semibold text-amber-700">
                  {fmt(totales.unidadesSobrantes)} unidades sobrantes
                  {resumenPerdida.sobrantesConPrecio > 0
                    ? ` con un valor estimado de ${formatearMontoPerdida(resumenPerdida.montoSobrantes)}`
                    : ''}
                </p>
              ) : null}
              {totales.unidadesFaltantes > 0 ? (
                <p className="text-sm font-semibold text-red-700">
                  {fmt(totales.unidadesFaltantes)} unidades faltantes
                  {resumenPerdida.monto > 0
                    ? ` con un valor estimado de ${formatearMontoPerdida(resumenPerdida.monto)}`
                    : ''}
                </p>
              ) : resumenPerdida.faltantesConPrecio + resumenPerdida.faltantesSinPrecio > 0 ? (
                <p className="text-sm font-semibold text-red-700">
                  Pérdida estimada {formatearMontoPerdida(resumenPerdida.monto)}
                </p>
              ) : null}
              {resumenPerdida.monto > 0 || resumenPerdida.montoSobrantes > 0 ? (
                <p className="text-sm font-semibold text-red-700">
                  Pérdida absoluta: {formatearMontoPerdida(resumenPerdida.monto + resumenPerdida.montoSobrantes)}
                </p>
              ) : null}
              {resumenPerdida.faltantesSinPrecio + resumenPerdida.sobrantesSinPrecio > 0 ? (
                <p className="text-xs text-slate-400">
                  {resumenPerdida.faltantesSinPrecio + resumenPerdida.sobrantesSinPrecio} producto(s) sin precio base
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      )
    }
    default:
      return <p className="text-sm text-slate-400">Sin respuesta</p>
  }
}

export function SkeletonEvaluacionDetalle() {
  return (
    <div className="min-h-screen bg-slate-100 pb-10">
      <header className="sticky top-0 z-30 bg-primary">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3 lg:max-w-7xl lg:px-6">
          <div className="flex min-w-0 items-center gap-2">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/10">
              <div className="w-4 space-y-1">
                <Skeleton className="h-0.5 w-full bg-white/70" />
                <Skeleton className="h-0.5 w-full bg-white/70" />
                <Skeleton className="h-0.5 w-full bg-white/70" />
              </div>
            </div>
            <Skeleton className="h-4 w-40 bg-white/40" />
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Skeleton className="h-9 w-9 rounded-full bg-white/20" />
            <Skeleton className="hidden h-9 w-32 rounded-full bg-white/20 sm:block" />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-4 py-4 lg:grid lg:max-w-7xl lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)] lg:items-start lg:gap-5 lg:px-6 lg:py-6 xl:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        <div className="space-y-4 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:space-y-5 lg:overflow-y-auto">
          <div className="space-y-2">
            <Skeleton className="h-8 w-56" />
            <Skeleton className="h-4 w-full max-w-80" />
          </div>
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
        <div className="min-w-0 space-y-4 pt-4 lg:col-start-2 lg:row-start-1 lg:space-y-5 lg:pt-0">
          <Card>
            <div className="flex items-start justify-between gap-3 py-2">
              <div className="min-w-0 flex-1 space-y-3">
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-3 w-4/5" />
              </div>
              <Skeleton className="h-10 w-12 shrink-0" />
            </div>
          </Card>
          <Card>
            <div className="relative mb-3 flex items-center gap-3 overflow-hidden py-1 before:absolute before:left-4 before:right-4 before:top-1/2 before:h-px before:-translate-y-1/2 before:bg-slate-300">
              {[0, 1, 2, 3].map((item) => (
                <Skeleton key={item} className="relative z-10 h-8 w-8 shrink-0 rounded-full border-2 border-slate-100" />
              ))}
            </div>
            <div className="space-y-3 py-2">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-8 w-full" />
            </div>
          </Card>
          <Card>
            <div className="space-y-4 py-2">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-4/5" />
            </div>
          </Card>
          <Card>
            <div className="space-y-4 py-2">
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          </Card>
        </div>
      </main>
    </div>
  )
}

export function EvaluacionDetalle() {
  const { evaluacionId = '' } = useParams()
  const navigate = useNavigate()
  const [detalle, setDetalle] = useState<DetalleEvaluacion | null>(null)
  const [estado, setEstado] = useState<'cargando' | 'error' | 'ok'>('cargando')
  const [descargando, setDescargando] = useState(false)
  /** ¿El selector de qué va al PDF está abierto? */
  const [selectorAbierto, setSelectorAbierto] = useState(false)
  const [sincronizando, setSincronizando] = useState(false)
  const [aviso, setAviso] = useState<{ texto: string; ok: boolean } | null>(null)
  const [error, setError] = useState('')
  /** Responsable abierto en el modal de fallas. null = cerrado. */
  const [fallasDe, setFallasDe] = useState<string | null>(null)
  /** ¿El modal de todas las incidencias está abierto? */
  const [incidenciasAbiertas, setIncidenciasAbiertas] = useState(false)
  /**
   * Centro de operaciones whose cargos se están viendo. Arranca en la sucursal
   * evaluada porque es la que se está mirando: la central casi siempre aparece
   * después y con menos gente.
   */
  const [centro, setCentro] = useState<CentroOperaciones>('sucursal')
  const [moduloActivoId, setModuloActivoId] = useState('')
  const [moduloTip, setModuloTip] = useState<{ label: string; top: number; left: number } | null>(null)
  /**
   * Filtro del detalle. El veredicto sale del mismo `proporcionItem` que calcula
   * el puntaje, así que "No cumplido" es exactamente lo que el tablero descuenta:
   * un checklist con un check sin tildar entra acá, y uno completo no.
   */
  const [filtro, setFiltro] = useState<'ambos' | 'cumple' | 'no-cumple'>('ambos')
  const { online, pendientes, sync } = useOffline()
  /** Solo el Líder puede editar (y por lo tanto borrar) productos de conciliación:
   *  es el mismo filtro que ejerce la ruta `/conciliacion` con `SoloLider`. */
  const { profile } = useAuth()
  /**
   * Incidencias: una sola consulta para el botón con el total, el modal de todas
   * y el modal de cada cargo. Va acá arriba y no junto a los cálculos porque los
   * hooks no pueden ir después de un return temprano, y esta pantalla tiene uno
   * mientras carga la evaluación.
   */
  const incidencias = useIncidenciasEvaluacion(detalle?.evaluacion.id ?? null)
  const filasIncidencias = incidencias.filas ?? []
  /** Catálogos de cargos de la sucursal y de la central, para el selector de centros. */
  const catalogosCentro = useCargosPorCentro(detalle?.evaluacion.sucursal?.branch_id ?? null)
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
    /* Antes esto además consultaba los perfiles de quienes respondieron, para la
       tarjeta de "Avance por evaluador". Al irse esa tarjeta, la consulta solo
       sobraba: era un viaje extra a Supabase cada 15 s en vivo para pintar un dato
       que ya nadie miraba. */
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
        if (r.fail) {
          // `r.error` ya viene escrito para quien lo lee (la cola nombró el módulo
          // que bloquea cuando pudo comprobarlo); el conteo solo no dice nada.
          mensaje = { texto: r.error ?? `Se subieron ${r.ok}, pero ${r.fail} no se pudieron guardar.`, ok: false }
        } else if (r.ok) mensaje = { texto: `Se guardaron ${r.ok} evaluación(es) pendiente(s) y se actualizaron los datos.`, ok: true }
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
    return <SkeletonEvaluacionDetalle />
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
  // ¿Hay productos escaneados en algún ítem de conciliación? El detalle es de solo
  // lectura, pero el Líder puede entrar a la vista de edición (que ya sabe borrar
  // con confirmación) si es que hay algo que editar.
  const hayConciliacion = respuestas.some((r) => {
    const item = items.find((i) => i.id === r.item_id)
    return item?.tipo === 'CONCILIACION' && ((r.valor as ValorConciliacion | null)?.productos?.length ?? 0) > 0
  })
  const { puntaje, itemsBinarios, itemsBinariosOk } = resumirEvaluacion(evaluacion, respuestas, items, sucursalOpciones)
  const est = estadoBadge(puntaje)
  const aplicaOpciones = opcionesQueAplican(evaluacion.sucursal_id, sucursalOpciones)
  const aplicarOpciones = (item: Item) => {
    if (item.tipo !== 'CHECKLIST' || !item.opciones?.length) return item
    const ids = aplicaOpciones.get(item.id)
    if (!ids?.length) return item
    return { ...item, opciones: item.opciones.filter((o) => ids.includes(o.id)) }
  }

  /* El conteo de fallas por responsable ya no se pinta: la tarjeta quedó solo con
     cargo, % y barra, y el detalle de qué salió mal vive en el modal. Dejar el
     `Map` armado acá era recorrer todas las respuestas en cada render para
     guardar un dato que nadie lee. */

  /* Tampoco se calcula el avance por evaluador: la tarjeta que lo mostraba se fue
     y el `Map` solo servía para pintarla. */

  // Puntaje por responsable: cada ítem reparte su peso entre quienes participan en él
  // (peso ÷ nº de responsables); el % de cada responsable = logrado / posible.
  const valoresResp = valorPorResponsable(items.map(aplicarOpciones), respuestas)
  /**
   * De peor a mejor puntaje. El bloque se lee para decidir a quién se le habla
   * primero, y ese es el que quedó abajo; con el orden en que salen de
   * `valorPorResponsable` (que es el orden de aparición en los ítems) el que más
   * necesita atención podía quedar en el medio, escondido entre los que
   * salieron bien.
   *
   * Los que no tienen posible quedan al final: no se sabe si cumplieron, y poner
   * un "—" arriba o abajo los mezcla con números que sí significan algo.
   */
  const valoresOrdenados = [...valoresResp].sort((a, b) => {
    if (a.porciento == null) return b.porciento == null ? 0 : 1
    if (b.porciento == null) return -1
    return a.porciento - b.porciento
  })
  /**
   * Los cargos del centro elegido. El filtro va DESPUÉS del orden: ordenar por
   * porcentaje y después recortar deja la lista en el mismo orden relativo, que es
   * lo que hace comparable "el peor de la sucursal" con "el peor de la central".
   */
  const valoresVisibles = cargosDelCentro(valoresOrdenados, centro, catalogosCentro)

  /**
   * Las fallas del responsable abierto, agrupadas por módulo.
   *
   * Se agrupa porque el detalle de la evaluación ya está armado por módulos y el
   * que está en el modal quiere lo mismo: "dentro de Higiene me quitaron estos
   * puntos", no una lista de 30 ítems sueltos de seis módulos distintos. El
   * `aplicarOpciones` es el mismo filtro de sucursal que usa el resto de la
   * pantalla, para que el modal no nombre checks que en la tabla ni aparecen.
   */
  const fallasLista = fallasDe ? fallasDeResponsable(fallasDe, items.map(aplicarOpciones), respuestas) : []
  const fallasAbiertas = fallasLista.reduce<Map<string, FallaResponsable[]>>((grupos, falla) => {
    const clave = falla.modulo_id ?? ''
    const lista = grupos.get(clave) ?? []
    lista.push(falla)
    grupos.set(clave, lista)
    return grupos
  }, new Map())
  /** Puntos perdidos del responsable abierto, para el pie del modal. */
  const perdidasAbiertas = fallasLista.reduce((suma, f) => suma + f.perdidos, 0)

  /**
   * Incidencias del cargo abierto. Van en el mismo modal y no en uno aparte
   * porque son dos caras de lo mismo: lo que le quitó puntos del cuestionario y
   * lo que le vio el evaluador en la tienda. Abrir dos modales para leer lo que
   * pesa sobre la misma persona es un paso de más.
   */
  const incidenciasDelCargo = fallasDe ? filasIncidencias.filter((f) => incidenciaEsDeCargo(f, fallasDe)) : []

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

  const descargar = async (impresion?: OpcionesPdf) => {
    setError('')
    setDescargando(true)
    try {
      await descargarInformePdf(evaluacion.id, filtro, impresion)
    } catch (error) {
      setError(`No se pudo descargar el PDF: ${detalleTecnico(error)}`)
    } finally {
      setDescargando(false)
      setSelectorAbierto(false)
    }
  }

  const mostrarTipModulo = (label: string, el: HTMLElement) => {
    const rect = el.getBoundingClientRect()
    setModuloTip({ label, top: rect.top - 8, left: rect.left + rect.width / 2 })
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
            {/* Solo para Líder y solo cuando hay productos escaneados: el detalle es
                de solo lectura, y este botón lleva a la vista de edición —que ya sabe
                borrar un producto con confirmación— sin duplicar esa lógica acá. */}
            {profile?.rol === 'LIDER' && hayConciliacion ? (
              <Button
                variant="ghost"
                className="min-h-0 gap-1.5 bg-white/10 px-3 py-1.5 text-white hover:bg-white/20"
                onClick={() => navigate(`/evaluaciones/${evaluacion.id}/conciliacion`)}
                title="Agregar o quitar productos escaneados"
              >
                <Pencil className="h-4 w-4" />
                <span className="hidden sm:inline">Editar productos</span>
              </Button>
            ) : null}
            {/* Va "ghost" y no "secondary": el secondary trae `border border-primary-200`
                y sobre el fondo de color del encabezado ese borde se ve como un
                contorno alrededor del botón. El fondo translúcido lo define el className. */}
            <Button
              variant="ghost"
              className="min-h-0 gap-1.5 bg-white/10 px-3 py-1.5 text-white hover:bg-white/20"
              disabled={descargando}
              onClick={() => setSelectorAbierto(true)}
              title="Elegir qué incluye el PDF"
            >
              <FileDown className="h-4 w-4" />
              Descargar PDF
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 py-4 lg:max-w-7xl lg:grid lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)] lg:items-start lg:gap-5 lg:px-6 lg:py-6 xl:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        {/*
          En escritorio el detalle separa el contexto (incidencias, quién evaluó,
          puntaje por cargo) de las respuestas. En el teléfono todo fluye en una sola
          columna.
        */}
        {/* `min-w-0`: sin esto esta columna es un ítem flex/grid que no baja de su
            ancho por contenido, y un cargo con nombre largo ensanchaba la columna
            entera hasta romper el layout de dos columnas.

            ALTO FIJO, NO ALTO MÁXIMO
            ------------------------
            Con `max-h` + `overflow-y-auto` la columna scrolleaba, y como la lista
            de cargos también scrollea, había dos barras: la de afuera arrastraba
            la tarjeta de incidencias y la de adentro. Dos barras para un bloque
            que cabe en una pantalla es una de más.

            Ahora la columna mide exactamente lo que hay (`h`) y es flex: los
            bloques de arriba no se encogen (`shrink-0`) y el único que cede es
            la lista de cargos, que recibe lo que sobra. Así ni hace falta
            `sticky` en ninguna de las dos tarjetas para que no se muevan: no hay
            nada que las empuje.

            Y por eso el alto es fijo y no máximo: con `max-h`, si el contenido
            pasa la pantalla la columna crece, y como la columna está `sticky`
            contra la página su mitad de abajo queda inalcanzable. Eso ya no
            puede pasar porque el contenido no puede crecer. */}
        <div className="min-w-0 space-y-4 lg:sticky lg:top-20 lg:flex lg:h-[calc(100vh-6rem)] lg:flex-col lg:space-y-5 lg:overflow-hidden">
          {error ? (
            <div className="shrink-0 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
          ) : null}
          {aviso ? (
            <div
              className={cn(
                'flex shrink-0 items-start gap-2 rounded-xl border px-3 py-2 text-sm',
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

          <IncidenciasEvaluacion
            filas={incidencias.filas}
            error={incidencias.error}
            cargando={incidencias.cargando}
            onAbrir={() => setIncidenciasAbiertas(true)}
          />

          {valoresResp.length ? (
            /* `flex-1 min-h-0`: es lo único en la columna que cede alto, así que
               recibe el espacio que dejan los bloques de arriba y el que sobra.
               El `min-h-0` es lo que permite que la lista scrollee en vez de
               empujar la tarjeta: sin él el hijo mínimo de flex es su alto
               completo y la tarjeta crece hasta salirse de la columna. */
            <section className="flex min-h-0 flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:min-h-0 lg:flex-1">
              {/* La explicación de cómo se calcula el puntaje va en el tooltip del "?" y no
                  escrita abajo. Este bloque scrollea, y un párrafo de cuatro
                  líneas arriba empujaba la lista hacia abajo: había que pasar por
                  él en cada evaluación para llegar al primer cargo, que es justo lo
                  que se viene a mirar. */}
              <div className="mb-2 flex shrink-0 items-center gap-1.5">
                <p className="font-bold text-primary-900">Puntaje por responsable</p>
                <InfoTooltip texto="Cada ítem reparte su valor entre quienes participan en él (peso ÷ nº de responsables del ítem). El % de cada responsable = logrado ÷ posible. Ordenadas de menor a mayor: la primera es a quien hay que hablarle. El selector de arriba deja solo los cargos de un centro de operaciones, según el catálogo de cada branch." />
              </div>
              <SelectorCentro
                centro={centro}
                onCentro={setCentro}
                catalogos={catalogosCentro}
                cuentaSucursal={cargosDelCentro(valoresOrdenados, 'sucursal', catalogosCentro).length}
                cuentaCentral={cargosDelCentro(valoresOrdenados, 'central', catalogosCentro).length}
              />
              {/* Una tarjeta por responsable en vez de una tabla. Con cinco
                  columnas de números el bloque se leía como un reporte: había que
                  saltar de una fila a otra para comparar, y el nombre —que es lo
                  único que identifica a la persona— quedaba apretado en una
                  columna de 3 rem contra las otras, que necesitan más ancho por
                  defecto de las cifras.

                  En la tarjeta cada persona tiene su propia línea de tiempo
                  vertical: nombre, barra, porcentaje grande. La comparación entre
                  dos ya no requiere alinear nada, porque la barra y el número
                  tienen el mismo ancho siempre y el ojo compara largo contra
                  largo.

                  Solo tres datos y ninguno más. Los puntos y el conteo de fallas
                  se quitaron porque EMRUMBAN la pregunta que la tarjeta tiene que
                  responder, que es quién va primero: el 34% de Beto se lee sin
                  más, y los 7,5 pts de 20 no dicen si son una falla grande o
                  siete chicas. Los puntos están a un clic, en el modal. */}
              {/* El único scroll de la columna. `min-h-0 flex-1`: toma el alto que le
                  dejó la tarjeta y scrollea dentro. Sin `min-h-0` no scrollea,
                  se desborda; sin `flex-1` no crece y queda una lista corta con
                  un hueco abajo. Ya no hace falta un `max-h` calculado a mano:
                  el alto lo reparte flex. */}
              {valoresVisibles.length ? (
                <ul className="mt-2 min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain pr-1">
                {valoresVisibles.map((v) => {
                  const nivel = v.porciento == null
                    ? 'sin-dato'
                    : v.porciento >= 80
                      ? 'alto'
                      : v.porciento >= 50
                        ? 'medio'
                        : 'bajo'
                  return (
                    <li key={v.responsable}>
                      {/* Toda la tarjeta es el botón, para que no haya un blanco
                          chico adivinable: con el clic solo en el nombre, la
                          mitad derecha de la tarjeta parecía decorado y no
                          pasaba el puntero. */}
                      <button
                        type="button"
                        onClick={() => setFallasDe(v.responsable)}
                        className={cn(
                          'flex w-full items-center gap-2 rounded-xl border px-2.5 py-2.5 text-left transition-colors',
                          nivel === 'bajo'
                            ? 'border-red-200 bg-red-50/60 hover:bg-red-50'
                            : nivel === 'medio'
                              ? 'border-amber-200 bg-amber-50/60 hover:bg-amber-50'
                              : nivel === 'alto'
                                ? 'border-slate-200 bg-slate-50 hover:bg-slate-100'
                                : 'border-slate-200 bg-white hover:bg-slate-50'
                        )}
                      >
                        {/* `min-w-0 flex-1` es lo que deja que el nombre baje de ancho. Un ítem flex
                            no baja de su ancho por contenido salvo que se le
                            permita encogerse: sin esto un cargo largo
                            ("Coordinación Regional de Ventas") empujaba la tarjeta
                            y el % se salía de la caja. */}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-2">
                        {/* El nombre envuelve en vez de recortarse. `truncate` lo dejaba en
                            "Coordinación Regional de…", y el cargo es justo el
                            dato que identifica a quién le toca: medio nombre no
                            sirve para nada. La tarjeta crece dos líneas y el resto
                            del bloque se reacomoda solo. */}
                        <p className="min-w-0 flex-1 break-words text-sm font-bold leading-tight text-slate-800" title={v.responsable}>
                          {v.responsable}
                        </p>
                        {/* El porcentaje va arriba a la derecha y no abajo en una
                            fila de números: es el dato que decide la tarjeta, y si
                            está al final hay que recorrerla entera para verlo. */}
                        <span
                          className={cn(
                            'shrink-0 text-base font-extrabold tabular-nums',
                            nivel === 'bajo' ? 'text-red-600' : nivel === 'medio' ? 'text-amber-600' : nivel === 'alto' ? 'text-green-600' : 'text-slate-400'
                          )}
                        >
                          {v.porciento == null ? '—' : `${v.porciento}%`}
                        </span>
                      </div>
                      {/* Barra: el % en texto se lee mal de memoria (83 y 34 son
                          casi el mismo número al ojo), pero dos barras de largo
                          distinto se comparan de un vistazo aunque estén
                          separadas por dos tarjetas. */}
                      <ProgressBar
                        value={v.porciento ?? undefined}
                        className="mt-2 h-1.5 bg-white/70"
                        fillClassName={nivel === 'bajo' ? 'bg-red-500' : nivel === 'medio' ? 'bg-amber-500' : nivel === 'alto' ? 'bg-green-500' : 'bg-slate-300'}
                      />
                        </div>
                        {/* Flecha: sin ella el bloque parece un cartel de resultados y
                            no se ve que se puede abrir. `self-center` porque el
                            contenido crece de alto según el nombre: con una línea
                            la flecha queda al medio y con dos, pegada al borde de
                            arriba. */}
                        <ChevronRight className="h-4 w-4 shrink-0 self-center text-slate-300" aria-hidden="true" />
                      </button>
                    </li>
                  )
                })}
                </ul>
              ) : (
                /* Los cargos sí existen pero ninguno es del centro elegido. Es un
                   caso normal —una sucursal puede no tener ningún cargo de central—
                   y sin esta nota la tarjeta queda en blanco, que se lee como que el
                   puntaje no cargó. */
                <p className="mt-2 min-h-0 flex-1 rounded-xl border border-dashed border-slate-300 px-3 py-3 text-xs text-slate-500">
                  Ningún cargo de esta evaluación pertenece a{' '}
                  <strong className="font-bold text-slate-700">{centro === 'sucursal' ? 'esta sucursal' : 'la oficina central'}</strong>.
                </p>
              )}
            </section>
          ) : null}

          {/* Detalle de las fallas del responsable. Se calcula sobre la demanda, no
              en un estado aparte: `fallasLista` sale de los mismos datos que ya
              están cargados y con el mismo filtro de sucursal que la pantalla, así
              que no puede desincronizarse de la tarjeta de la que salió. */}
          <Modal
            open={!!fallasDe}
            onClose={() => setFallasDe(null)}
            title={fallasDe ? `Fallas de ${fallasDe}` : ''}
            wide
            footer={
              <p className="text-xs text-slate-500">
                {perdidasAbiertas > 0 ? (
                  <>
                    Total perdido:{' '}
                    <strong className="font-bold tabular-nums text-red-600">{fmt(perdidasAbiertas)} pts</strong> en{' '}
                    {fallasLista.length} ítem{fallasLista.length !== 1 ? 's' : ''}.
                  </>
                ) : (
                  'Este responsable no tiene puntos perdidos: su % baja por ítems en los que no participa.'
                )}
              </p>
            }
          >
            {fallasLista.length ? (
              <div className="space-y-4">
                {[...fallasAbiertas.entries()]
                  // Los módulos en el orden en que salen en la evaluación y no en
                  // el que quedaron en el Map: sin este sort el grupo sin módulo
                  // aparecía primero y partía la lista de la evaluación.
                  .sort(([a], [b]) => {
                    const ia = modulos.findIndex((m) => m.id === a)
                    const ib = modulos.findIndex((m) => m.id === b)
                    if (ia === -1 && ib === -1) return 0
                    if (ia === -1) return 1
                    if (ib === -1) return -1
                    return ia - ib
                  })
                  .map(([moduloId, fallas]) => {
                    const modulo = modulos.find((m) => m.id === moduloId)
                    return (
                      <section key={moduloId || moduloId}>
                        <h4 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                          {modulo?.nombre ?? 'Sin módulo'}
                        </h4>
                        <ul className="space-y-2">
                          {fallas.map((falla) => (
                            <li key={falla.item_id} className="rounded-xl border border-red-100 bg-red-50/50 px-3 py-2.5">
                              <div className="flex items-start justify-between gap-2">
                                <p className="min-w-0 flex-1 text-sm font-semibold text-slate-800">{falla.texto}</p>
                                <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-xs font-bold tabular-nums text-red-600">
                                  −{fmt(falla.perdidos)}
                                </span>
                              </div>
                              {falla.checks.length ? (
                                <ul className="mt-1.5 space-y-0.5">
                                  {falla.checks.map((check) => (
                                    <li key={check} className="flex gap-1.5 text-xs text-red-700">
                                      <span aria-hidden="true">·</span>
                                      <span>{check}</span>
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                /* Sin checks nombrados (ítems binarios y de plano): el
                                   ítem entero es la falla, y decir "el ítem falló"
                                   sería tautológico. Se dice el tipo para al menos
                                   ubicar el origen. */
                                <p className="mt-1 text-xs text-red-600">Ítem completo · {etiquetaTipo(falla.tipo)}</p>
                              )}
                            </li>
                          ))}
                        </ul>
                      </section>
                    )
                  })}
              </div>
            ) : null}

            {/* Las incidencias del cargo van en este mismo modal, debajo de los
                puntos perdidos, y no en uno aparte. Son dos caras de lo mismo que
                pesa sobre la misma persona: lo que el cuestionario le descontó y
                lo que el evaluador le vio en la tienda. Abrir dos modales para
                leer una cosa sola es un paso de más. */}
            {incidenciasDelCargo.length ? (
              <section className="mt-5 space-y-2 border-t border-slate-200 pt-4">
                <h4 className="text-[11px] font-bold uppercase tracking-wide text-amber-600">
                  Incidencias reportadas ({incidenciasDelCargo.length})
                </h4>
                <p className="text-xs text-slate-500">
                  Fuera del cuestionario: el evaluador lo vio en la tienda y le atribuyó este cargo.
                </p>
                <ListaIncidencias
                  filas={incidenciasDelCargo}
                  urlsFotos={incidencias.urlsFotos}
                />
              </section>
            ) : null}
          </Modal>

          {/* Todas las incidencias. Va en un modal y no en la columna porque el
              bloque de incidencias ya no es para leerlas: es el contador. Con
              veinte incidencias escritas enteras tapaba justo los cargos, que es
              lo que el Líder está mirando. */}
          <Modal
            open={incidenciasAbiertas}
            onClose={() => setIncidenciasAbiertas(false)}
            title={`Incidencias reportadas (${filasIncidencias.length})`}
            wide
          >
            <ListaIncidencias
              filas={filasIncidencias}
              urlsFotos={incidencias.urlsFotos}
              vacio="Los evaluadores no reportaron incidencias en esta visita."
            />
          </Modal>

          {/* Selector de qué va al PDF. Acá los módulos salen de `detalle`, que
              ya está cargado: no hace falta volver a preguntarle al servidor
              cuáles son para poder elegir cuáles imprimir. */}
          <SelectorPdf
            abierto={selectorAbierto}
            onClose={() => setSelectorAbierto(false)}
            modulos={modulos.map((modulo) => ({ id: modulo.id, nombre: modulo.nombre }))}
            onConfirmar={(impresion) => void descargar(impresion)}
            descargando={descargando}
          />
        </div>

        <div className="min-w-0 space-y-4 pt-4 lg:col-start-2 lg:row-start-1 lg:space-y-5 lg:pt-0">
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-lg font-extrabold text-primary-900">{evaluacion.sucursal?.nombre ?? 'Sucursal'}</p>
                <p className="text-sm text-slate-500">
                  {[evaluacion.sucursal?.shop_id ? `Nº tienda ${evaluacion.sucursal.shop_id}` : '', evaluacion.sucursal?.direccion ?? ''].filter(Boolean).join(' · ') || 'Sin datos de tienda'}
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  {new Date(`${evaluacion.fecha}T12:00:00`).toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · {evaluacion.aperturador?.nombre ?? '—'}
                </p>
              </div>
              <PuntajeTotal
                puntaje={puntaje}
                estado={est}
                completos={itemsBinariosOk}
                total={itemsBinarios}
              />
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
          <FiltroCumplimiento
            filtro={filtro}
            onFiltro={setFiltro}
            conteo={conteo}
          >
            {modulos.length > 0 ? (
              <nav aria-label="Índice de módulos" className="overflow-x-auto py-1">
                <ol className="relative flex w-full items-center justify-between gap-2 px-1 before:absolute before:left-4 before:right-4 before:top-1/2 before:h-px before:-translate-y-1/2 before:bg-slate-300">
                  {modulos.map((modulo, index) => (
                    <li key={modulo.id} className="relative z-10 shrink-0">
                      <a
                        href={`#modulo-${modulo.id}`}
                        aria-label={`Módulo ${index + 1}: ${modulo.nombre}`}
                        aria-current={moduloActivoId === modulo.id ? 'location' : undefined}
                        onClick={(event) => {
                          event.preventDefault()
                          setModuloActivoId(modulo.id)
                          document.getElementById(`modulo-${modulo.id}`)?.scrollIntoView({
                            behavior: 'instant',
                            block: 'start'
                          })
                        }}
                        onMouseEnter={(event) => {
                          if (moduloActivoId !== modulo.id) mostrarTipModulo(modulo.nombre, event.currentTarget)
                        }}
                        onMouseLeave={() => setModuloTip(null)}
                        onFocus={(event) => {
                          if (moduloActivoId !== modulo.id) mostrarTipModulo(modulo.nombre, event.currentTarget)
                        }}
                        onBlur={() => setModuloTip(null)}
                        className={cn(
                          'min-h-8 min-w-8 rounded-full border-2 transition-colors',
                          moduloActivoId === modulo.id
                            ? 'bg-primary px-3 py-1 text-center text-xs font-semibold leading-tight text-white'
                            : 'grid h-8 w-8 place-items-center border-slate-300 bg-white text-slate-600 hover:border-primary hover:text-primary'
                        )}
                      >
                        {moduloActivoId === modulo.id
                          ? modulo.nombre
                          : <IconoModulo nombre={modulo.icono} className="h-4 w-4" />}
                      </a>
                    </li>
                  ))}
                </ol>
              </nav>
            ) : null}
          </FiltroCumplimiento>
          {moduloTip ? (
            <span
              role="tooltip"
              className="pointer-events-none fixed z-[60] flex -translate-x-1/2 -translate-y-full flex-col items-center"
              style={{ top: moduloTip.top, left: moduloTip.left }}
            >
              <span className="whitespace-nowrap rounded-lg bg-primary px-2.5 py-1.5 text-xs font-semibold text-white shadow-lg">
                {moduloTip.label}
              </span>
              <span aria-hidden className="h-0 w-0 border-x-[5px] border-t-[6px] border-x-transparent border-t-primary" />
            </span>
          ) : null}

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
                  : item.tipo === 'CONCILIACION'
                    ? pathsEvidenciaConciliacion(res.valor)
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
            const punteo = puntajeModuloDeRespuestas(respuestas, items, m.id, evaluacion.sucursal_id, sucursalOpciones)
            // Cuántas filas del módulo quedan en pantalla con el filtro actual. El
            // puntaje del módulo NO se recalcula: es el del módulo entero, y bajarlo
            // con el filtro haría creer que el filtro cambió la evaluación.
            const propias = [...veredictoFila.entries()].filter(([, f]) => f.modulo_id === m.id)
            const visibles = propias.filter(([, f]) => pasaFiltro(f.veredicto)).length
            const ocultas = propias.length - visibles
            return (
              <section id={`modulo-${m.id}`} key={m.id} className="scroll-mt-24 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-5 py-3.5">
                  <div className="flex min-w-0 items-center gap-2">
                    <IconoModulo nombre={m.icono} className="h-5 w-5 shrink-0 text-primary" />
                    <p className="font-bold text-primary-900">{m.nombre}</p>
                  </div>
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
  children
}: {
  filtro: 'ambos' | 'cumple' | 'no-cumple'
  onFiltro: (f: 'ambos' | 'cumple' | 'no-cumple') => void
  conteo: Record<VeredictoItem, number>
  children?: ReactNode
}) {
  const opciones: { id: 'ambos' | 'cumple' | 'no-cumple'; texto: string; n: number }[] = [
    { id: 'ambos', texto: 'Ambos', n: conteo.cumple + conteo['no-cumple'] },
    { id: 'cumple', texto: 'Cumple', n: conteo.cumple },
    { id: 'no-cumple', texto: 'No cumple', n: conteo['no-cumple'] }
  ]
  return (
    // En escritorio queda fijo arriba: al revisar veinte ítems no se va a tener que
    // subir a cambiar el filtro. En el teléfono fluye, porque ahí sí estorba.
    <div className="bg-primary-50 p-3 lg:sticky lg:top-20 lg:z-20 lg:bg-primary-50/95 lg:backdrop-blur">
      {children ? <div className="mb-2">{children}</div> : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="Filtrar los ítems por cumplimiento" className="inline-flex rounded-full bg-white/70 p-1">
          {opciones.map((o) => (
            <button
              key={o.id}
              type="button"
              aria-pressed={filtro === o.id}
              onClick={() => onFiltro(o.id)}
              className={cn(
                'rounded-full px-3.5 py-1.5 text-xs font-bold transition-colors',
                filtro === o.id ? 'bg-primary text-white shadow-sm' : 'text-primary-900 hover:bg-white/80'
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

/**
 * El puntaje de la evaluación: el número, grande y en el color del tag de estado.
 *
 * POR QUÉ SOLO EL NÚMERO
 * ---------------------
 * Se probó con un dial (un anillo alrededor del número) y no aportó: al lado del
 * nombre de la sucursal competía por la atención sin agregar información, y el
 * largo del arco repetía lo que el color ya decía. El número bien grande es lo
 * único que hay que mirar para saber cómo terminó la visita.
 *
 * POR QUÉ CON EL COLOR DEL TAG Y NO EN NEGRO
 * ------------------------------------------
 * 78% en negro obliga a buscar la etiqueta de al lado para saber si está bien. Va
 * con el tono del tag —el rojo del "No cumple", el amarillo del "En riesgo", el
 * verde del "Cumple"— para que número y etiqueta se lean como una sola cosa, un
 * paso más oscuro que el fondo porque el tono exacto del tag no se leía sobre la
 * tarjeta blanca. Y sin fondo propio: se probó como pastilla y quedaban dos
 * bloques de color en la misma esquina.
 */
export function PuntajeTotal({
  puntaje,
  estado,
  completos,
  total
}: {
  puntaje: number | null
  estado: { texto: string; color: number }
  /** Íems que llegaron al 100%, de los `total` puntuables. */
  completos: number
  total: number
}) {
  const cumple = puntaje != null && puntaje >= UMBRAL_CUMPLE
  // Un decimal alcanza: el hueco que importa ("faltan 2") se lee igual con 78,0
  // que con 78, y `fmt` ya redondea sin arrastrar ceros inútiles.
  const hueco = puntaje == null ? null : Math.round((UMBRAL_CUMPLE - puntaje) * 10) / 10
  /* El puntaje va en el color del FONDO del tag de estado —rojo claro, amarillo
     claro, verde claro— y no en el color de su texto. Es lo que se pidió, y hace
     que el número se lea como parte de la etiqueta y no como un cartel aparte.

     Sin puntaje es gris y no el `text-slate-100` que sale de la paleta: un guion
     claro sobre la tarjeta blanca no se ve, y lo que no se ve parece un error de
     carga en vez de "todavía no hay número". */
  const colorNumero = puntaje == null ? 'text-slate-300' : colorFondoBadge(estado.color)

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      {/* `tabular-nums`: sin esto el ancho cambia con cada dígito y en una
          evaluación en viva —que se repinta cada 15 s— el bloque entero da un tirón
          lateral. */}
      <span className={cn('text-4xl font-extrabold leading-none tabular-nums sm:text-5xl', colorNumero)}>
        {puntaje == null ? '—' : fmt(puntaje)}
        {puntaje == null ? null : <span className="text-2xl sm:text-3xl">%</span>}
      </span>
      <Badge color={estado.color}>{estado.texto}</Badge>
      {hueco == null ? (
        <span className="text-[11px] text-slate-400">Todavía no hay puntaje</span>
      ) : (
        <span className={cn('text-[11px]', cumple ? 'text-slate-400' : 'font-bold text-red-600')}>
          {cumple ? `${fmt(Math.abs(hueco))} por encima del mínimo de ${UMBRAL_CUMPLE}%` : `Faltan ${fmt(hueco)} para el mínimo de ${UMBRAL_CUMPLE}%`}
        </span>
      )}
      {/* `total` son los ítems puntuables CON respuesta, no todos los de la
          plantilla. Por eso dice "al 100%" y no "de N ítems": un ítem sin
          responder no es un ítem incompleto, es uno que todavía no toca. */}
      {total > 0 ? <span className="text-[11px] text-slate-400 tabular-nums">{completos} de {total} ítems al 100%</span> : null}
    </div>
  )
}

/**
 * Selector de centro de operaciones: ¿los cargos de esta sucursal o los de la
 * oficina central?
 *
 * Es un control segmentado y no un `<select>` porque son dos opciones y caben las
 * dos a la vista: con un desplegable hay que abrirlo para ver que existe la otra,
 * que es justo lo que se quiere comparar. Mismo criterio que el filtro de
 * cumplimiento de arriba, y por el mismo motivo.
 *
 * Los números son la cuenta de cargos que se van a ver. No son decorativos: son
 * la respuesta a "¿esto me muestra a los míos o a los de otro lado?", y sin ellos
 * el usuario tiene que hacer clic para averiguarlo.
 *
 * Si algún catálogo no se pudo leer, los dos botones quedan apagados y se dice por
 * qué. Un selector que promete una separación y no la puede hacer es peor que no
 * ofrecerlo: se leería como "en la central no hay cargos".
 */
function SelectorCentro({
  centro,
  onCentro,
  catalogos,
  cuentaSucursal,
  cuentaCentral
}: {
  centro: CentroOperaciones
  onCentro: (c: CentroOperaciones) => void
  catalogos: CatalogosCentro
  cuentaSucursal: number
  cuentaCentral: number
}) {
  const opciones = [
    { id: 'sucursal' as const, texto: 'Sucursal', n: cuentaSucursal },
    { id: 'central' as const, texto: 'Central', n: cuentaCentral }
  ]

  return (
    <div className="shrink-0">
      <div
        role="group"
        aria-label="Centro de operaciones de los responsables"
        className="inline-flex rounded-full bg-slate-100 p-0.5"
      >
        {opciones.map((o) => {
          const disponible = centroDisponible(o.id, catalogos)
          return (
            <button
              key={o.id}
              type="button"
              aria-pressed={centro === o.id}
              disabled={!disponible}
              onClick={() => onCentro(o.id)}
              className={cn(
                'rounded-full px-2.5 py-1 text-[11px] font-bold transition-colors',
                centro === o.id
                  ? 'bg-white text-primary-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700',
                !disponible && 'cursor-not-allowed opacity-40 hover:text-slate-500'
              )}
            >
              {o.texto}
              <span className="ml-1.5 tabular-nums opacity-70">{o.n}</span>
            </button>
          )
        })}
      </div>
      {catalogos.cargando || !separacionDisponible(catalogos) ? (
        <p className="mt-1.5 text-[11px] leading-snug text-slate-400">
          {catalogos.cargando
            ? 'Separando los cargos por centro…'
            : 'No se pudo leer el catálogo de cargos, así que se ven todos juntos.'}
        </p>
      ) : null}
    </div>
  )
}

function EstadoColaborador({ aplica, cumple, sinPuntosAplicables, revisado }: { aplica: boolean; cumple: boolean; sinPuntosAplicables?: boolean; revisado?: boolean }) {
  if (!aplica) return <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-bold text-slate-500">No aplica</span>
  if (sinPuntosAplicables) return <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-bold text-slate-600">Sin puntos aplicables</span>
  // Destildado y sin tocar no es un incumplimiento: es que no se revisó. Pinta
  // de gris, no de rojo, para que la lista no parezca un judgment que no se hizo.
  if (revisado === false) return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-400">Sin revisar</span>
  return <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-bold', cumple ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700')}>{cumple ? 'Completo' : 'Incompleto'}</span>
}
