import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Building2, CalendarPlus, Eye, FileDown, FileSpreadsheet, Lock, Pencil, Play, Store, Trash2, Unlock, Users } from 'lucide-react'
import { DashboardFiltersPortal } from '../../context/DashboardFiltersContext'
import { useAuth } from '../../context/AuthContext'
import { useCatalog } from '../../context/CatalogContext'
import {
  consultarEvaluaciones,
  eliminarEvaluacion,
  crearEvaluacion,
  abrirEvaluacion,
  cerrarEvaluacion,
  obtenerEvaluacion,
  resumirEvaluacion,
  puntajeEnCurso,
  unidadDe,
  type ConjuntoDatos,
  type DetalleEvaluacion
} from '../../lib/data/indicadores'
import type { Foto, Item, Respuesta, SucursalOpcion, VistaEvaluacion } from '../../lib/types'
import { descargarInformePdf } from '../../lib/pdf'
import { useModulosExportables } from '../../lib/pdf/modulosExportables'
import type { OpcionesPdf } from '../../lib/pdf/opciones'
import { armarReporteCargos, cargarImagenesReporte, descargarReporteCargos } from '../../lib/pdf/reporteCargos'
import { descargarExcelEvaluacion, type IncidenciaExcel } from '../../lib/excelEvaluacion'
import { descargarExcelCargos } from '../../lib/excelCargos'
import { fallasDeResponsable, valorPorResponsable, type FallaResponsable } from '../../lib/scoring'
import { pathsDeFotosFalla } from '../../lib/evidencias'
import { aplicarPermisosChecklist } from '../../lib/permisosChecklist'
import { normalizarResponsables } from '../../lib/data/responsablesIncidencia'
import { supabase } from '../../lib/supabase'
import { SelectorPdf } from '../../components/SelectorPdf'
import { PortalCabecera } from '../../components/PortalCabecera'
import { SelectorReporteCargo, type CargoSeleccionable } from '../../components/SelectorReporteCargo'
import { MenuDescargas } from '../../components/MenuDescargas'
import { verTodo } from '../../lib/roles'
import { Badge, Button, ButtonIcon, Card, claseBotonIcono, cn, Confirmar, EmptyState, Field, Input, Modal, Puntaje, Select, Skeleton, SkeletonFilas, Textarea } from '../../components/ui'
import { CompartirEvaluacion } from '../../components/CompartirEvaluacion'
import { COLOR_BADGE_ESTADO, ETIQUETA_ESTADO, colorBadgePuntaje } from '../../lib/diseno'

function haceMeses(n: number): string {
  const d = new Date()
  d.setMonth(d.getMonth() - n)
  return d.toISOString().slice(0, 10)
}

/**
 * Qué opciones de checklist aplican en la unidad de la evaluación, por ítem.
 *
 * Espejo de `EvaluacionDetalle.opcionesQueAplican`: el reporte por cargos que
 * baja el Historial tiene que nombrar los MISMOS checks que el detalle, ni uno
 * que allá no aparece, y acá no se importa desde una pantalla para no acoplar
 * el dashboard al detalle.
 */
function opcionesQueAplican(sucursalId: string, sucursalOpciones: SucursalOpcion[]): Map<string, string[]> {
  const mapa = new Map<string, string[]>()
  for (const o of sucursalOpciones.filter((x) => x.sucursal_id === sucursalId && x.activa)) {
    const arr = mapa.get(o.item_id) ?? []
    arr.push(o.opcion_id)
    mapa.set(o.item_id, arr)
  }
  return mapa
}

/** Puntaje en curso de una evaluación activa: valor en vivo + estado de avance. */
function EnCursoPuntaje({ fila }: { fila?: { puntaje: number | null; respondidos: number } }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Puntaje value={fila?.puntaje ?? null} />
      {fila && fila.respondidos > 0 ? (
        <>
          <Badge color={0}>Parcial</Badge>
          <span className="whitespace-nowrap text-[11px] font-semibold text-slate-400">
            {fila.respondidos} ítems respondidos
          </span>
        </>
      ) : (
        <span className="whitespace-nowrap text-[11px] font-semibold text-slate-400">Sin respuestas</span>
      )}
    </div>
  )
}

export function Historial() {
  const { profile } = useAuth()
  const { sucursales, departamentos } = useCatalog()

  const scope = useMemo(() => {
    if (!profile) return null
    if (profile.rol === 'GERENTE_S' && profile.sucursal_id) return [profile.sucursal_id]
    if (verTodo(profile.rol)) return null
    return null
  }, [profile])

  const esLider = profile?.rol === 'LIDER'

  const [desde, setDesde] = useState(haceMeses(6))
  const [hasta, setHasta] = useState('')
  const [sucursalSel, setSucursalSel] = useState('')
  const [departamentoSel, setDepartamentoSel] = useState('')
  /**
   * Por qué unidad se filtra: sucursal O departamento, nunca las dos. El
   * selector vive en la barra superior y hace DOS cosas: separa la lista
   * (cada modo trae su clase de evaluación) y decide qué filtro de unidad
   * ofrece el panel. Al cambiar de modo se limpia el otro, que era lo que
   * hacían los dos selects entre sí.
   */
  const [modoUnidad, setModoUnidad] = useState<'sucursal' | 'departamento'>('sucursal')
  const [evals, setEvals] = useState<VistaEvaluacion[] | null>(null)
  const [datos, setDatos] = useState<ConjuntoDatos | null>(null)
  const [descargando, setDescargando] = useState<string | null>(null)
  /** Evaluación cuyo selector de PDF está abierto. null = cerrado. */
  const [elegirEn, setElegirEn] = useState<string | null>(null)
  /**
   * Selector de cargos preparado: la tabla no trae respuestas ni puntajes,
   * así que al tocar la opción «por cargo» se pide el detalle y se guarda todo
   * lo que el reporte necesita (ver `prepararCargos`). null = cerrado.
   */
  const [cargosEn, setCargosEn] = useState<{
    detalle: DetalleEvaluacion
    puntaje: number | null
    itemsFiltrados: Item[]
    cargos: CargoSeleccionable[]
  } | null>(null)
  /** Formato del reporte por cargos que se está generando, para el spinner. */
  const [generandoReporte, setGenerandoReporte] = useState<'pdf' | 'excel' | null>(null)
  const { modulos: modulosDeElegir, cargando: cargandoModulosElegir } = useModulosExportables(elegirEn)
  const [aEliminar, setAEliminar] = useState<VistaEvaluacion | null>(null)
  const [aReabrir, setAReabrir] = useState<VistaEvaluacion | null>(null)
  /** Evaluación cuyo cierre está abierto en el modal de comentario. null = cerrado. */
  const [cierrePendiente, setCierrePendiente] = useState<{ ev: VistaEvaluacion; puntaje: number | null } | null>(null)
  const [comentarioCierre, setComentarioCierre] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Apertura / programación
  const [unidadAbrir, setUnidadAbrir] = useState('')
  const [fechaAbrir, setFechaAbrir] = useState(new Date().toISOString().slice(0, 10))
  const [gestionando, setGestionando] = useState(false)
  /** Modal de aperturar abierto. El gatillo vive en la cabecera (`EnCabecera`). */
  const [aperturando, setAperturando] = useState(false)

  const sucursalesVisibles = scope ? sucursales.filter((s) => scope.includes(s.id)) : sucursales
  // GERENTE_S (con `scope`) solo ve su sucursal: sin departamentos y sin filtro.
  const departamentosVisibles = scope ? [] : departamentos
  const esDepartamentoAbrir = departamentosVisibles.some((d) => d.id === unidadAbrir)

  /** Cambia el modo de filtro de unidad y despeja la selección que ya no aplica. */
  const cambiarModoUnidad = (modo: 'sucursal' | 'departamento') => {
    if (modo === modoUnidad) return
    setModoUnidad(modo)
    if (modo === 'sucursal') setDepartamentoSel('')
    else setSucursalSel('')
  }

  /**
   * Argumentos de la consulta, en UN solo lugar: la carga inicial y el
   * refresco de los 60 s los comparten. Estaban escritos dos veces y el
   * selector de modo se cableó sólo en uno de los dos, así que cambiar de
   * modo no filtraba nada.
   */
  const argsFiltro = () => ({
    sucursal_ids: sucursalSel ? [sucursalSel] : scope,
    departamento_ids: departamentoSel ? [departamentoSel] : null,
    // El selector de la barra SEPARA la lista: cada modo muestra su clase
    // de evaluación, y el desplegable del panel acota a una unidad concreta.
    soloSucursales: modoUnidad === 'sucursal',
    soloDepartamentos: modoUnidad === 'departamento',
    desde: desde || undefined,
    hasta: hasta || undefined
  })

  const cargar = async (silencioso = false) => {
    if (!silencioso) setEvals(null)
    try {
      const d = await consultarEvaluaciones(argsFiltro())
      setDatos(d)
      setEvals(d.evaluaciones)
    } catch {
      if (!silencioso) setEvals([])
    }
  }

  useEffect(() => {
    let activo = true
    setEvals(null)
    void (async () => {
      try {
        const d = await consultarEvaluaciones(argsFiltro())
        if (activo) {
          setDatos(d)
          setEvals(d.evaluaciones)
        }
      } catch {
        if (activo) setEvals([])
      }
    })()
    return () => { activo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desde, hasta, sucursalSel, departamentoSel, modoUnidad, scope?.join(',')])

  // Refresco automático: muestra el puntaje en curso mientras los evaluadores responden.
  useEffect(() => {
    const t = window.setInterval(() => { void cargar(true) }, 60000)
    return () => window.clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desde, hasta, sucursalSel, departamentoSel, modoUnidad, scope?.join(',')])

  // Puntaje en vivo de las evaluaciones activas: con las mismas reglas que al cerrar.
  const puntajesVivos = useMemo(() => {
    const m = new Map<string, { puntaje: number | null; respondidos: number }>()
    if (!datos) return m
    for (const ev of datos.evaluaciones) {
      if (ev.estado !== 'ACTIVA') continue
      m.set(ev.id, puntajeEnCurso(ev, datos.respuestas, datos.items, datos.sucursalOpciones, datos.sucursalPermisos))
    }
    return m
  }, [datos])

  const descargar = async (ev: VistaEvaluacion, impresion?: OpcionesPdf) => {
    setError(null)
    setDescargando(ev.id)
    try {
      await descargarInformePdf(ev.id, undefined, impresion)
    } catch {
      setError('No se pudo descargar el PDF. Intenta de nuevo.')
    }
    setDescargando(null)
    setElegirEn(null)
  }

  /**
   * Excel general de una fila del historial: el MISMO que baja el detalle
   * (resultados + pestaña de incidencias). La tabla no trae el detalle en
   * memoria, así que se pide recién al tocar; la incidencia se consulta con
   * el mismo join de módulo que usa la pantalla del detalle.
   */
  const descargarExcelHistorial = async (ev: VistaEvaluacion) => {
    setError(null)
    setDescargando(ev.id)
    try {
      const detalle = await obtenerEvaluacion(ev.id)
      if (!detalle) throw new Error('sin detalle')
      const { data } = await supabase
        .from('incidencias')
        .select('descripcion, responsables, created_at, fotos, modulo:modulos!incidencias_modulo_id_fkey(nombre)')
        .eq('evaluacion_id', ev.id)
        .order('created_at', { ascending: false })
      const incidencias: IncidenciaExcel[] = (
        (data ?? []) as Array<{
          descripcion: string
          responsables: unknown
          created_at: string
          fotos: string[] | null
          modulo: { nombre: string }[] | null
        }>
      ).map((i) => ({
        descripcion: i.descripcion,
        responsables: normalizarResponsables(i.responsables),
        fecha: i.created_at,
        modulo: i.modulo?.[0]?.nombre ?? null,
        fotos: (i.fotos ?? []).length
      }))
      await descargarExcelEvaluacion(detalle, incidencias)
    } catch {
      setError('No se pudo descargar el Excel. Intenta de nuevo.')
    }
    setDescargando(null)
  }

  /**
   * Prepara el reporte POR CARGOS de una fila: como la tabla no tiene
   * respuestas, se pide el detalle y se recalcula lo mismo que la pantalla del
   * detalle —puntaje, opciones aplicables de la unidad y valor por responsable—
   * y recién con la lista armada se abre el selector.
   */
  const prepararCargos = async (ev: VistaEvaluacion) => {
    setError(null)
    setDescargando(ev.id)
    try {
      const detalle = await obtenerEvaluacion(ev.id)
      if (!detalle) throw new Error('sin detalle')
      const { evaluacion, respuestas, items, sucursalOpciones, sucursalPermisos } = detalle
      const { puntaje } = resumirEvaluacion(evaluacion, respuestas, items, sucursalOpciones, sucursalPermisos)
      const unidad = unidadDe(evaluacion)
      const aplicaOpciones = opcionesQueAplican(unidad, sucursalOpciones)
      // Mismo filtro que `EvaluacionDetalle.aplicarOpciones`: los permisos
      // arman la lista del checklist y las opciones de la unidad recortan el
      // resto, para que el reporte no nombre checks que no aplican.
      const itemsFiltrados = items.map((item) => {
        const conPermisos = aplicarPermisosChecklist(item, unidad, { sucursalPermisos })
        if (conPermisos !== item) return conPermisos
        if (item.tipo !== 'CHECKLIST' || !item.opciones?.length) return item
        const ids = aplicaOpciones.get(item.id)
        if (!ids?.length) return item
        return { ...item, opciones: item.opciones.filter((o) => ids.includes(o.id)) }
      })
      const cargos = valorPorResponsable(itemsFiltrados, respuestas).map((v) => ({
        cargo: v.responsable,
        porciento: v.porciento
      }))
      if (cargos.length) {
        setCargosEn({ detalle, puntaje, itemsFiltrados, cargos })
      } else {
        setError('Esta evaluación todavía no tiene cargos con datos.')
      }
    } catch {
      setError('No se pudo preparar el reporte por cargos. Intenta de nuevo.')
    }
    setDescargando(null)
  }

  /**
   * Qué fotos entran en CADA pendiente del reporte: las del punto que le falló
   * a ESE cargo. Mismo criterio y misma función (`pathsDeFotosFalla`) que el
   * detalle: sin esto, un cargo vería fotos de puntos que no son suyos.
   */
  const fotosDeFalla = (respuestas: Respuesta[], fotos: Foto[]) => {
    const respuestasDe = new Map<string, Respuesta[]>()
    for (const r of respuestas) {
      const lista = respuestasDe.get(r.item_id)
      if (lista) lista.push(r)
      else respuestasDe.set(r.item_id, [r])
    }
    const fotosDe = new Map<string, string[]>()
    for (const f of fotos) {
      const lista = fotosDe.get(f.item_id)
      if (lista) lista.push(f.path)
      else fotosDe.set(f.item_id, [f.path])
    }
    return (falla: FallaResponsable) =>
      pathsDeFotosFalla(falla.tipo, falla.checkIds, respuestasDe.get(falla.item_id) ?? [], fotosDe.get(falla.item_id) ?? [])
  }

  /** Baja el reporte por cargos armado en `prepararCargos`, en PDF o Excel. */
  const descargarPorCargos = async (elegidos: string[], formato: 'pdf' | 'excel') => {
    if (!cargosEn || !elegidos.length) return
    const { detalle, puntaje, itemsFiltrados, cargos } = cargosEn
    setGenerandoReporte(formato)
    try {
      const datos = armarReporteCargos(
        {
          unidad: detalle.evaluacion.sucursal?.nombre ?? detalle.evaluacion.departamento?.nombre ?? 'Evaluación',
          referencia: detalle.evaluacion.sucursal?.shop_id ?? null,
          fecha: detalle.evaluacion.fecha,
          puntajeGeneral: puntaje
        },
        elegidos.map((cargo) => ({
          cargo,
          porciento: cargos.find((c) => c.cargo === cargo)?.porciento ?? null,
          fallas: fallasDeResponsable(cargo, itemsFiltrados, detalle.respuestas)
        })),
        detalle.modulos,
        fotosDeFalla(detalle.respuestas, detalle.fotos)
      )
      if (formato === 'pdf') {
        descargarReporteCargos(datos, await cargarImagenesReporte(datos))
      } else {
        descargarExcelCargos(datos)
      }
      setCargosEn(null)
    } catch {
      setError('No se pudo generar el reporte por cargos. Intenta de nuevo.')
    }
    setGenerandoReporte(null)
  }

  const eliminar = async () => {
    if (!aEliminar) return
    setError(null)
    const id = aEliminar.id
    try {
      await eliminarEvaluacion(id)
      setEvals((prev) => (prev ? prev.filter((e) => e.id !== id) : prev))
      setAEliminar(null)
    } catch {
      setError('No se pudo eliminar la evaluación.')
      setAEliminar(null)
    }
  }

  const hoy = new Date().toISOString().slice(0, 10)

  const aperturar = async () => {
    if (!profile || !unidadAbrir || !fechaAbrir) {
      setError('Selecciona la unidad y la fecha.')
      return
    }
    setError(null)
    setGestionando(true)
    try {
      const esHoy = fechaAbrir === hoy
      // Una evaluación mide UNA unidad: sucursal o departamento, nunca las dos.
      await crearEvaluacion({
        sucursal_id: esDepartamentoAbrir ? null : unidadAbrir,
        departamento_id: esDepartamentoAbrir ? unidadAbrir : null,
        fecha: fechaAbrir,
        estado: esHoy ? 'ACTIVA' : 'PROGRAMADA',
        aperturada_por: profile.id
      })
      setUnidadAbrir('')
      await cargar()
      // Salió bien: se cierra el modal para ver la fila recién creada.
      setAperturando(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo crear la evaluación.')
    }
    setGestionando(false)
  }

  const abrir = async (ev: VistaEvaluacion) => {
    // Reabrir una cerrada tiene consecuencias (vuelve a habilitar las respuestas),
    // por eso pasa por confirmación; abrir una programada es directo.
    if (ev.estado === 'CERRADA') {
      setAReabrir(ev)
      return
    }
    setError(null)
    setGestionando(true)
    try {
      await abrirEvaluacion(ev.id)
      await cargar()
    } catch {
      setError('No se pudo abrir la evaluación.')
    }
    setGestionando(false)
  }

  const reabrir = async () => {
    if (!aReabrir) return
    setError(null)
    setGestionando(true)
    try {
      await abrirEvaluacion(aReabrir.id)
      setAReabrir(null)
      await cargar()
    } catch {
      setError('No se pudo reabrir la evaluación.')
    }
    setGestionando(false)
  }

  const cerrar = async (ev: VistaEvaluacion) => {
    setError(null)
    setGestionando(true)
    try {
      const det = await obtenerEvaluacion(ev.id)
      const puntaje = det ? resumirEvaluacion(det.evaluacion, det.respuestas, det.items, det.sucursalOpciones, det.sucursalPermisos).puntaje : ev.puntuacion
      setComentarioCierre('')
      setCierrePendiente({ ev, puntaje })
    } catch {
      setError('No se pudo preparar el cierre de la evaluación.')
    }
    setGestionando(false)
  }

  const confirmarCierre = async () => {
    if (!cierrePendiente) return
    setGestionando(true)
    try {
      await cerrarEvaluacion(cierrePendiente.ev.id, cierrePendiente.puntaje, comentarioCierre.trim() || null)
      setCierrePendiente(null)
      await cargar()
    } catch {
      setError('No se pudo cerrar la evaluación.')
    }
    setGestionando(false)
  }

  const activas = useMemo(() => evals?.filter((e) => e.estado === 'ACTIVA').length ?? 0, [evals])

  return (
    <div className="space-y-6">
      {/* El modo de unidad va en la barra superior, junto a «Filtros»: SEPARA
          la lista (cada modo trae su clase de evaluación) y decide qué filtro
          de unidad ofrece el panel, todo sin abrir el panel. Sin `scope` no
          hay nada que separar —el gerente de sucursal sólo ve la suya—, así
          que ahí no se muestra. */}
      {scope ? null : (
        <PortalCabecera>
          <div role="group" aria-label="Filtrar por unidad" className="flex p-1 bg-slate-100 rounded-xl">
            <Button
              variant="ghost"
              aria-pressed={modoUnidad === 'sucursal'}
              title="Filtrar por sucursal"
              className={cn('rounded-lg px-4 py-1.5 text-xs transition-all', modoUnidad === 'sucursal' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700')}
              onClick={() => cambiarModoUnidad('sucursal')}
            >
              <Store className="h-3.5 w-3.5 sm:mr-2" />
              {/* Sólo icono en el teléfono: la barra ya lleva menú, «Filtros»
                  y «Aperturar». */}
              <span className="hidden sm:inline">Sucursal</span>
            </Button>
            <Button
              variant="ghost"
              aria-pressed={modoUnidad === 'departamento'}
              title="Filtrar por departamento"
              className={cn('rounded-lg px-4 py-1.5 text-xs transition-all', modoUnidad === 'departamento' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700')}
              onClick={() => cambiarModoUnidad('departamento')}
            >
              <Building2 className="h-3.5 w-3.5 sm:mr-2" />
              <span className="hidden sm:inline">Departamento</span>
            </Button>
          </div>
        </PortalCabecera>
      )}

      {/* El gatillo vive en la cabecera, junto a «Filtros»; el formulario,
          antes una tarjeta siempre visible que empujaba la tabla hacia abajo,
          ahora se abre en modal. Sólo Líder, como siempre. */}
      {esLider ? (
        <PortalCabecera>
          <button
            type="button"
            onClick={() => setAperturando(true)}
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm font-semibold text-slate-600 transition-colors hover:border-primary-300 hover:bg-primary-50 hover:text-primary"
            title="Aperturar evaluación"
            aria-label="Aperturar evaluación"
            aria-haspopup="dialog"
          >
            <CalendarPlus className="h-4 w-4" />
            {/* En el teléfono sólo queda el icono: la barra ya lleva el menú,
                el título y «Filtros». */}
            <span className="hidden sm:inline">Aperturar</span>
          </button>
        </PortalCabecera>
      ) : null}

      {esLider ? (
        <Modal
          open={aperturando}
          onClose={() => setAperturando(false)}
          title="Aperturar evaluación"
          wide
          footer={
            <Button variant="primary" className="w-full" disabled={gestionando || !unidadAbrir} onClick={() => void aperturar()}>
              {gestionando ? 'Guardando…' : fechaAbrir === hoy ? 'Aperturar ahora' : 'Programar'}
            </Button>
          }
        >
          <div className="space-y-4">
            <p className="text-xs text-slate-500">
              Si la fecha es de hoy la evaluación queda <b>Activa</b> para que los evaluadores llenen; si es futura queda <b>Programada</b>. Una por unidad y fecha.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Unidad">
                <Select value={unidadAbrir} onChange={(e) => setUnidadAbrir(e.target.value)} disabled={!!scope}>
                  <option value="">Selecciona…</option>
                  <optgroup label="Sucursales">
                    {sucursalesVisibles.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                  </optgroup>
                  {departamentosVisibles.length ? (
                    <optgroup label="Departamentos">
                      {departamentosVisibles.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
                    </optgroup>
                  ) : null}
                </Select>
              </Field>
              <Field label="Fecha">
                <Input type="date" value={fechaAbrir} onChange={(e) => setFechaAbrir(e.target.value)} />
              </Field>
            </div>
            {activas > 0 ? (
              <p className="text-xs font-medium text-green-600">
                Hay {activas} evaluación(es) activa(s) en el rango mostrado.
              </p>
            ) : null}
            {/* El error también se pinta en la página, pero detrás del modal
                quedaría apagado por el fondo: acá se replica mientras abierto. */}
            {error ? (
              <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
            ) : null}
          </div>
        </Modal>
      ) : null}

      <DashboardFiltersPortal>
        <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Desde">
            <Input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
          </Field>
          <Field label="Hasta">
            <Input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
          </Field>
          {/* Sólo el filtro del modo elegido en la barra: uno nunca trae lo
              del otro, que era lo que aseguraba el cruce de los dos selects.
              Con `scope` el gerente siempre está en su sucursal, así que ahí
              el modo no se ofrece y éste es el único filtro que se ve. */}
          {modoUnidad === 'sucursal' || scope ? (
            <Field label="Sucursal">
              <Select value={sucursalSel} onChange={(e) => setSucursalSel(e.target.value)} disabled={!!scope}>
                <option value="">Todas</option>
                {sucursalesVisibles.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
              </Select>
            </Field>
          ) : (
            <Field label="Departamento">
              <Select value={departamentoSel} onChange={(e) => setDepartamentoSel(e.target.value)}>
                <option value="">Todos</option>
                {departamentosVisibles.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
              </Select>
            </Field>
          )}
        </div>
      </DashboardFiltersPortal>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      ) : null}

      {evals === null ? (
        <Card className="overflow-hidden p-0">
          <div className="border-b border-slate-100 bg-slate-50 px-4 py-3">
            <Skeleton className="h-3 w-48" />
          </div>
          <div className="p-4">
            <SkeletonFilas n={6} />
          </div>
        </Card>
      ) : evals.length === 0 ? (
        <Card>
          <EmptyState
            title="Sin evaluaciones en el rango"
            subtitle="Ajusta los filtros o apertura una evaluación con el botón superior."
          />
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
                  <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-3">Fecha</th>
                  <th className="px-4 py-3">Unidad</th>
                  <th className="px-4 py-3">Estado</th>
                  <th className="px-4 py-3 text-right">Puntaje</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {evals.map((ev) => (
                  <tr key={ev.id} className="border-b border-slate-100 transition-colors hover:bg-slate-50/60 last:border-0">
                    <td className="whitespace-nowrap px-4 py-2.5 text-slate-600">
                      {new Date(`${ev.fecha}T12:00:00`).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </td>
                    <td className="px-4 py-2.5">
                      <p className="font-semibold text-primary-900">
                        {ev.departamento?.nombre ?? ev.sucursal?.nombre ?? 'Sucursal'}
                        {ev.departamento ? <Badge color={0}>Departamento</Badge> : null}
                      </p>
                      {ev.sucursal?.direccion ? <p className="text-xs text-slate-400">{ev.sucursal.direccion}</p> : null}
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge color={COLOR_BADGE_ESTADO[ev.estado]}>{ETIQUETA_ESTADO[ev.estado]}</Badge>
                    </td>
                    <td className="px-4 py-2.5">
                      {ev.estado === 'ACTIVA' ? (
                        <EnCursoPuntaje fila={puntajesVivos.get(ev.id)} />
                      ) : (
                        <div className="flex items-center justify-end gap-2">
                          <Puntaje value={ev.puntuacion} />
                          {ev.puntuacion != null ? (
                            <Badge color={colorBadgePuntaje(ev.puntuacion)}>
                              {ev.puntuacion >= 80 ? 'Cumple' : ev.puntuacion >= 60 ? 'Riesgo' : 'No cumple'}
                            </Badge>
                          ) : null}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {esLider && ev.estado === 'PROGRAMADA' && ev.fecha <= hoy ? (
                          <ButtonIcon
                            variant="primary"
                            disabled={gestionando}
                            onClick={() => void abrir(ev)}
                            title="Abrir evaluación"
                            aria-label="Abrir evaluación"
                          >
                            <Play className="h-5 w-5" />
                          </ButtonIcon>
                        ) : null}
                        {esLider && ev.estado === 'PROGRAMADA' && ev.fecha > hoy ? (
                          <span className="text-xs font-semibold text-slate-400">
                            Se abre el {new Date(`${ev.fecha}T12:00:00`).toLocaleDateString('es', { day: '2-digit', month: 'short' })}
                          </span>
                        ) : null}
                        {esLider && ev.estado === 'ACTIVA' ? (
                          <>
                            <Link
                              to={`/evaluaciones/${ev.id}/conciliacion`}
                              className={claseBotonIcono('neutral')}
                              title="Editar conciliación"
                              aria-label="Editar conciliación"
                            >
                              <Pencil className="h-5 w-5" />
                            </Link>
                            <ButtonIcon
                              variant="success"
                              disabled={gestionando}
                              onClick={() => void cerrar(ev)}
                              title="Cerrar evaluación"
                              aria-label="Cerrar evaluación"
                            >
                              {/* El candado refleja el ESTADO de la evaluación,
                                  no la acción del botón: está abierta, así que
                                  sale el candado abierto. */}
                              <Unlock className="h-5 w-5" />
                            </ButtonIcon>
                          </>
                        ) : null}
                        {esLider && ev.estado === 'CERRADA' ? (
                          <ButtonIcon
                            variant="secondary"
                            disabled={gestionando}
                            onClick={() => void abrir(ev)}
                            title="Reabrir evaluación"
                            aria-label="Reabrir evaluación"
                          >
                            {/* Estado cerrada → candado cerrado. */}
                            <Lock className="h-5 w-5" />
                          </ButtonIcon>
                        ) : null}
                        <Link
                          to={`/evaluaciones/${ev.id}`}
                          className={claseBotonIcono('neutral')}
                          title="Ver detalle"
                          aria-label="Ver detalle"
                        >
                          <Eye className="h-5 w-5" />
                        </Link>
                        {/* Compartir la conciliación con un enlace público, para
                            que el coordinador de inventario siga el conteo sin
                            tener cuenta. Va después de "Ver detalle" porque es
                            otra forma de mirar lo mismo, y sólo para Líder. */}
                        {esLider ? (
                          <CompartirEvaluacion
                            variante="ficha"
                            evaluacionId={ev.id}
                            creadoPor={profile?.id ?? null}
                          />
                        ) : null}
                        {/* UN solo botón de descargas, igual que en el detalle:
                            PDF general (selector de módulos), Excel general y
                            reporte por cargo. `claseBoton` cambia la cara: acá
                            el fondo es blanco, no la barra azul. */}
                        <MenuDescargas
                          claseBoton={claseBotonIcono('secondary')}
                          disabled={descargando === ev.id || generandoReporte != null}
                          opciones={[
                            {
                              id: 'pdf',
                              etiqueta: 'PDF general',
                              icono: <FileDown className="h-5 w-5" />,
                              onSelect: () => setElegirEn(ev.id)
                            },
                            {
                              id: 'excel',
                              etiqueta: 'Excel general',
                              icono: <FileSpreadsheet className="h-5 w-5" />,
                              onSelect: () => void descargarExcelHistorial(ev)
                            },
                            {
                              id: 'cargos',
                              etiqueta: 'Por cargo (PDF o Excel)',
                              icono: <Users className="h-5 w-5" />,
                              onSelect: () => void prepararCargos(ev)
                            }
                          ]}
                        />
                        {esLider ? (
                          <ButtonIcon
                            variant="dangerGhost"
                            onClick={() => setAEliminar(ev)}
                            title="Eliminar evaluación"
                            aria-label="Eliminar evaluación"
                          >
                            <Trash2 className="h-5 w-5" />
                          </ButtonIcon>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Modal
        open={cierrePendiente != null}
        onClose={() => setCierrePendiente(null)}
        title="Cerrar evaluación"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setCierrePendiente(null)}>Cancelar</Button>
            <Button variant="success" disabled={gestionando} onClick={() => void confirmarCierre()}>
              {gestionando ? 'Cerrando…' : 'Cerrar evaluación'}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-slate-600">
          Vas a cerrar la evaluación de{' '}
          <b>{cierrePendiente?.ev.departamento?.nombre ?? cierrePendiente?.ev.sucursal?.nombre ?? 'esta unidad'}</b>{' '}
          ({cierrePendiente ? new Date(`${cierrePendiente.ev.fecha}T12:00:00`).toLocaleDateString('es') : ''}). El
          puntaje queda guardado y los evaluadores ya no podrán responder hasta que la reabras.
        </p>
        <Field label="Comentario de cierre (opcional)" className="mt-3">
          <Textarea
            rows={3}
            value={comentarioCierre}
            onChange={(e) => setComentarioCierre(e.target.value)}
            placeholder="Observaciones del cierre"
          />
        </Field>
      </Modal>

      <Confirmar
        open={aReabrir != null}
        texto={`¿Reabrir la evaluación de ${aReabrir?.departamento?.nombre ?? aReabrir?.sucursal?.nombre ?? 'esta unidad'} (${new Date(`${aReabrir?.fecha}T12:00:00`).toLocaleDateString('es')})? Volverá a quedar Activa: los evaluadores podrán responder y modificar sus respuestas, y se pueden volver a subir las fotos. El puntaje y el comentario del cierre quedan como están hasta que la cierres otra vez.`}
        textoConfirmar="Reabrir"
        variant="primary"
        onConfirm={() => void reabrir()}
        onCancel={() => setAReabrir(null)}
      />

      <Confirmar
        open={aEliminar != null}
        texto={`¿Eliminar la evaluación de ${aEliminar?.departamento?.nombre ?? aEliminar?.sucursal?.nombre ?? 'esta unidad'} (${new Date(`${aEliminar?.fecha}T12:00:00`).toLocaleDateString('es')})? Se borrarán sus respuestas y fotografías.`}
        onConfirm={() => void eliminar()}
        onCancel={() => setAEliminar(null)}
      />

      {/* Una sola instancia para toda la tabla: si cada fila montara su modal
          quedarían todos abiertos a la vez en el DOM. */}
      <SelectorPdf
        abierto={!!elegirEn}
        onClose={() => setElegirEn(null)}
        modulos={modulosDeElegir}
        cargandoModulos={cargandoModulosElegir}
        onConfirmar={(impresion) => {
          const objetivo = (evals ?? []).find((ev) => ev.id === elegirEn)
          if (objetivo) void descargar(objetivo, impresion)
        }}
        descargando={!!descargando}
      />

      {/* Selector de cargos del reporte por cargo: la lista sale de lo que
          `prepararCargos` calculó al tocar la opción en la fila. También una
          sola instancia para la tabla entera. */}
      <SelectorReporteCargo
        abierto={cargosEn != null}
        onClose={() => setCargosEn(null)}
        cargos={cargosEn?.cargos ?? []}
        onDescargar={(elegidos, formato) => void descargarPorCargos(elegidos, formato)}
        generando={generandoReporte}
      />
    </div>
  )
}