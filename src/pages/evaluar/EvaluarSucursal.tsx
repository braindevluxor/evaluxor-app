import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Camera, Check, CircleHelp, CloudOff, FolderOpen, List, Plus, RefreshCw, Tag, Trash2, X } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useModulosActivos, useCatalog } from '../../context/CatalogContext'
import { useOffline } from '../../context/OfflineContext'
import { hijosOrdenados } from '../../lib/hierarchy'
import { claveRespuesta, pasosDeModulo, raicesDeModulo } from '../../lib/pasos'
import { tieneRespuesta } from '../../lib/scoring'
import { causaSubida, detalleTecnico, mensajeSubida, type FallaGuardado } from '../../lib/subida'
import {
  getDraft,
  putDraft,
  normalizarClave,
  instanciasPlanasDe,
  type DraftEval,
  type DraftInstancia
} from '../../lib/offline/db'
import { guardarBorradorNube, instanciasDeDraft, respuestasConInstancia, type Descarte } from '../../lib/offline/sync'
import { listarEvaluacionesActivas, listarRespuestasEvaluacion, listarInstanciasEvaluacion } from '../../lib/data/indicadores'
import { fusionarRespuestasNube } from '../../lib/offline/fusion'
import { apiDisponible, esColorHex, etiquetaDeCampo, formatearValorConsulta, seleccionarValores } from '../../lib/data/apis'
import { supabase } from '../../lib/supabase'
import { ItemRenderer } from '../../components/ItemRenderer'
import { ReportarIncidencia } from '../../components/ReportarIncidencia'
import { Button, EmptyState, Modal, Spinner, cn } from '../../components/ui'
import { BarcodeScanner } from '../../components/BarcodeScanner'
import { MobileLayout } from '../../components/layouts/MobileLayout'
import { yaExisteRegistroConEtiqueta } from '../../lib/registro'
import type { Item } from '../../lib/types'

interface RegistroActivo {
  seccionId: string
  instanciaId: string
  etiqueta: string
}

export function EvaluarSucursal() {
  // Dos rutas posibles: /evaluar/:sucursalId y /evaluar/departamento/:departamentoId.
  const { sucursalId = '', departamentoId = '' } = useParams()
  /** Unidad evaluada: sucursal o departamento. Es la clave del borrador. */
  const unidadId = sucursalId || departamentoId
  /** Ruta base de ESTA evaluación, para volver al resumen sin importar la clase. */
  const rutaBase = departamentoId ? `/evaluar/departamento/${departamentoId}` : `/evaluar/${sucursalId}`
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { online, pendientes, sync: syncCola } = useOffline()
  const { modulosActivos, itemsDe } = useModulosActivos(sucursalId, departamentoId)
  const { sucursales, departamentos } = useCatalog()
  const sucursal = sucursales.find((s) => s.id === sucursalId)
  const departamento = departamentos.find((d) => d.id === departamentoId)

  // Ítems de módulos "Compartido": solo de ellos se fusiona el avance del otro
  // evaluador. Los módulos no compartidos son exclusivos de un evaluador.
  const itemsCompartidos = useMemo(() => {
    const ids = new Set<string>()
    for (const m of modulosActivos) {
      if (!m.compartido) continue
      for (const it of itemsDe(m)) ids.add(it.id)
    }
    return ids
  }, [modulosActivos, itemsDe])

  // Etiqueta de cada ítem, para nombrar en el aviso los que ya no existen en el
  // catálogo: un UUID no le dice nada a quien tiene que avisarle al Líder.
  const etiquetaDeItem = useMemo(() => {
    const mapa = new Map<string, string>()
    for (const mod of modulosActivos) for (const it of itemsDe(mod)) mapa.set(it.id, it.texto)
    return mapa
  }, [modulosActivos, itemsDe])

  const [draft, setDraft] = useState<DraftEval | null>(null)
  const [sinActiva, setSinActiva] = useState(false)
  const [cargando, setCargando] = useState(true)
  const [navAbierta, setNavAbierta] = useState(false)
  const [modulosAbierta, setModulosAbierta] = useState(false)
  const [idxModulo, setIdxModulo] = useState(() => {
    const raw = sessionStorage.getItem(`evx:${unidadId}:mod`)
    return raw ? Number(raw) : 0
  })
  const [idxItem, setIdxItem] = useState(() => {
    const raw = sessionStorage.getItem(`evx:${unidadId}:item`)
    const n = raw ? Number(raw) : 0
    return Number.isFinite(n) && n >= 0 ? n : 0
  })
  // Sub-flujo dentro de una sección repetible: qué registro está evaluando y en qué ítem va.
  const [registro, setRegistro] = useState<RegistroActivo | null>(null)
  const [idxRegistro, setIdxRegistro] = useState(0)
  const [etiquetaNueva, setEtiquetaNueva] = useState('')
  const [focoEtiqueta, setFocoEtiqueta] = useState(0)
  // Consulta a la API configurada en la sección (vehículos / productos / trabajadores).
  const [codigoConsulta, setCodigoConsulta] = useState('')
  const [consultando, setConsultando] = useState(false)
  const [resultadoConsulta, setResultadoConsulta] = useState<{ etiqueta: string; datos: Record<string, unknown> } | null>(null)
  const [mensajeConsulta, setMensajeConsulta] = useState<string | null>(null)
  const [scanAbierto, setScanAbierto] = useState(false)
  const [confirmarBorrar, setConfirmarBorrar] = useState<string | null>(null)
  const [evaluacionId, setEvaluacionId] = useState<string | null>(null)
  // Botón de sincronización: subida de lo pendiente + bajada de los datos frescos.
  const [sincronizando, setSincronizando] = useState(false)
  const [avisoSync, setAvisoSync] = useState<{ texto: string; ok: boolean } | null>(null)
  const etiquetaInputRef = useRef<HTMLInputElement | null>(null)

  const guardadoRef = useRef<Map<string, number>>(new Map())
  const evaluacionIdRef = useRef<string | null>(null)
  const draftRef = useRef<DraftEval | null>(null)
  const nubeTimer = useRef<number | null>(null)
  const guardadoNubeRef = useRef<Promise<Descarte> | null>(null)
  const guardadoNubePendienteRef = useRef(false)
  const ultimaSubidaNubeRef = useRef<{ evaluacionId: string; draft: DraftEval; descarte: Descarte } | null>(null)
  const lecturaNubeRef = useRef<Promise<boolean> | null>(null)
  const lecturaNubePendienteRef = useRef(false)
  // Última `sincronizar` (bajada de lo del otro evaluador). Se guarda en un ref
  // para poder pedirla desde callbacks que se declaran antes que ella, sin
  // depender de su identidad en cada efecto.
  const sincronizarRef = useRef<() => Promise<boolean>>(() => Promise.resolve(false))
  // Fallo de la última subida, con su causa real (`sin_conexion`, `rechazada` por
  // RLS, `servidor`...). Antes era un booleano que siempre terminaba diciendo
  // "revisá tu conexión", con reintento cada 12 s pase lo que pase.
  // `explicacion` viene cuando el servidor pudo decir QUÉ regla de RLS falló
  // (ver lib/permisos-guardado.ts): sin eso el mensaje tiene que adivinar.
  const [fallaSubida, setFallaSubida] = useState<FallaGuardado | null>(null)
  // Respuestas que el servidor aceptó salvo las de ítems que ya no existen o que
// el evaluador ya no puede escribir: el resto del avance sí subió, pero esto no
// lo digan como un todo o menos. Los motivos cambian lo que hay que hacer.
const [descarte, setDescarte] = useState<Descarte>({ item_ids: [], motivos: [] })
  // El descarte por permiso se explica distinto al descarte por ítem borrado: en
  // el primero el Líder tiene que revisar una asignación, no un ítem del cuestionario.
  const sinPermisoDescarte = descarte.motivos.includes('sin_permiso')
  // Marca que la página sigue montada: las fusiones con la nube no tocan el estado si ya no lo están.
  const vivoRef = useRef(false)

  function guardarDraftActualEnNube(): Promise<Descarte> {
    if (guardadoNubeRef.current) {
      guardadoNubePendienteRef.current = true
      return guardadoNubeRef.current
    }

    const guardarCambios = async () => {
      let resultado: Descarte = { item_ids: [], motivos: [] }
      do {
        guardadoNubePendienteRef.current = false
        const snapshot = draftRef.current
        const evId = evaluacionIdRef.current
        if (!snapshot || !evId) return resultado
        const anterior = ultimaSubidaNubeRef.current
        if (anterior?.evaluacionId === evId && anterior.draft === snapshot) return anterior.descarte
        const respuestas = respuestasConInstancia(snapshot)
        const instancias = instanciasDeDraft(snapshot)
        if (!respuestas.length && !instancias.length) return resultado
        try {
          resultado = await guardarBorradorNube(evId, snapshot.evaluador_id, respuestas, instancias)
          ultimaSubidaNubeRef.current = { evaluacionId: evId, draft: snapshot, descarte: resultado }
        } catch (error) {
          if (draftRef.current !== snapshot || guardadoNubePendienteRef.current) continue
          throw error
        }
        if (draftRef.current !== snapshot) guardadoNubePendienteRef.current = true
      } while (guardadoNubePendienteRef.current)
      return resultado
    }

    const guardado = guardarCambios().finally(() => {
      if (guardadoNubeRef.current === guardado) guardadoNubeRef.current = null
    })
    guardadoNubeRef.current = guardado
    return guardado
  }

  useEffect(() => {
    if (!avisoSync) return
    const t = window.setTimeout(() => setAvisoSync(null), 6000)
    return () => window.clearTimeout(t)
  }, [avisoSync])

  function agendarNube() {
    if (nubeTimer.current) window.clearTimeout(nubeTimer.current)
    nubeTimer.current = window.setTimeout(() => {
      const d = draftRef.current
      const evId = evaluacionIdRef.current
      if (!d || !evId) return
      if (!online) {
        setFallaSubida({ causa: 'sin_conexion', detalle: 'El navegador reporta que no hay conexión.' })
        return
      }
      const respuestas = respuestasConInstancia(d)
      const instancias = instanciasDeDraft(d)
      if (!respuestas.length && !instancias.length) return
      void guardarDraftActualEnNube()
        .then((r) => {
          setFallaSubida(null)
          setDescarte(r)
          // Tras cada subida se baja lo que hay en la nube: al subir, el servidor
          // fusiona lo mío con lo del otro evaluador, así que la lista recién ahí
          // tiene los productos que escaneó el otro (y el realtime solo avisa, no
          // garantiza que el canal esté vivo).
          void sincronizarRef.current()
        })
        .catch((e: unknown) => setFallaSubida({ causa: causaSubida(e), detalle: detalleTecnico(e) }))
    }, 800)
  }

  useEffect(() => {
    if (draft) draftRef.current = draft
  }, [draft])

  useEffect(() => {
    const flush = () => {
      const d = draftRef.current
      const evId = evaluacionIdRef.current
      if (!d) return
      void putDraft(d)
      if (!evId) return
      const respuestas = respuestasConInstancia(d)
      const instancias = instanciasDeDraft(d)
      if (!respuestas.length && !instancias.length) return
      void guardarDraftActualEnNube().catch(() => undefined)
    }
    window.addEventListener('beforeunload', flush)
    return () => {
      vivoRef.current = false
      flush()
      window.removeEventListener('beforeunload', flush)
      if (nubeTimer.current) window.clearTimeout(nubeTimer.current)
    }
  }, [])

  useEffect(() => {
    if (!online) {
      setFallaSubida({ causa: 'sin_conexion', detalle: 'El navegador reporta que no hay conexión.' })
      return
    }
    const d = draftRef.current
    const evId = evaluacionIdRef.current
    if (!d || !evId) {
      setFallaSubida(null)
      return
    }
    const respuestas = respuestasConInstancia(d)
    const instancias = instanciasDeDraft(d)
    if (!respuestas.length && !instancias.length) {
      setFallaSubida(null)
      return
    }
    void guardarDraftActualEnNube()
      .then((r) => {
        setFallaSubida(null)
        setDescarte(r)
        // Vuelve la conexión: además de subir lo que quedó guardado, hay que bajar
        // lo que escaneó el otro mientras no había señal (el realtime no repite los
        // eventos que se perdió).
        void sincronizarRef.current()
      })
      .catch((e: unknown) => setFallaSubida({ causa: causaSubida(e), detalle: detalleTecnico(e) }))
  }, [online])

  // Reintento automático mientras el avance no llegue a la nube. El intervalo
  // depende de la causa: 12 s para un corte de internet, pero 2 min si el
  // servidor rechazó el guardado (RLS), porque ahí reintentar cada 12 s no
  // servía de nada y solo saturaba el servidor.
  useEffect(() => {
    if (!fallaSubida || !online) return
    // Sin reintento no hay intervalo: con `cadaMs: 0` el `setInterval` disparaba
    // sin pausa y machacaba el servidor con un rechazo que nunca va a pasar.
    if (!mensajeSubida(fallaSubida.causa).reintentar) return
    const cada = mensajeSubida(fallaSubida.causa).cadaMs
    const t = window.setInterval(() => {
      const d = draftRef.current
      const evId = evaluacionIdRef.current
      if (!d || !evId) return
      const respuestas = respuestasConInstancia(d)
      const instancias = instanciasDeDraft(d)
      if (!respuestas.length && !instancias.length) {
        setFallaSubida(null)
        return
      }
      void guardarDraftActualEnNube()
        .then(() => setFallaSubida(null))
        .catch(() => undefined) // el siguiente tick vuelve a intentar
    }, cada)
    return () => window.clearInterval(t)
  }, [fallaSubida, online])

  useEffect(() => {
    if (focoEtiqueta > 0) etiquetaInputRef.current?.focus()
  }, [focoEtiqueta])

  // Al cambiar de paso (índice de módulo/ítem) se limpia la consulta a la API de la sección anterior.
  useEffect(() => {
    setCodigoConsulta('')
    setResultadoConsulta(null)
    setMensajeConsulta(null)
    setScanAbierto(false)
  }, [idxModulo, idxItem])

  const modulos = useMemo(
    () => modulosActivos.filter((m) => itemsDe(m).some((i) => i.tipo !== 'CONTENEDOR')),
    [modulosActivos, itemsDe]
  )

  const moduloActual = modulos[Math.min(idxModulo, Math.max(0, modulos.length - 1))]
  const pasosActuales = moduloActual ? raicesDeModulo(itemsDe(moduloActual)) : []
  const pasoActual = pasosActuales[Math.min(idxItem, Math.max(0, pasosActuales.length - 1))]
  const valorRegistroNuevo = resultadoConsulta?.etiqueta ?? (codigoConsulta.trim() || etiquetaNueva.trim())
  const duplicadoRegistro = pasoActual && !pasoActual.permitir_duplicados && valorRegistroNuevo
    ? yaExisteRegistroConEtiqueta(draft?.instancias?.[pasoActual.id] ?? [], valorRegistroNuevo)
      ? 'Ya hay un registro con ese mismo valor en la lista actual.'
      : null
    : null

  useEffect(() => {
    if (!profile) return
    void (async () => {
      const activas = await listarEvaluacionesActivas().catch(() => [])
      // Si hay varias ACTIVAS para la unidad (p.ej. una vieja sin cerrar), se
      // trabaja sobre la más reciente para no abrir una evaluación anterior.
      const activa = activas
        .filter((e) => (departamentoId ? e.departamento_id === departamentoId : e.sucursal_id === sucursalId))
        .sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0))[0]
      if (!activa) {
        setSinActiva(true)
        setCargando(false)
        return
      }
      evaluacionIdRef.current = activa.id
      setEvaluacionId(activa.id)
      const existente = await getDraft(unidadId)
      // Un borrador local de OTRA evaluación (otra fecha) no debe "resurgir" en
      // la nueva evaluación de la misma unidad: se descartan sus respuestas,
      // registros y comentario para que la medición arranque de cero.
      const mismoDía = !!existente && existente.fecha === activa.fecha
      const [enNube, instanciasNube] = await Promise.all([
        listarRespuestasEvaluacion(activa.id).catch(() => []),
        listarInstanciasEvaluacion(activa.id).catch(() => [])
      ])
      const nubeMias: DraftEval['respuestas'] = {}
      for (const r of enNube) {
        if (r.respondido_por === profile.id) {
          nubeMias[claveRespuesta(r.item_id, r.instancia_id)] = { valor: r.valor, por: 'yo' }
        }
      }
      // Borradores locales antiguos: claves sin '::' se normalizan; instancias ausentes → {}.
      // Las entradas sin `por` son de este evaluador (escritas localmente antes de la colaboración en vivo).
      const respLocal: DraftEval['respuestas'] = {}
      if (mismoDía) {
        for (const [k, v] of Object.entries(existente?.respuestas ?? {})) respLocal[normalizarClave(k)] = { valor: v.valor, por: v.por ?? 'yo' }
      }
      const instanciasLocales: Record<string, DraftInstancia[]> = mismoDía ? structuredClone(existente?.instancias ?? {}) : {}
      for (const ins of instanciasNube) {
        const ya = (instanciasLocales[ins.item_id] ?? []).some((i) => i.id === ins.id)
        if (!ya) {
          (instanciasLocales[ins.item_id] ??= []).push({
            id: ins.id,
            etiqueta: ins.etiqueta,
            orden: ins.orden,
            api_id: ins.api_id ?? undefined,
            datos: (ins.datos as Record<string, unknown> | null | undefined) ?? undefined
          })
        }
      }
      // Colaboración en vivo al abrir: también hay que ver lo que el otro
      // evaluador ya respondió mientras este teléfono estaba cerrado o cargando.
      const respOtros: DraftEval['respuestas'] = {}
      for (const r of enNube) {
        if (r.respondido_por === profile.id) continue
        if (!itemsCompartidos.has(r.item_id)) continue
        const key = claveRespuesta(r.item_id, r.instancia_id)
        if (respLocal[key] || nubeMias[key]) continue // prima lo local
        respOtros[key] = { valor: r.valor, por: 'otros' }
      }
      const d: DraftEval = {
        unidad_id: unidadId,
        departamento_id: departamentoId || null,
        evaluador_id: profile.id,
        fecha: activa.fecha,
        comentario_general: mismoDía ? existente?.comentario_general ?? '' : '',
        puntuacion: mismoDía ? existente?.puntuacion ?? null : null,
        respuestas: { ...nubeMias, ...respOtros, ...respLocal },
        instancias: instanciasLocales,
        updated_at: Date.now()
      }
      await putDraft(d).catch(() => undefined)
      draftRef.current = d
      setDraft(d)
      setCargando(false)
      // Re-subida al reabrir: si quedó avance sin conexión (o con errores
      // silenciosos), se empuja a la nube apenas se carga la pantalla.
      agendarNube()
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unidadId, profile])

  // Colaboración en vivo: cuando otro evaluador guarda respuestas o registros para
  // la misma evaluación, se fusionan aquí para que los dos vean todos los productos
  // escaneados y no hagan el mismo trabajo. Lo que viene de la nube queda marcado
  // `por: 'otros'` (solo se visualiza: `respuestasConInstancia` lo excluye al
  // sincronizar/enviar) y ahora se **refresca** en cada bajada, no solo se agrega
  // la primera vez — ver `lib/offline/fusion.ts`, que también decide cuándo una
  // respuesta propia puede pisarse con la de la nube (solo en conciliación y como
  // unión por SKU). Se actualiza con el realtime, con un barrido de respaldo (60 s),
  // tras cada subida y con el botón de sincronización.
  const sincronizar = useCallback(async (): Promise<boolean> => {
    if (lecturaNubeRef.current) {
      lecturaNubePendienteRef.current = true
      return lecturaNubeRef.current
    }
    const lectura = (async (): Promise<boolean> => {
    if (!vivoRef.current) return false
    const evId = evaluacionIdRef.current
    const miId = profile?.id
    if (!evId || !miId) return false
    if (!draftRef.current) return false
    try {
      const [enNube, instanciasNube] = await Promise.all([
        listarRespuestasEvaluacion(evId).catch(() => []),
        listarInstanciasEvaluacion(evId).catch(() => [])
      ])
      if (!vivoRef.current) return false
      const actual2 = draftRef.current
      if (!actual2) return false
      // Mi borrador completo ya está en la nube: la fila de la nube me trae lo
      // mío fusionado con lo del otro (el servidor une la conciliación por SKU al
      // subir), así que recién ahí puede prevalecer sin perder nada. Con cambios
      // sin subir, manda lo local y de la nube solo se suman productos nuevos.
      const subido =
        ultimaSubidaNubeRef.current?.evaluacionId === evId &&
        ultimaSubidaNubeRef.current.draft === actual2
      const fusion = fusionarRespuestasNube({
        local: actual2.respuestas,
        nube: enNube,
        miId,
        compartidos: itemsCompartidos,
        subido
      })
      const respuestas = fusion.respuestas
      let cambio = fusion.cambio
      const instancias: Record<string, DraftInstancia[]> = structuredClone(actual2.instancias ?? {})
      for (const ins of instanciasNube) {
        if (!itemsCompartidos.has(ins.item_id)) continue
        const ya = (instancias[ins.item_id] ?? []).some((i) => i.id === ins.id)
        if (!ya) {
          ;(instancias[ins.item_id] ??= []).push({
            id: ins.id,
            etiqueta: ins.etiqueta,
            orden: ins.orden,
            api_id: ins.api_id ?? undefined,
            datos: (ins.datos as Record<string, unknown> | null | undefined) ?? undefined
          })
          cambio = true
        }
      }
      if (!cambio) return false
      const nuevo: DraftEval = { ...actual2, respuestas, instancias, updated_at: Date.now() }
      draftRef.current = nuevo
      setDraft(nuevo)
      void putDraft(nuevo).catch(() => undefined)
      return true
    } catch {
      // Sin conexión en este instante; el siguiente evento o barrido reintenta.
      return false
    }
    })()
    lecturaNubeRef.current = lectura
    try {
      return await lectura
    } finally {
      if (lecturaNubeRef.current === lectura) lecturaNubeRef.current = null
      if (lecturaNubePendienteRef.current) {
        lecturaNubePendienteRef.current = false
        void sincronizar()
      }
    }
  }, [profile?.id, itemsCompartidos])

  // Quien pidió una bajada antes de que existiera `sincronizar` (el primer push
  // diferido) usa este ref: siempre queda apuntando a la última versión.
  useEffect(() => {
    sincronizarRef.current = sincronizar
  }, [sincronizar])

  useEffect(() => {
    vivoRef.current = true
    const miId = profile?.id
    if (!online || !miId || !evaluacionId) return
    const channel = supabase
      .channel(`ev-vivo-${evaluacionId}:${miId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'respuestas', filter: `evaluacion_id=eq.${evaluacionId}` },
        () => void sincronizar()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'instancias_grupo', filter: `evaluacion_id=eq.${evaluacionId}` },
        () => void sincronizar()
      )
      .subscribe()
    const iv = window.setInterval(() => void sincronizar(), 60000)
    void sincronizar()
    return () => {
      vivoRef.current = false
      void supabase.removeChannel(channel)
      window.clearInterval(iv)
    }
  }, [evaluacionId, online, profile?.id, sincronizar])

  /**
   * Sincronización a pedido: sube lo que quedó pendiente en el dispositivo (la cola
   * offline y el borrador en la nube) y después trae las respuestas/instancias más
   * recientes del servidor. El resultado se avisa en un cartel arriba de todo.
   */
  const sincronizarAhora = async () => {
    if (sincronizando) return
    if (!online) {
      setAvisoSync({ texto: 'Sin conexión: se sincronizará al recuperar la señal.', ok: false })
      return
    }
    setSincronizando(true)
    try {
      // Se cancela el autoguardado diferido: acá se manda una sola vez.
      if (nubeTimer.current) {
        window.clearTimeout(nubeTimer.current)
        nubeTimer.current = null
      }
      let fallidos = 0
      if (pendientes > 0) fallidos = (await syncCola()).fail
      const d = draftRef.current
      const evId = evaluacionIdRef.current
      let guardado = false
      if (d && evId) {
        const respuestas = respuestasConInstancia(d)
        const instancias = instanciasDeDraft(d)
        if (respuestas.length || instancias.length) {
          const r = await guardarDraftActualEnNube()
          setFallaSubida(null)
          setDescarte(r)
          guardado = true
        }
      }
      const huboNovedad = await sincronizar()
      if (fallidos) setAvisoSync({ texto: `Tu avance se guardó, pero ${fallidos} evaluación(es) no se pudieron subir.`, ok: false })
      else if (huboNovedad) setAvisoSync({ texto: 'Listo: tu avance quedó guardado y se actualizaron los datos del otro evaluador.', ok: true })
      else if (guardado) setAvisoSync({ texto: 'Listo: tu avance quedó guardado en la nube.', ok: true })
      else setAvisoSync({ texto: 'Listo: no había nada nuevo para sincronizar.', ok: true })
    } catch (e) {
      // Se dice la causa real (el rechazo del servidor no es "revisá la conexión").
      const causa = causaSubida(e)
      setFallaSubida({ causa, detalle: detalleTecnico(e) })
      setAvisoSync({ texto: `${mensajeSubida(causa, 'sincronizar').titulo}. Tu avance sigue en el teléfono.`, ok: false })
    } finally {
      setSincronizando(false)
    }
  }

  const actual = draft!

  useEffect(() => {
    if (!modulos.length) return
    if (idxModulo >= modulos.length) setIdxModulo(modulos.length - 1)
    const raices = raicesDeModulo(itemsDe(modulos[Math.min(idxModulo, modulos.length - 1)]))
    if (idxItem >= raices.length) setIdxItem(Math.max(0, raices.length - 1))
  }, [modulos, idxModulo, idxItem, itemsDe])

  if (cargando) {
    return <MobileLayout titulo="Cargando…"><div className="py-20 text-center text-slate-400">Cargando evaluación…</div></MobileLayout>
  }

  if (sinActiva) {
    return (
      <MobileLayout titulo="Evaluación">
        <EmptyState
          title="No hay evaluación abierta"
          subtitle={departamento
            ? `El Líder aún no ha abierto la evaluación de ${departamento.nombre}. Cuando la aperture podrás llenar tus módulos.`
            : 'El Líder aún no ha abierto la evaluación de esta sucursal. Cuando la aperture podrás llenar tus módulos.'}
        />
        <div className="text-center">
          <Link to="/evaluar" className="inline-flex items-center gap-1 text-sm font-semibold text-primary"><ArrowLeft className="h-4 w-4" /> Volver</Link>
        </div>
      </MobileLayout>
    )
  }

  if (!actual) return <MobileLayout titulo="Evaluación"><div className="py-20 text-center text-slate-400">Cargando…</div></MobileLayout>

  if (!modulos.length) {
    return (
      <MobileLayout titulo="Evaluación">
        <div className="rounded-2xl bg-white p-6 text-center">
          <p className="text-slate-600">
            {profile?.rol === 'EVALUADOR'
              ? 'No tienes módulos asignados para esta evaluación. Pídele al Líder que te asigne módulos.'
              : 'La configuración de esta sucursal no deja módulos con ítems activos para evaluar. Revisa los módulos/ítems de la sucursal en Configuración o actívalos en Ítems de evaluación.'}
          </p>
          <Link to="/evaluar" className="mt-4 inline-flex items-center gap-1 font-semibold text-primary"><ArrowLeft className="h-4 w-4" /> Volver</Link>
        </div>
      </MobileLayout>
    )
  }

  const modulo = modulos[Math.min(idxModulo, modulos.length - 1)]
  const itemsModulo = itemsDe(modulo)
  const pasosRaices = raicesDeModulo(itemsModulo)
  const paso = pasosRaices[Math.min(idxItem, pasosRaices.length - 1)]
  const esSeccion = paso?.tipo === 'CONTENEDOR'
  const apiSeccion = esSeccion && paso?.api_id ? apiDisponible(paso.api_id) : undefined
  const placeholderConsulta = !apiSeccion ? '' : apiSeccion.id === 'vehiculos' ? 'Placa del vehículo (ej. ABC123)' : apiSeccion.id === 'productos' ? 'Código/SKU del producto' : 'Documento (C.I.) del trabajador'
  const ultimoPasoModulo = idxItem >= pasosRaices.length - 1
  const ultimoModulo = idxModulo >= modulos.length - 1

  const seccion = registro ? itemsModulo.find((i) => i.id === registro.seccionId) : undefined
  const hijosSeccion = registro ? hijosOrdenados(itemsModulo, registro.seccionId) : []
  const hijoActual = registro ? hijosSeccion[Math.min(idxRegistro, hijosSeccion.length - 1)] : undefined
  const instanciasDeSeccion = (seccionId: string) => actual.instancias?.[seccionId] ?? []
  const registrosSeccion = paso ? instanciasDeSeccion(paso.id) : []
  const registrosVisibles = [...registrosSeccion].reverse()
  const instanciaIndex = registro ? instanciasDeSeccion(registro.seccionId).findIndex((i) => i.id === registro.instanciaId) : -1
  const ultimoHijo = registro ? idxRegistro >= hijosSeccion.length - 1 : false

  const pasosDe = (m: typeof modulo) => pasosDeModulo(itemsDe(m), instanciasPlanasDe(actual))
  const resumir = (m: typeof modulo) => pasosDe(m).filter((p) => tieneRespuesta(p.item, actual.respuestas[p.key]?.valor)).length
  const hechoModulo = resumir(modulo)
  const totalModulo = pasosDe(modulo).length
  const pctModulo = totalModulo ? Math.round((hechoModulo / totalModulo) * 100) : 0

  const guardarPaso = (mod: number, item: number) => {
    sessionStorage.setItem(`evx:${unidadId}:mod`, String(mod))
    sessionStorage.setItem(`evx:${unidadId}:item`, String(item))
  }

  const irSiguiente = () => {
    if (registro) {
      if (!ultimoHijo) {
        setIdxRegistro(idxRegistro + 1)
      } else {
        setRegistro(null)
        setFocoEtiqueta((n) => n + 1)
      }
      return
    }
    if (!ultimoPasoModulo) {
      const n = idxItem + 1
      guardarPaso(idxModulo, n)
      setIdxItem(n)
      return
    }
    if (!ultimoModulo) {
      const n = idxModulo + 1
      guardarPaso(n, 0)
      setIdxModulo(n)
      setIdxItem(0)
      return
    }
    navigate(`${rutaBase}/resumen`)
  }

  const irAnterior = () => {
    if (registro) {
      if (idxRegistro > 0) {
        setIdxRegistro(idxRegistro - 1)
      } else {
        setRegistro(null)
      }
      return
    }
    if (idxItem > 0) {
      const n = idxItem - 1
      guardarPaso(idxModulo, n)
      setIdxItem(n)
      return
    }
    if (idxModulo > 0) {
      const n = idxModulo - 1
      const prev = raicesDeModulo(itemsDe(modulos[n])).length
      guardarPaso(n, Math.max(0, prev - 1))
      setIdxModulo(n)
      setIdxItem(Math.max(0, prev - 1))
    }
  }

  const volverSeccion = () => {
    if (!registro) return
    setRegistro(null)
    setIdxRegistro(0)
  }

  const entrarRegistro = (seccionItem: Item, ins: DraftInstancia) => {
    setRegistro({ seccionId: seccionItem.id, instanciaId: ins.id, etiqueta: ins.etiqueta })
    setIdxRegistro(0)
    setNavAbierta(false)
  }

  function cambiarValor(itemId: string, instanciaId: string | null, valor: unknown) {
    const key = claveRespuesta(itemId, instanciaId)
    const nuevo: DraftEval = {
      ...actual,
      respuestas: { ...actual.respuestas, [key]: { valor, por: 'yo' } }
    }
    draftRef.current = nuevo
    setDraft(nuevo)
    const now = Date.now()
    const ultimo = guardadoRef.current.get(key) ?? 0
    if (now - ultimo > 400) {
      void putDraft(nuevo)
      guardadoRef.current.set(key, now)
    }
    agendarNube()
  }

  function agregarRegistro() {
    if (!esSeccion) return
    const etiqueta = etiquetaNueva.trim()
    if (!etiqueta) return
    const previas = actual.instancias?.[paso.id] ?? []
    if (!paso.permitir_duplicados && yaExisteRegistroConEtiqueta(previas, etiqueta)) {
      return
    }
    const ins: DraftInstancia = { id: crypto.randomUUID(), etiqueta, orden: previas.length }
    const nuevo: DraftEval = {
      ...actual,
      instancias: { ...actual.instancias, [paso.id]: [...previas, ins] }
    }
    draftRef.current = nuevo
    setDraft(nuevo)
    setEtiquetaNueva('')
    void putDraft(nuevo)
    agendarNube()
    setRegistro({ seccionId: paso.id, instanciaId: ins.id, etiqueta })
    setIdxRegistro(0)
  }

  function consultarApi(codigoForzado?: string) {
    if (!apiSeccion || !paso) return
    const codigo = (codigoForzado ?? codigoConsulta).trim()
    if (!codigo) return
    setConsultando(true)
    setMensajeConsulta(null)
    setResultadoConsulta(null)
    void apiSeccion
      .consultar(codigo, { shopId: sucursal?.shop_id, branchId: sucursal?.branch_id })
      .then((r) => {
        if (r.mensaje) {
          setMensajeConsulta(r.mensaje)
        } else {
          setResultadoConsulta({ etiqueta: r.etiqueta, datos: seleccionarValores(paso.api_campos ?? [], r.datos) })
        }
      })
      .catch(() => setMensajeConsulta('No se pudo consultar la API. Intentá de nuevo.'))
      .finally(() => setConsultando(false))
  }

  /** Agrega el registro con los datos traídos de la API. */
  function agregarRegistroConConsulta() {
    if (!esSeccion || !paso || !resultadoConsulta) return
    const previas = actual.instancias?.[paso.id] ?? []
    if (!paso.permitir_duplicados && yaExisteRegistroConEtiqueta(previas, resultadoConsulta.etiqueta)) {
      return
    }
    const ins: DraftInstancia = {
      id: crypto.randomUUID(),
      etiqueta: resultadoConsulta.etiqueta,
      orden: previas.length,
      api_id: paso.api_id ?? undefined,
      datos: resultadoConsulta.datos
    }
    const nuevo: DraftEval = {
      ...actual,
      instancias: { ...actual.instancias, [paso.id]: [...previas, ins] }
    }
    draftRef.current = nuevo
    setDraft(nuevo)
    void putDraft(nuevo)
    agendarNube()
    setCodigoConsulta('')
    setResultadoConsulta(null)
    setMensajeConsulta(null)
    setRegistro({ seccionId: paso.id, instanciaId: ins.id, etiqueta: ins.etiqueta })
    setIdxRegistro(0)
  }

  /** Agrega el registro con solo el identificador (cuando la API no encontró nada). */
  function agregarRegistroSinDatos() {
    if (!esSeccion || !paso) return
    const etiqueta = codigoConsulta.trim()
    if (!etiqueta) return
    const previas = actual.instancias?.[paso.id] ?? []
    if (!paso.permitir_duplicados && yaExisteRegistroConEtiqueta(previas, etiqueta)) {
      return
    }
    const ins: DraftInstancia = { id: crypto.randomUUID(), etiqueta, orden: previas.length, api_id: paso.api_id ?? undefined }
    const nuevo: DraftEval = {
      ...actual,
      instancias: { ...actual.instancias, [paso.id]: [...previas, ins] }
    }
    draftRef.current = nuevo
    setDraft(nuevo)
    setCodigoConsulta('')
    setResultadoConsulta(null)
    setMensajeConsulta(null)
    void putDraft(nuevo)
    agendarNube()
    setRegistro({ seccionId: paso.id, instanciaId: ins.id, etiqueta })
    setIdxRegistro(0)
  }

  function eliminarInstancia(instanciaId: string) {
    if (!esSeccion) return
    const resto = instanciasDeSeccion(paso.id).filter((i) => i.id !== instanciaId)
    const respuestas: DraftEval['respuestas'] = {}
    for (const [k, v] of Object.entries(actual.respuestas)) {
      if (!k.endsWith(`::${instanciaId}`)) respuestas[k] = v
    }
    const nuevo: DraftEval = {
      ...actual,
      respuestas,
      instancias: { ...actual.instancias, [paso.id]: resto }
    }
    draftRef.current = nuevo
    setDraft(nuevo)
    setConfirmarBorrar(null)
    void putDraft(nuevo)
    agendarNube()
    if (online) {
      void (async () => {
        try {
          await supabase.from('instancias_grupo').delete().eq('id', instanciaId)
        } catch {
          // El borrado local ya quedó aplicado; la nube se reconcilia con el próximo envío.
        }
      })()
    }
  }

  const burbuja = (
    <button
      type="button"
      onClick={() => setModulosAbierta(true)}
      aria-label="Progreso por módulos"
      title="Progreso por módulos"
      className="flex shrink-0 items-center gap-2 rounded-full bg-white/15 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-white/25"
    >
      <span className="grid h-6 min-w-6 place-items-center rounded-full bg-white px-1 text-[11px] font-extrabold text-primary">
        {idxModulo + 1}
      </span>
      {pctModulo}%
    </button>
  )

  const botonSync = (
    <button
      type="button"
      onClick={() => void sincronizarAhora()}
      disabled={sincronizando}
      title="Sincronizar: sube lo pendiente y recarga los datos"
      aria-label="Sincronizar evaluación"
      className="relative grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 disabled:opacity-60"
    >
      <RefreshCw className={cn('h-4 w-4', sincronizando && 'animate-spin')} />
      {pendientes > 0 && !sincronizando ? (
        <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-amber-300 px-1 text-[10px] font-black text-amber-950">
          {pendientes}
        </span>
      ) : null}
    </button>
  )

  return (
    <MobileLayout
      titulo="Evaluación"
      subtitulo={`Módulo ${idxModulo + 1} de ${modulos.length} · ${new Date(`${actual.fecha}T12:00:00`).toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' })}`}
      extra={
        <>
          {botonSync}
          {burbuja}
        </>
      }
    >
      <div className="space-y-4">
        {avisoSync ? (
          <div
            className={cn(
              'flex items-start gap-2 rounded-xl border px-3 py-2 text-xs font-semibold',
              avisoSync.ok ? 'border-green-200 bg-green-50 text-green-800' : 'border-amber-200 bg-amber-50 text-amber-800'
            )}
          >
            {avisoSync.ok ? <Check className="mt-px h-4 w-4 shrink-0" /> : <X className="mt-px h-4 w-4 shrink-0" />}
            <span className="min-w-0 flex-1">{avisoSync.texto}</span>
          </div>
        ) : null}
        {descarte.item_ids.length ? (
          <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900">
            <CloudOff className="mt-px h-4 w-4 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="font-black">
                {sinPermisoDescarte ? 'Una parte del avance no te la guarda el servidor' : `${descarte.item_ids.length === 1 ? 'Una respuesta no se pudo subir' : `${descarte.item_ids.length} respuestas no se pudieron subir`}: su ítem ya no existe`}
              </p>
              <p className="mt-0.5 font-medium leading-snug">
                {sinPermisoDescarte
                  ? 'El resto del avance sí llegó al servidor. Esta parte no entra porque el servidor no te da permiso sobre ella: el ítem pudo desactivarse o el módulo pudo darte de baja el Líder.'
                  : `El resto del avance sí llegó al servidor. Se borró ${descarte.item_ids.length === 1 ? 'el ítem' : 'algún ítem'} del cuestionario después de que lo respondieras, así que esa respuesta ya no tiene dónde ir. Avisale al Líder.`}
              </p>
              <p className="mt-1 break-words text-[11px] font-normal text-slate-600">
                {descarte.item_ids.map((id) => etiquetaDeItem.get(id) ?? `ítem ${id.slice(0, 8)}`).join(' · ')}
              </p>
            </div>
          </div>
        ) : null}
        {online && fallaSubida ? (
          <div
            className={cn(
              'flex flex-col gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold',
              // Un rechazo del servidor no es un problema de conexión: se ve rojo
              // para que no se piense en el WiFi y conviene avisar al Líder.
              fallaSubida.causa === 'rechazada' ? 'border-red-300 bg-red-50 text-red-900' : 'border-amber-300 bg-amber-50 text-amber-900'
            )}
          >
            <div className="flex items-start gap-2">
              <CloudOff className="mt-px h-4 w-4 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="font-black">
                  {/* Con `explicacion` el mensaje ya dice qué módulo falla y qué
                      hacer, y se cierra solo: el título genérico al lado repetía. */}
                  {fallaSubida.explicacion ?? (
                    <>
                      {mensajeSubida(fallaSubida.causa).titulo}: tu avance está guardado en este teléfono
                      <span className="font-medium"> pero aún no llegó a la nube.</span>
                    </>
                  )}
                </p>
                {!fallaSubida.explicacion ? (
                  <p className="mt-0.5 font-medium leading-snug">{mensajeSubida(fallaSubida.causa).ayuda}</p>
                ) : null}
                {/* Con `reintentar: false` (dato obsoleto) no hay intervalo que
                    prometer: el mensaje de ayuda ya dice que no reintenta. */}
                {mensajeSubida(fallaSubida.causa).reintentar ? (
                  <p className="mt-0.5 font-medium">
                    Se reintenta solo cada {Math.round(mensajeSubida(fallaSubida.causa).cadaMs / 1000)} s.
                  </p>
                ) : null}
                {/* Detalle crudo: con una foto de esto se puede diagnosticar sin adivinar. */}
                <p className="mt-1 break-all font-mono text-[10px] font-normal text-slate-500" title={fallaSubida.detalle}>
                  {fallaSubida.detalle}
                </p>
              </div>
              {/* Reintentar no arregla un ítem que ya no existe: ofrecer el botón
                  sería prometer algo que el servidor va a volver a rechazar. */}
              {mensajeSubida(fallaSubida.causa).reintentar ? (
                <button
                  type="button"
                  onClick={() => void sincronizarAhora()}
                  className="shrink-0 self-start font-black underline underline-offset-2"
                >
                  Reintentar
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
        {registro && seccion && hijoActual ? (
          <div>
            <div className="mb-3 flex items-center gap-2 rounded-xl border border-primary-200 bg-primary-50 px-3 py-2">
              <FolderOpen className="h-4 w-4 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-bold uppercase tracking-wide text-primary-500">Sección · Registro {instanciaIndex + 1} de {instanciasDeSeccion(registro.seccionId).length}</p>
                <p className="truncate text-sm font-bold text-primary-900">{seccion.texto} · {registro.etiqueta}</p>
              </div>
              <button onClick={volverSeccion} className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/70 text-primary-700 hover:bg-white" title="Volver a la sección" aria-label="Volver a la sección">
                <X className="h-4 w-4" />
              </button>
            </div>
            <ItemRenderer
              key={`${modulo.id}-${registro.instanciaId}-${hijoActual.id}`}
              item={hijoActual}
              index={idxRegistro}
              total={hijosSeccion.length}
              valor={actual.respuestas[claveRespuesta(hijoActual.id, registro.instanciaId)]?.valor}
              shopId={sucursal?.shop_id}
              branchId={sucursal?.branch_id}
              gerente={sucursal?.gerente?.nombre ?? null}
              evaluador={profile?.nombre || null}
              sucursalId={sucursalId}
              fechaEvaluacion={actual.fecha}
              onChange={(v) => cambiarValor(hijoActual.id, registro.instanciaId, v)}
            />
          </div>
        ) : esSeccion && paso ? (
          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center gap-2 rounded-xl border border-primary-200 bg-primary-50 px-3 py-2">
                <FolderOpen className="h-4 w-4 shrink-0 text-primary" />
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-primary-500">Sección repetible</p>
                  <p className="truncate text-sm font-bold text-primary-900">{paso.texto}</p>
                </div>
              </div>
              <div className="mt-2 flex justify-end">
                <span className="group relative inline-flex">
                  <button
                    type="button"
                    className="grid h-7 w-7 place-items-center rounded-full text-slate-400 transition-colors hover:bg-primary-50 hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary-200"
                    aria-label="Ayuda sobre los registros de esta sección"
                  >
                    <CircleHelp className="h-5 w-5" />
                  </button>
                  <span
                    role="tooltip"
                    className="pointer-events-none absolute right-0 top-full z-30 mt-2 hidden w-80 rounded-xl border border-slate-200 bg-white p-3 text-left text-xs leading-relaxed text-slate-600 shadow-lg group-hover:block group-focus-within:block"
                  >
                    {apiSeccion ? (
                      <>Esta sección se repite por <b>registro</b> y consulta la API de <b>{apiSeccion.nombre}</b>. Escribí el identificador ({placeholderConsulta}), tocá «Consultar» y guardá el registro con los datos traídos. Cada registro evalúa sus {hijosOrdenados(itemsModulo, paso.id).length} ítems.</>
                    ) : (
                      <>Esta sección se repite por <b>registro</b>. Cada registro lleva un identificador (ej. placa, código, nombre…) y evalúa sus {hijosOrdenados(itemsModulo, paso.id).length} ítems. Cuando termines uno, podés agregar otro y seguir tantas veces como necesites.</>
                    )}
                  </span>
                </span>
              </div>
            </div>

            <div className="flex flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <p className="font-bold text-primary-900">Registros</p>
                <p className="text-xs text-slate-500">{registrosSeccion.length} creado(s)</p>
              </div>

              {registrosSeccion.length === 0 ? (
                <div className="mt-3 rounded-xl border border-dashed border-slate-300 px-4 py-6 text-center text-xs text-slate-400">
                  {apiSeccion
                    ? 'Todavía no hay registros. Consultá un identificador y agregá el primero.'
                    : 'Todavía no hay registros. Escribí un identificador y tocá «Agregar registro» para evaluar el primero.'}
                </div>
              ) : (
                <ul className="mt-3 space-y-2">
                  {registrosVisibles.map((ins, i) => {
                    const hijos = hijosOrdenados(itemsModulo, paso.id)
                    const hechos = hijos.filter((h) => actual.respuestas[claveRespuesta(h.id, ins.id)]).length
                    const completo = hijos.length > 0 && hechos === hijos.length
                    return (
                      <li key={ins.id} className="flex items-center gap-2 rounded-xl border border-slate-200 p-2.5">
                        <button type="button" onClick={() => entrarRegistro(paso, ins)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                          <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-full', completo ? 'bg-green-100 text-green-700' : 'bg-primary-50 text-primary')}>
                            {completo ? <Check className="h-4 w-4" /> : <Tag className="h-4 w-4" />}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold text-slate-800">
                              Registro {i + 1} · <span className="text-primary-900">{ins.etiqueta}</span>
                            </span>
                            {apiSeccion && ins.datos && Object.keys(ins.datos).length ? (
                              <span className="mt-1 flex flex-wrap gap-1">
                                {Object.entries(ins.datos)
                                  .filter(([k]) => (paso.api_campos ?? []).includes(k))
                                  .filter(([, v]) => v != null && v !== '')
                                  .map(([k, v]) => (
                                    <span key={k} className="rounded-full bg-primary-50 px-2 py-0.5 text-[10px] font-semibold text-primary-800">
                                      {etiquetaDeCampo(paso.api_id, k)}:{' '}
                                      {k === 'color' && esColorHex(v) ? (
                                        <span className="ml-0.5 inline-block h-3.5 w-3.5 align-[-0.15em] rounded-full border border-slate-300" style={{ backgroundColor: v }} title={v} aria-label={`Color ${v}`} />
                                      ) : formatearValorConsulta(v)}
                                    </span>
                                  ))}
                              </span>
                            ) : null}
                            <span className="block text-[11px] text-slate-500">
                              {hechos}/{hijos.length} ítems {completo ? '· completo' : ''}
                            </span>
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmarBorrar(ins.id)}
                          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-slate-400 hover:bg-red-50 hover:text-red-600"
                          title="Eliminar registro"
                          aria-label={`Eliminar registro ${ins.etiqueta}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}

              {!apiSeccion && duplicadoRegistro ? (
                <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                  {duplicadoRegistro}
                </div>
              ) : null}

              {apiSeccion ? (
                <div className="order-first mt-3 space-y-2">
                  <form
                    onSubmit={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      // Leer directamente del DOM para evitar estado stale de React
                      const inputEl = e.currentTarget.querySelector('input')
                      const val = (inputEl?.value || codigoConsulta).replace(/[\r\n\t]/g, '').trim()
                      if (val && !consultando) {
                        setCodigoConsulta(val)
                        consultarApi(val)
                      }
                    }}
                    className="relative w-full"
                  >
                    <input
                      value={codigoConsulta}
                      type="search"
                      enterKeyHint="search"
                      inputMode="search"
                      autoComplete="off"
                      autoCorrect="off"
                      autoCapitalize={apiSeccion.id === 'vehiculos' ? 'characters' : 'off'}
                      spellCheck={false}
                      onChange={(e) => {
                        const raw = e.target.value
                        // Detección directa de sufijos de escáneres handheld
                        // (Enter/Tab inyectados como caracteres \n, \r o \t)
                        if (raw.includes('\n') || raw.includes('\r') || raw.includes('\t')) {
                          const limpio = raw.replace(/[\r\n\t]/g, '').trim()
                          if (limpio) {
                            setCodigoConsulta(limpio)
                            consultarApi(limpio)
                            return
                          }
                        }
                        setCodigoConsulta(raw)
                      }}
                      onKeyDown={(e) => {
                        if (
                          e.key === 'Enter' ||
                          e.keyCode === 13 ||
                          e.key === 'Tab' ||
                          e.keyCode === 9 ||
                          e.which === 13 ||
                          e.which === 9
                        ) {
                          e.preventDefault()
                          e.stopPropagation()
                          const val = (e.currentTarget.value || codigoConsulta).replace(/[\r\n\t]/g, '').trim()
                          if (val) {
                            setCodigoConsulta(val)
                            consultarApi(val)
                          }
                        }
                      }}
                      onKeyUp={(e) => {
                        if (e.key === 'Enter' || e.keyCode === 13 || e.which === 13) {
                          e.preventDefault()
                          e.stopPropagation()
                          const val = (e.currentTarget.value || codigoConsulta).replace(/[\r\n\t]/g, '').trim()
                          if (val) {
                            setCodigoConsulta(val)
                            consultarApi(val)
                          }
                        }
                      }}
                      placeholder={placeholderConsulta}
                      className={`min-w-0 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary-200 ${apiSeccion.id === 'productos' ? 'pr-11' : ''}`}
                    />
                    {apiSeccion.id === 'productos' ? (
                      <button
                        type="button"
                        onClick={() => setScanAbierto(true)}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-primary"
                        title="Escanear código de barras con la cámara"
                        aria-label="Escanear código de barras"
                      >
                        <Camera className="h-5 w-5" />
                      </button>
                    ) : null}
                  </form>
                  {mensajeConsulta ? (
                    <div className="rounded-xl bg-amber-50 px-3 py-2">
                      <p className="text-xs font-medium text-amber-800">{mensajeConsulta}</p>
                      {codigoConsulta.trim() && !duplicadoRegistro ? (
                        <Button type="button" variant="secondary" className="mt-1.5 min-h-0 px-2.5 py-1 text-xs" onClick={agregarRegistroSinDatos}>
                          <Plus className="h-3.5 w-3.5" /> Agregar registro igual (solo identificador)
                        </Button>
                      ) : null}
                    </div>
                  ) : null}

                  {duplicadoRegistro ? (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                      {duplicadoRegistro}
                    </div>
                  ) : null}

                  {resultadoConsulta ? (
                    <div className="rounded-xl border border-green-200 bg-green-50/60 p-3">
                      <p className="text-xs font-bold text-green-800">Encontrado: {resultadoConsulta.etiqueta}</p>
                      {Object.keys(resultadoConsulta.datos).length ? (
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {Object.entries(resultadoConsulta.datos).map(([k, v]) => (
                            <span key={k} className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                              {etiquetaDeCampo(paso.api_id, k)}:{' '}
                              {k === 'color' && esColorHex(v) ? (
                                <span className="ml-0.5 inline-block h-4 w-4 align-[-0.2em] rounded-full border border-slate-300" style={{ backgroundColor: v }} title={v} aria-label={`Color ${v}`} />
                              ) : formatearValorConsulta(v)}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      {!duplicadoRegistro ? (
                        <div className="mt-2 flex gap-2">
                          <Button className="shrink-0" onClick={agregarRegistroConConsulta}>
                            <Plus className="h-4 w-4" /> Agregar registro
                          </Button>
                          <Button type="button" variant="secondary" className="shrink-0" onClick={() => { setResultadoConsulta(null); setMensajeConsulta(null) }}>
                            Descartar
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  <BarcodeScanner
                    open={scanAbierto}
                    onClose={() => setScanAbierto(false)}
                    onDetect={(codigo) => {
                      setCodigoConsulta(codigo)
                      setScanAbierto(false)
                      consultarApi(codigo)
                    }}
                  />
                </div>
              ) : (
                <div className="mt-3 flex gap-2">
                  <input
                    ref={etiquetaInputRef}
                    value={etiquetaNueva}
                    onChange={(e) => setEtiquetaNueva(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        if (etiquetaNueva.trim()) agregarRegistro()
                      }
                    }}
                    placeholder="Identificador (ej. placa, código, nombre…)"
                    className="min-w-0 flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary-200"
                  />
                  <Button variant="primary" className="shrink-0" disabled={!etiquetaNueva.trim()} onClick={agregarRegistro}>
                    <Plus className="h-4 w-4" /> Agregar
                  </Button>
                </div>
              )}

            </div>
          </div>
        ) : (
          <div>
            <ItemRenderer
              key={`${modulo.id}-${paso?.id}`}
              item={paso}
              index={idxItem}
              total={pasosRaices.length}
              valor={paso ? actual.respuestas[claveRespuesta(paso.id)]?.valor : undefined}
              shopId={sucursal?.shop_id}
              branchId={sucursal?.branch_id}
              gerente={sucursal?.gerente?.nombre ?? null}
              evaluador={profile?.nombre || null}
              sucursalId={sucursalId}
              fechaEvaluacion={actual.fecha}
              onChange={(v) => cambiarValor(paso.id, null, v)}
            />
          </div>
        )}

        {/* Espacio para que la barra fija de controles no tape el último ítem. */}
        <div className="h-28" />
      </div>

      {/* Barra de controles: todo en UNA línea. Va con `gap-1 px-2` y textos
          cortos a propósito, porque en la sección repetible (que suma "Terminar"
          y "Agregar otro") son cinco botones y con los nombres largos no entran
          en un teléfono de 360 px. El `truncate` es la red de seguridad: los
          íconos nunca se encogen y la fila nunca pasa a dos alturas. */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white shadow-[0_-4px_16px_-8px_rgb(15_23_42/0.15)]">
        <div className="mx-auto flex w-full max-w-lg items-center gap-1 px-2 py-3">
          {profile ? (
            <ReportarIncidencia
              sucursalId={sucursalId}
              departamentoId={departamentoId}
              fecha={actual.fecha}
              moduloId={modulo.id}
              moduloNombre={modulo.nombre}
              evaluadorId={profile.id}
            />
          ) : null}
          <Button
            variant="secondary"
            onClick={irAnterior}
            disabled={!registro && idxModulo === 0 && idxItem === 0}
            className="min-w-0 flex-1 px-2.5 text-[13px]"
          >
            <ArrowLeft className="h-4 w-4 shrink-0" /> <span className="truncate">Anterior</span>
          </Button>
          <Button
            variant="secondary"
            className="h-11 w-11 shrink-0 px-2"
            onClick={() => setNavAbierta(true)}
            aria-label="Navegación rápida"
            title="Navegación rápida"
          >
            <List className="h-5 w-5" />
          </Button>
          {registro ? (
            ultimoHijo ? (
              <>
                <Button variant="secondary" className="min-w-0 flex-1 px-2.5 text-[13px]" onClick={volverSeccion}>
                  <span className="truncate">Terminar</span>
                </Button>
                <Button variant="primary" className="min-w-0 flex-1 px-2.5 text-[13px]" onClick={irSiguiente}>
                  <span className="truncate">Otro</span> <Plus className="h-4 w-4 shrink-0" />
                </Button>
              </>
            ) : (
              <Button variant="primary" className="min-w-0 flex-1 px-2.5 text-[13px]" onClick={irSiguiente}>
                <span className="truncate">Siguiente</span> <ArrowRight className="h-4 w-4 shrink-0" />
              </Button>
            )
          ) : !ultimoPasoModulo ? (
            <Button variant="primary" className="min-w-0 flex-1 px-2.5 text-[13px]" onClick={irSiguiente}>
              <span className="truncate">Siguiente</span> <ArrowRight className="h-4 w-4 shrink-0" />
            </Button>
          ) : !ultimoModulo ? (
            <Button variant="primary" className="min-w-0 flex-1 px-2.5 text-[13px]" onClick={irSiguiente}>
              <span className="truncate">Siguiente módulo</span> <ArrowRight className="h-4 w-4 shrink-0" />
            </Button>
          ) : (
            <Button
              variant="success"
              className="min-w-0 flex-1 px-2.5 text-[13px]"
              onClick={() => navigate(`${rutaBase}/resumen`)}
            >
              <span className="truncate">Ver resumen</span> <Check className="h-4 w-4 shrink-0" />
            </Button>
          )}
        </div>
      </div>

      <Modal open={navAbierta} onClose={() => setNavAbierta(false)} title={registro ? `${seccion?.texto ?? 'Registro'} · ${registro.etiqueta}` : `Ítems · ${modulo.nombre}`}>
        <ul className="space-y-1">
          {registro
            ? hijosSeccion.map((it, i) => {
                const clave = claveRespuesta(it.id, registro.instanciaId)
                const respondido = !!actual.respuestas[clave]
                const activo = i === idxRegistro
                return (
                  <li key={clave}>
                    <button
                      type="button"
                      onClick={() => {
                        setIdxRegistro(i)
                        setNavAbierta(false)
                      }}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-full px-3 py-2 text-left text-sm transition-colors',
                        activo ? 'bg-primary text-white' : 'text-slate-700 hover:bg-slate-50'
                      )}
                    >
                      <span className={cn('grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold', activo ? 'bg-white/20' : respondido ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500')}>
                        {respondido ? <Check className="h-3.5 w-3.5" /> : i + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{it.texto}</span>
                    </button>
                  </li>
                )
              })
            : pasosRaices.map((it, i) => {
                const clave = it.tipo === 'CONTENEDOR' ? null : claveRespuesta(it.id)
                const respondido = clave ? !!actual.respuestas[clave] : false
                const activo = i === idxItem
                const totalHijos = it.tipo === 'CONTENEDOR' ? hijosOrdenados(itemsModulo, it.id).length : 0
                return (
                  <li key={it.id}>
                    <button
                      type="button"
                      onClick={() => {
                        guardarPaso(idxModulo, i)
                        setIdxItem(i)
                        setNavAbierta(false)
                      }}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-full px-3 py-2 text-left text-sm transition-colors',
                        activo ? 'bg-primary text-white' : 'text-slate-700 hover:bg-slate-50'
                      )}
                    >
                      <span
                        className={cn(
                          'grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold',
                          activo ? 'bg-white/20' : it.tipo === 'CONTENEDOR' ? 'bg-primary-50 text-primary' : respondido ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'
                        )}
                      >
                        {it.tipo === 'CONTENEDOR' ? <FolderOpen className="h-3.5 w-3.5" /> : respondido ? <Check className="h-3.5 w-3.5" /> : i + 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        {it.tipo === 'CONTENEDOR' ? (
                          <span className={cn('mb-0.5 flex items-center gap-1 text-[10px] font-semibold', activo ? 'text-white/70' : 'text-primary-600')}>
                            Sección · {totalHijos} ítems por registro
                          </span>
                        ) : null}
                        <span className="block truncate">{it.texto}</span>
                      </span>
                      {activo ? <span className="shrink-0 text-xs font-semibold">Actual</span> : null}
                    </button>
                  </li>
                )
              })}
        </ul>
        <p className="mt-3 text-center text-xs text-slate-400">Toca un elemento para ir directo a él.</p>
      </Modal>

      <Modal open={modulosAbierta} onClose={() => setModulosAbierta(false)} title="Módulos de la evaluación">
        <ul className="space-y-1">
          {modulos.map((m, i) => {
            const total = pasosDe(m).length
            const hecho = resumir(m)
            const pct = total ? Math.round((hecho / total) * 100) : 0
            const activo = i === idxModulo
            const completo = total > 0 && hecho === total
            return (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => {
                    guardarPaso(i, 0)
                    setIdxModulo(i)
                    setIdxItem(0)
                    if (registro) setRegistro(null)
                    setModulosAbierta(false)
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-full px-3 py-2 text-left text-sm transition-colors',
                    activo ? 'bg-primary text-white' : 'text-slate-700 hover:bg-slate-50'
                  )}
                >
                  <span
                    className={cn(
                      'grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold',
                      activo ? 'bg-white/20' : completo ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'
                    )}
                  >
                    {!activo && completo ? <Check className="h-3.5 w-3.5" /> : i + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{m.nombre}</span>
                    <span className={cn('block text-[11px]', activo ? 'text-white/70' : 'text-slate-400')}>
                      {hecho}/{total} ítems · {pct}%
                    </span>
                  </span>
                  {activo ? <span className="shrink-0 text-xs font-semibold">Actual</span> : null}
                </button>
              </li>
            )
          })}
        </ul>
        <p className="mt-3 text-center text-xs text-slate-400">Toca un módulo para ir directo a él.</p>
      </Modal>

      <Modal
        open={!!confirmarBorrar}
        onClose={() => setConfirmarBorrar(null)}
        title="Eliminar registro"
        footer={
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setConfirmarBorrar(null)}>Cancelar</Button>
            <Button variant="danger" className="flex-1" onClick={() => confirmarBorrar && eliminarInstancia(confirmarBorrar)}>
              Eliminar
            </Button>
          </div>
        }
      >
        <p className="text-sm text-slate-600">
          Se eliminará este registro y todas sus respuestas. Esta acción no se puede deshacer.
        </p>
      </Modal>
    </MobileLayout>
  )
}