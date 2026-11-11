import { useCallback, useEffect, useMemo, useState } from 'react'
import { Pencil, Plus, Power, RefreshCw, Trash2 } from 'lucide-react'
import { avisar } from '../../lib/aviso'
import {
  Badge,
  Button,
  ButtonIcon,
  Confirmar,
  EmptyState,
  Field,
  Input,
  Modal,
  Select,
  Spinner,
  cn
} from '../../components/ui'
import { PortalCabecera } from '../../components/PortalCabecera'
import {
  actualizarNominaAhora,
  cargarNomina,
  departamentosSePisan,
  etiquetaFrescura,
  etiquetaPeriodo,
  eliminarBonoCargo,
  gastoDeCargo,
  generarPagos,
  guardarBonoCargo,
  guardarNotaPago,
  listarBonosCargo,
  listarPagos,
  marcarPagado,
  montoACobrar,
  nominaDesactualizada,
  ocupantesDeCargo,
  periodoDe,
  periodosRecientes,
  sucursalesTomadas,
  volverAPendiente,
  cedulaDe,
  type BonoCargo,
  type BonoCargoSucursal,
  type BonoPago,
  type Periodicidad
} from '../../lib/data/bonos'
import type { ColaboradorAPI } from '../../lib/data/colaboradores'
import { claveNormalizada, listarResponsables, type ResponsableCatalogo } from '../../lib/data/responsables'
import { BRANCH_CENTRAL } from '../../lib/data/responsablesIncidencia'
import { listarSucursalesAdmin, type SucursalVista } from '../../lib/data/catalog'

/**
 * Bonos por desempeño: QUÉ cargos gozan de bono y QUIÉN lo cobra.
 *
 * Dos pestañas con dos responsabilidades distintas:
 *
 *  - **Cargos** es la configuración: qué puesto cobra, cuánto, con qué nota
 *    mínima (umbral) y cada cuánto (mensual o trimestral). Se congela acá y
 *    no se toca más al generar un pago.
 *  - **Pagos** es la gestión: por período, con la nómina de las sucursales
 *    generada de un saque y luego una fila por persona, con su nota cargada a
 *    mano y su monto calculado con la regla del umbral (`montoACobrar`).
 *
 * Entra el LÍDER y el GERENTE DE TALENTO HUMANO: la misma cerradura en la
 * ruta (`RequireRol`) y en el RLS (`puede_bonos`).
 */

type Pestana = 'cargos' | 'pagos'

const HOY = () => new Date()

function fechaHoy(): string {
  const d = HOY()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** La fecha como se lee en la fila: `12/11/2026`. */
function fechaCorta(iso: string | null): string {
  if (!iso) return ''
  const [a, m, d] = iso.split('-')
  if (!a || !m || !d) return iso
  return `${d}/${m}/${a}`
}

/** La nota vigente de una fila: lo que se escribió y todavía no se guardó manda. */
function notaVigente(p: BonoPago, bruto: string | undefined): number | null {
  if (bruto === undefined) return p.nota
  const t = bruto.trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : p.nota
}

const FORM_VACIO = {
  cargo: '',
  monto: '',
  nota_minima: '70',
  periodicidad: 'MENSUAL' as Periodicidad,
  activo: true,
  departamento: ''
}

export function BonosPage() {
  const [pestana, setPestana] = useState<Pestana>('cargos')

  // --- Cargos (configuración) ---
  const [cargos, setCargos] = useState<BonoCargo[]>([])
  const [cargandoCargos, setCargandoCargos] = useState(true)
  const [modalAbierto, setModalAbierto] = useState(false)
  const [editando, setEditando] = useState<BonoCargo | null>(null)
  const [form, setForm] = useState(FORM_VACIO)
  const [guardandoCargo, setGuardandoCargo] = useState(false)
  const [aBorrar, setABorrar] = useState<BonoCargo | null>(null)
  /** El cargo cuyo listado de ocupantes se está mirando (el «¿quiénes son?»). */
  const [detalleCargos, setDetalleCargos] = useState<BonoCargo | null>(null)
  /** El cargo cuyo alcance se está mirando (el «¿en qué tiendas?»). */
  const [detalleAlcance, setDetalleAlcance] = useState<BonoCargo | null>(null)
  /**
   * El catálogo de la nómina (departamento + cargo) de todas las sucursales:
   * de acá salen las sugerencias del campo «Cargo» y las del «Departamento».
   */
  const [catalogo, setCatalogo] = useState<ResponsableCatalogo[]>([])
  // Las sucursales ACTIVAS, para el selector de alcance del modal y para
  // traducir ids a nombres en la tabla.
  const [sucursales, setSucursales] = useState<SucursalVista[]>([])
  /** Las ACTIVAS: son las que entran al conteo, a los pagos y al selector. */
  const sucursalesActivas = useMemo(() => sucursales.filter((s) => s.activa), [sucursales])
  // El alcance que se está editando: sin esto el bono es «todas».
  const [especifico, setEspecifico] = useState(false)
  /** sucursal_id → monto de ESA sucursal (lo que se guardaría en la fila). */
  const [porSucursal, setPorSucursal] = useState<Record<string, string>>({})
  // La nómina por sucursal: de acá salen los OCUPANTES de cada cargo, con
  // los que se proyecta el gasto total antes de generar un solo pago.
  const [nomina, setNomina] = useState<Map<string, ColaboradorAPI[]> | null>(null)
  const [nominaCargando, setNominaCargando] = useState(false)
  /** Sucursales cuya nómina no se pudo leer: avisa que el gasto está incompleto. */
  const [nominaFallo, setNominaFallo] = useState<string[]>([])
  /** Activas SIN ID de trabajadores: quedan fuera del conteo y hay que decirlo. */
  const [nominaSinId, setNominaSinId] = useState<string[]>([])
  /** Inactivas en Unidades: tampoco cuentan. */
  const [nominaInactivas, setNominaInactivas] = useState<string[]>([])
  /** De dónde salió la nómina: la tabla espejo o la API en vivo. */
  const [nominaFuente, setNominaFuente] = useState<'local' | 'api' | null>(null)
  /** Última actualización de la tabla espejo. */
  const [nominaActualizado, setNominaActualizado] = useState<string | null>(null)
  /** Se incrementa para releer la nómina (después de un «Actualizar ahora»). */
  const [nominaVersion, setNominaVersion] = useState(0)
  const [actualizando, setActualizando] = useState(false)

  // --- Pagos (gestión) ---
  const [periodicidad, setPeriodicidad] = useState<Periodicidad>('MENSUAL')
  const [periodo, setPeriodo] = useState(() => periodoDe(HOY(), 'MENSUAL'))
  const [pagos, setPagos] = useState<BonoPago[]>([])
  const [cargandoPagos, setCargandoPagos] = useState(false)
  const [filtro, setFiltro] = useState<'TODOS' | 'PENDIENTE' | 'PAGADO'>('TODOS')
  const [busqueda, setBusqueda] = useState('')
  const [notas, setNotas] = useState<Record<string, string>>({})
  const [guardandoId, setGuardandoId] = useState<string | null>(null)
  const [aPagar, setAPagar] = useState<BonoPago | null>(null)
  const [generando, setGenerando] = useState(false)

  const cargarCargos = useCallback(async () => {
    try {
      setCargos(await listarBonosCargo())
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'No se pudieron cargar los cargos con bono.', 'error')
    } finally {
      setCargandoCargos(false)
    }
  }, [])

  useEffect(() => {
    void cargarCargos()
  }, [cargarCargos])

  // Las sugerencias del campo «Cargo» salen de la nómina real: lo que se
  // escribe acá es lo que después se va a cruzar contra los `role_name` de
  // los colaboradores, así que conviene mostrar cómo se escriben.
  useEffect(() => {
    let vivo = true
    void (async () => {
      try {
        const lista = await listarSucursalesAdmin()
        if (!vivo) return
        setSucursales(lista)
        // `branch_id` primero: es el ID en la API de trabajadores; el
        // `shop_id` es el Nº tienda para escanear productos y manda a otra
        // tienda.
        const branches = lista
          .map((s) => (s.branch_id ?? s.shop_id ?? '').trim())
          .filter(Boolean)
        const r = await listarResponsables([...branches, BRANCH_CENTRAL])
        if (vivo && !r.mensaje) setCatalogo(r.responsables)
      } catch {
        // Sin sugerencias se sigue pudiendo escribir a mano: no es un error.
      }
    })()
    return () => {
      vivo = false
    }
  }, [])

  // La nómina sólo hace falta en la pestaña de Cargos: es la que cuenta los
  // ocupantes de cada cargo para proyectar su gasto. Primero se lee la tabla
  // espejo (la refresca el cron diario) y sólo si está vacía se cae a la API
  // en vivo. Todo lo que no entró sale con su motivo —caída, sin ID o
  // inactiva— para avisar que el número está incompleto en vez de pintarlo
  // de más bajo en silencio.
  useEffect(() => {
    if (pestana !== 'cargos' || !sucursales.length) return
    let vivo = true
    setNominaCargando(true)
    void cargarNomina(sucursales)
      .then(({ porSucursal, fallos, sinId, inactivas, fuente, actualizado_en }) => {
        if (!vivo) return
        setNomina(porSucursal)
        setNominaFallo(fallos)
        setNominaSinId(sinId)
        setNominaInactivas(inactivas)
        setNominaFuente(fuente)
        setNominaActualizado(actualizado_en)
      })
      .catch(() => {
        if (!vivo) return
        setNomina(new Map())
        setNominaFallo([])
        setNominaSinId([])
        setNominaInactivas([])
        setNominaFuente(null)
        setNominaActualizado(null)
      })
      .finally(() => {
        if (vivo) setNominaCargando(false)
      })
    return () => {
      vivo = false
    }
  }, [pestana, sucursales, nominaVersion])

  const cargarPagos = useCallback(async () => {
    setCargandoPagos(true)
    try {
      setPagos(await listarPagos(periodo))
      setNotas({})
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'No se pudieron cargar los pagos.', 'error')
    } finally {
      setCargandoPagos(false)
    }
  }, [periodo])

  useEffect(() => {
    if (pestana !== 'pagos') return
    void cargarPagos()
  }, [pestana, cargarPagos])

  const cambiarPeriodicidad = (p: Periodicidad) => {
    setPeriodicidad(p)
    setPeriodo(periodoDe(HOY(), p))
    setFiltro('TODOS')
  }

  /* --- La pestaña de Cargos ------------------------------------------------ */

  function abrirNuevo() {
    setEditando(null)
    setForm(FORM_VACIO)
    setEspecifico(false)
    setPorSucursal({})
    setModalAbierto(true)
  }

  function abrirEdicion(c: BonoCargo) {
    setEditando(c)
    setForm({
      cargo: c.cargo,
      monto: String(c.monto),
      nota_minima: String(c.nota_minima),
      periodicidad: c.periodicidad,
      activo: c.activo,
      departamento: c.departamento ?? ''
    })
    // El alcance guardado manda: hay filas = «sólo estas»; sin filas = «todas».
    setEspecifico(c.sucursales.length > 0)
    setPorSucursal(
      Object.fromEntries(c.sucursales.map((s) => [s.sucursal_id, s.monto != null ? String(s.monto) : String(c.monto)]))
    )
    setModalAbierto(true)
  }

  async function guardar() {
    const monto = Number(form.monto)
    const notaMinima = Number(form.nota_minima)
    if (!form.cargo.trim()) {
      avisar('Escribí el nombre del cargo.', 'aviso')
      return
    }
    if (!Number.isFinite(monto) || monto < 0) {
      avisar('El monto del bono no puede ser negativo.', 'aviso')
      return
    }
    if (!Number.isFinite(notaMinima) || notaMinima < 0 || notaMinima > 100) {
      avisar('La nota mínima va de 0 a 100.', 'aviso')
      return
    }
    // El alcance: sin marcas el bono es «todas»; marcadas, sólo esas y cada
    // una con su monto (vacío o no numérico no pasa: se avisa y no se guarda).
    const alcance: { sucursal_id: string; monto: number }[] = []
    if (especifico) {
      const entradas = Object.entries(porSucursal)
      if (!entradas.length) {
        avisar('Marcá al menos una sucursal, o dejá el alcance en «todas».', 'aviso')
        return
      }
      for (const [sucursal_id, bruto] of entradas) {
        const montoSucursal = Number(bruto)
        if (!Number.isFinite(montoSucursal) || montoSucursal < 0) {
          avisar('El monto por sucursal no puede ser negativo.', 'aviso')
          return
        }
        alcance.push({ sucursal_id, monto: montoSucursal })
      }
    }
    // La regla de NO SOLAPE, con nombres de sucursal para que el aviso se
    // entienda: el mismo cargo puede repetirse, pero nunca compartiendo
    // sucursales NI departamento. La misma regla la vuelve a chequear la
    // capa de datos.
    const clave = claveNormalizada(form.cargo)
    const departamento = form.departamento.trim() || null
    const rotulo = departamento ? `«${form.cargo}» (${departamento})` : `«${form.cargo}»`
    const conflicto = sucursalesTomadas(cargos, clave, alcance, editando?.id, departamento)
    if (conflicto.todas) {
      const otroTodas = cargos.some(
        (c) =>
          c.clave === clave &&
          c.id !== editando?.id &&
          c.sucursales.length === 0 &&
          departamentosSePisan(c.departamento, departamento)
      )
      avisar(
        otroTodas
          ? `${rotulo} ya está configurado para TODAS las sucursales: editá esa fila en vez de crear otra.`
          : `${rotulo} ya está configurado en sucursales específicas: no se puede repetir el cargo como «todas». Marcá sólo las que falten o editá la fila existente.`,
        'aviso'
      )
      return
    }
    if (conflicto.ids.length) {
      const nombres = new Map(sucursales.map((s) => [s.id, s.nombre]))
      avisar(
        `${rotulo} ya está configurado en: ${conflicto.ids
          .map((id) => nombres.get(id) ?? id)
          .join(', ')}. No se registra dos veces el mismo cargo en la misma sucursal.`,
        'aviso'
      )
      return
    }
    setGuardandoCargo(true)
    try {
      await guardarBonoCargo({
        id: editando?.id,
        cargo: form.cargo,
        activo: form.activo,
        monto,
        nota_minima: notaMinima,
        periodicidad: form.periodicidad,
        departamento,
        sucursales: alcance
      })
      avisar(editando ? 'Cargo actualizado.' : 'Cargo con bono creado.')
      setModalAbierto(false)
      await cargarCargos()
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'No se pudo guardar el cargo.', 'error')
    } finally {
      setGuardandoCargo(false)
    }
  }

  /* --- El alcance del cargo (el conjunto de sucursales) ------------------- */

  /** Le pide a la Edge Function que refresque la tabla espejo, ahora. */
  async function actualizarNomina() {
    setActualizando(true)
    try {
      const r = await actualizarNominaAhora()
      const partes = [`${r.trabajadores} trabajadores en ${r.sucursales_ok} sucursales`]
      if (r.fallos.length) partes.push(`no se pudo leer: ${r.fallos.join(', ')}`)
      if (r.sin_id_nombres.length) partes.push(`sin ID de trabajadores: ${r.sin_id_nombres.join(', ')}`)
      avisar(`Nómina actualizada — ${partes.join(' · ')}.`, r.sucursales_fallo || r.sin_id ? 'aviso' : 'ok')
      setNominaVersion((v) => v + 1)
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'No se pudo actualizar la nómina.', 'error')
    } finally {
      setActualizando(false)
    }
  }

  function alternarSucursal(sucursalId: string) {
    setPorSucursal((prev) => {
      const next = { ...prev }
      if (sucursalId in next) {
        delete next[sucursalId]
      } else {
        // Arranca con el monto base del cargo: es lo que casi siempre se
        // quiere cuando se arma el conjunto, y se cambia de una en una.
        next[sucursalId] = form.monto.trim() || '0'
      }
      return next
    })
  }

  function marcarTodas() {
    setPorSucursal(Object.fromEntries(sucursalesActivas.map((s) => [s.id, form.monto.trim() || '0'])))
  }

  async function alternarActivo(c: BonoCargo) {
    try {
      await guardarBonoCargo({
        id: c.id,
        cargo: c.cargo,
        activo: !c.activo,
        monto: c.monto,
        nota_minima: c.nota_minima,
        periodicidad: c.periodicidad,
        departamento: c.departamento,
        // El alcance se reenvía tal cual: apagar un cargo no cambia DÓNDE se
        // paga, sólo si se paga.
        sucursales: c.sucursales
      })
      setCargos((prev) => prev.map((x) => (x.id === c.id ? { ...x, activo: !c.activo } : x)))
      avisar(c.activo ? `«${c.cargo}» queda inactivo: no genera más pagos.` : `«${c.cargo}» vuelve a generar pagos.`)
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'No se pudo cambiar el cargo.', 'error')
    }
  }

  async function borrar() {
    if (!aBorrar) return
    try {
      await eliminarBonoCargo(aBorrar.id)
      avisar('Cargo eliminado, con sus pagos.')
      setABorrar(null)
      await cargarCargos()
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'No se pudo eliminar el cargo.', 'error')
    }
  }

  /* --- La pestaña de Pagos ------------------------------------------------- */

  async function generar() {
    setGenerando(true)
    try {
      const r = await generarPagos(periodo, periodicidad)
      avisar(
        r.creados
          ? `Se generaron ${r.creados} pago${r.creados === 1 ? '' : 's'} para ${etiquetaPeriodo(periodo)}.`
          : 'Ya estaban generados todos los pagos de ese período.',
        r.creados ? 'ok' : 'aviso'
      )
      if (r.fallos.length) {
        avisar(`No se pudo leer la nómina de: ${r.fallos.join(', ')}.`, 'aviso')
      }
      if (r.sinId.length) {
        avisar(`Sin ID de trabajadores: ${r.sinId.join(', ')}. Esos pagos no se generaron.`, 'aviso')
      }
      if (r.inactivas.length) {
        avisar(`Inactivas en Unidades: ${r.inactivas.join(', ')}. Esos pagos no se generaron.`, 'aviso')
      }
      await cargarPagos()
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'No se pudieron generar los pagos.', 'error')
    } finally {
      setGenerando(false)
    }
  }

  async function guardarNota(p: BonoPago) {
    const bruto = notas[p.id]
    if (bruto === undefined) return
    setGuardandoId(p.id)
    try {
      const t = bruto.trim()
      const nota = t === '' ? null : Number(t)
      if (nota != null && (!Number.isFinite(nota) || nota < 0 || nota > 100)) {
        avisar('La nota va de 0 a 100.', 'aviso')
        setNotas((prev) => {
          const next = { ...prev }
          delete next[p.id]
          return next
        })
        return
      }
      const actualizada = await guardarNotaPago(p, nota)
      setPagos((prev) => prev.map((x) => (x.id === p.id ? actualizada : x)))
      setNotas((prev) => {
        const next = { ...prev }
        delete next[p.id]
        return next
      })
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'No se pudo guardar la nota.', 'error')
    } finally {
      setGuardandoId(null)
    }
  }

  async function confirmarPago() {
    if (!aPagar) return
    const pago = aPagar
    setAPagar(null)
    setGuardandoId(pago.id)
    try {
      const pagado = await marcarPagado(pago, { fecha: fechaHoy() })
      setPagos((prev) => prev.map((x) => (x.id === pago.id ? pagado : x)))
      avisar(`Pago de ${pago.nombre} registrado.`)
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'No se pudo registrar el pago.', 'error')
    } finally {
      setGuardandoId(null)
    }
  }

  async function deshacer(pago: BonoPago) {
    setGuardandoId(pago.id)
    try {
      const pendiente = await volverAPendiente(pago)
      setPagos((prev) => prev.map((x) => (x.id === pago.id ? pendiente : x)))
      avisar('El pago volvió a quedar pendiente.', 'aviso')
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'No se pudo deshacer el pago.', 'error')
    } finally {
      setGuardandoId(null)
    }
  }

  /* --- Derivados ----------------------------------------------------------- */

  const configsDePeriodicidad = useMemo(
    () => cargos.filter((c) => c.periodicidad === periodicidad),
    [cargos, periodicidad]
  )

  /** Ocupantes y gasto proyectado de TODOS los cargos: la fila de total. */
  const totalesCargos = useMemo(() => {
    if (!nomina) return null
    let ocupantes = 0
    let gasto = 0
    for (const c of cargos) {
      const g = gastoDeCargo(c, nomina)
      ocupantes += g.ocupantes
      gasto += g.gasto
    }
    return { ocupantes, gasto: Math.round(gasto * 100) / 100 }
  }, [cargos, nomina])

  /** El gasto del cargo que se está editando, con lo que trae el formulario. */
  const gastoSeleccion = useMemo(() => {
    const alcance: BonoCargoSucursal[] = especifico
      ? Object.entries(porSucursal).map(([sucursal_id, bruto]) => {
          const monto = Number(bruto)
          return { sucursal_id, monto: Number.isFinite(monto) && monto >= 0 ? monto : null }
        })
      : []
    return gastoDeCargo(
      {
        cargo: form.cargo.trim(),
        monto: Number(form.monto) || 0,
        departamento: form.departamento.trim() || null,
        sucursales: alcance
      },
      nomina ?? new Map()
    )
  }, [especifico, porSucursal, form.cargo, form.monto, form.departamento, nomina])

  /** El listado exacto del cargo cuyo número de ocupantes se tocó. */
  const detalleLista = detalleCargos && nomina ? ocupantesDeCargo(detalleCargos, nomina) : null

  /**
   * Los carteles de la nómina incompleta, cada uno con su motivo. Sin esto,
   * una tienda sin `branchID` o inactiva simplemente no aparecía y el conteo
   * salía más bajo sin que nadie supiera por qué.
   */
  const avisosNomina = useMemo(() => {
    const avisos: string[] = []
    if (nominaFallo.length) {
      avisos.push(`No se pudo leer la nómina de: ${nominaFallo.join(', ')}.`)
    }
    if (nominaSinId.length) {
      avisos.push(
        `Sin ID de trabajadores (Nº tienda / branchID en Unidades): ${nominaSinId.join(', ')}. No entran al conteo ni a los pagos.`
      )
    }
    if (nominaInactivas.length) {
      avisos.push(`Inactivas en Unidades: ${nominaInactivas.join(', ')}. No cuentan ni generan pagos.`)
    }
    return avisos
  }, [nominaFallo, nominaSinId, nominaInactivas])

  /**
   * Las sucursales del cargo cuya celda se tocó, con el monto que le
   * corresponde a cada una. Sin alcance («todas») se listan las activas con
   * el monto base, que es exactamente lo que ese cargo paga en cada tienda.
   */
  const detalleSucursales = useMemo(() => {
    if (!detalleAlcance) return null
    if (!detalleAlcance.sucursales.length) {
      return sucursalesActivas.map((s) => ({
        nombre: s.nombre,
        monto: detalleAlcance.monto,
        propia: false
      }))
    }
    const porId = new Map(sucursales.map((s) => [s.id, s.nombre]))
    return detalleAlcance.sucursales.map((f) => ({
      nombre: porId.get(f.sucursal_id) ?? f.sucursal_id,
      monto: f.monto ?? detalleAlcance.monto,
      propia: f.monto != null
    }))
  }, [detalleAlcance, sucursalesActivas, sucursales])

  /**
   * Cada tienda del alcance con CUÁNTOS ocupantes trae y, si trae 0, POR QUÉ.
   * Es la respuesta directa a «me trae de dos de cuatro»: la tienda que no
   * se pudo leer aparece acá con su motivo, en vez de no aparecer.
   */
  const detalleTiendas = useMemo(() => {
    if (!detalleAlcance) return null
    const porId = new Map(sucursales.map((s) => [s.id, s.nombre]))
    const enAlcance = detalleAlcance.sucursales.length
      ? detalleAlcance.sucursales.map((f) => f.sucursal_id)
      : sucursalesActivas.map((s) => s.id)
    return enAlcance.map((id) => {
      const nombre = porId.get(id) ?? id
      const cuenta = detalleLista ? detalleLista.filter((o) => o.sucursal_id === id).length : null
      let motivo: string | null = null
      if (cuenta === 0) {
        if (nominaInactivas.includes(nombre)) motivo = 'inactiva en Unidades'
        else if (nominaSinId.includes(nombre)) motivo = 'sin ID de trabajadores'
        else if (nominaFallo.includes(nombre)) motivo = 'la nómina no se pudo leer'
        else if (!nomina?.has(id)) motivo = 'sin nómina leída'
        else motivo = 'sin personas con ese cargo exacto en esa tienda'
      }
      return { nombre, cuenta, motivo }
    })
  }, [
    detalleAlcance,
    detalleLista,
    sucursales,
    sucursalesActivas,
    nomina,
    nominaFallo,
    nominaSinId,
    nominaInactivas
  ])

  function nombreSucursal(id: string): string {
    return sucursales.find((s) => s.id === id)?.nombre ?? id
  }

  /** Cargos que existen en la nómina: sugerencias del campo «Cargo». */
  const cargoSugerido = useMemo(() => [...new Set(catalogo.map((x) => x.cargo).filter(Boolean))], [catalogo])

  /**
   * Departamentos para el campo «Departamento»: si el cargo ya está escrito,
   * sólo los suyos (es el caso «Comprador/a» en dos áreas); si no, todos los
   * de la nómina.
   */
  const deptoSugeridos = useMemo(() => {
    const clave = claveNormalizada(form.cargo)
    const delCargo = catalogo.filter((x) => clave && claveNormalizada(x.cargo) === clave).map((x) => x.departamento)
    const conDatos = delCargo.filter(Boolean)
    const lista = conDatos.length ? conDatos : catalogo.map((x) => x.departamento).filter(Boolean)
    return [...new Set(lista)]
  }, [catalogo, form.cargo])

  const pagosFiltrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return pagos.filter((p) => {
      if (filtro !== 'TODOS' && p.estado !== filtro) return false
      if (!q) return true
      return (
        p.nombre.toLowerCase().includes(q) ||
        p.cargo.toLowerCase().includes(q) ||
        cedulaDe(p).toLowerCase().includes(q)
      )
    })
  }, [pagos, filtro, busqueda])

  const kpis = useMemo(() => {
    const pagados = pagos.filter((p) => p.estado === 'PAGADO')
    const pendientes = pagos.filter((p) => p.estado === 'PENDIENTE')
    const suma = (filas: BonoPago[]) => Math.round(filas.reduce((acc, p) => acc + p.monto, 0) * 100) / 100
    return {
      total: suma(pagos),
      pagado: suma(pagados),
      pagados: pagados.length,
      pendiente: suma(pendientes),
      pendientes: pendientes.length,
      sinNota: pagos.filter((p) => p.nota == null).length
    }
  }, [pagos])

  const periodos = useMemo(() => periodosRecientes(periodicidad), [periodicidad])

  return (
    <div className="space-y-4">
      {/* Las pestañas y la acción de la pestaña activa viven en la barra
          superior, igual que en Unidades: el título ya lo trae la cabecera de
          la consola. */}
      <PortalCabecera>
        <div role="group" aria-label="Sección de bonos" className="flex p-1 bg-slate-100 rounded-xl">
          <Button
            variant="ghost"
            aria-pressed={pestana === 'cargos'}
            title="Cargos con bono"
            className={cn(
              'rounded-lg px-4 py-1.5 text-xs transition-all',
              pestana === 'cargos' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            )}
            onClick={() => setPestana('cargos')}
          >
            <Pencil className="h-3.5 w-3.5 sm:mr-2" />
            <span className="hidden sm:inline">Cargos</span>
          </Button>
          <Button
            variant="ghost"
            aria-pressed={pestana === 'pagos'}
            title="Pagos del período"
            className={cn(
              'rounded-lg px-4 py-1.5 text-xs transition-all',
              pestana === 'pagos' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            )}
            onClick={() => setPestana('pagos')}
          >
            <RefreshCw className="h-3.5 w-3.5 sm:mr-2" />
            <span className="hidden sm:inline">Pagos</span>
          </Button>
        </div>
        {pestana === 'cargos' ? (
          <Button className="min-h-[34px] px-3 py-1.5 text-xs" onClick={abrirNuevo} title="Nuevo cargo con bono">
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Nuevo cargo</span>
          </Button>
        ) : (
          <Button
            className="min-h-[34px] px-3 py-1.5 text-xs"
            onClick={() => void generar()}
            disabled={generando || !configsDePeriodicidad.length}
            title={
              configsDePeriodicidad.length
                ? `Generar los pagos de ${etiquetaPeriodo(periodo)}`
                : 'Primero configurá cargos con esa periodicidad'
            }
          >
            <RefreshCw className={cn('h-4 w-4', generando && 'animate-spin')} />
            <span className="hidden sm:inline">{generando ? 'Generando…' : 'Generar pagos'}</span>
          </Button>
        )}
      </PortalCabecera>

      {pestana === 'cargos' ? (
        cargandoCargos ? (
          <div className="flex justify-center py-16">
            <Spinner />
          </div>
        ) : !cargos.length ? (
          <div className="rounded-2xl border border-slate-200 bg-white">
            <EmptyState
              title="Todavía no hay cargos con bono"
              subtitle="Marcá qué cargos gozan de bono, con cuánto y cada cuánto se pagan."
            />
          </div>
        ) : (
          <div className="space-y-3">
            {/* De dónde sale la nómina y si está fresca: la foto la da el
                cron diario y el botón la refresca en el momento. */}
            <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
              <span className="font-bold text-slate-700">Nómina:</span>
              {nominaCargando ? (
                <span>leyendo…</span>
              ) : nominaFuente === 'local' ? (
                <span>
                  tabla espejo, actualizada{' '}
                  <b className="text-slate-800">{etiquetaFrescura(nominaActualizado)}</b>
                  {nominaDesactualizada(nominaActualizado) ? (
                    <span className="text-amber-700"> · puede estar desactualizada</span>
                  ) : null}
                </span>
              ) : nominaFuente === 'api' ? (
                <span>API en vivo (la tabla espejo está vacía: falta aplicar el bloque o correr el cron)</span>
              ) : (
                <span>—</span>
              )}
              <Button
                variant="secondary"
                className="ml-auto min-h-[32px] px-3 py-1 text-xs"
                disabled={actualizando}
                onClick={() => void actualizarNomina()}
                title="Pedir la nómina ahora y guardarla en la tabla espejo"
              >
                <RefreshCw className={cn('h-3.5 w-3.5', actualizando && 'animate-spin')} />
                {actualizando ? 'Actualizando…' : 'Actualizar ahora'}
              </Button>
            </div>
            {/* La nómina parcial se avisa arriba de la tabla: sin este
                cartel, un gasto calculado con menos sucursales se leería
                como el gasto real. */}
            {avisosNomina.length ? (
              <div className="space-y-1 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                <p className="font-semibold">El conteo puede estar incompleto:</p>
                {avisosNomina.map((a) => (
                  <p key={a}>• {a}</p>
                ))}
              </div>
            ) : null}
            <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
              <table className="w-full min-w-[1000px] text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs font-bold uppercase tracking-wide text-slate-400">
                    <th className="px-4 py-3">Cargo</th>
                    <th className="px-4 py-3 text-right">Monto</th>
                    <th className="px-4 py-3">Sucursales</th>
                    <th className="px-4 py-3 text-right" title="Personas activas con ese cargo en su alcance">
                      Ocupantes
                    </th>
                    <th className="px-4 py-3 text-right" title="Monto × ocupantes, antes de prorratear con la nota">
                      Gasto total
                    </th>
                    <th className="px-4 py-3 text-right">Nota mínima</th>
                    <th className="px-4 py-3">Pago</th>
                    <th className="px-4 py-3">Estado</th>
                    <th className="px-4 py-3 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {cargos.map((c) => {
                    // El gasto de la fila: ocupantes ACTIVOS de SU alcance,
                    // cada uno por el monto de su sucursal. Sin nómina leída
                    // no se pinta un cero, se pinta «—».
                    const gasto = nomina ? gastoDeCargo(c, nomina) : null
                    return (
                      <tr key={c.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                        <td className="px-4 py-3 font-semibold text-slate-800">
                          {c.cargo}
                          {c.departamento ? (
                            <span className="block text-xs font-normal text-slate-500">{c.departamento}</span>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                          {c.monto.toLocaleString('es-VE', { maximumFractionDigits: 2 })}
                        </td>
                        <td className="px-4 py-3">
                          {/* Clicable, igual que el número de ocupantes: tocarlo
                              muestra EN QUÉ tiendas entra el cargo y con cuánto
                              paga en cada una. */}
                          <button
                            type="button"
                            onClick={() => setDetalleAlcance(c)}
                            title="Ver las sucursales"
                            className="text-slate-600 hover:text-primary"
                          >
                            {c.sucursales.length === 0 ? (
                              <Badge color={1}>Todas</Badge>
                            ) : (
                              <span className="underline decoration-dotted underline-offset-2">
                                {c.sucursales.length} {c.sucursales.length === 1 ? 'sucursal' : 'sucursales'}
                              </span>
                            )}
                          </button>
                        </td>
                        <td className="px-4 py-3 text-right">
                          {/* El número es una puerta: tocarlo muestra QUIÉNES
                              son y con qué cargo figuran en la nómina, que es
                              la pregunta que aparece cuando el conteo no da
                              lo esperado («¿por qué 9 si hay 4 tiendas?»). */}
                          <button
                            type="button"
                            onClick={() => setDetalleCargos(c)}
                            disabled={nominaCargando || !nomina}
                            title="Ver quiénes son"
                            className="tabular-nums underline decoration-dotted underline-offset-2 hover:text-primary disabled:no-underline disabled:text-slate-400"
                          >
                            {nominaCargando ? '…' : gasto ? gasto.ocupantes : '—'}
                          </button>
                        </td>
                        <td className="px-4 py-3 text-right font-bold tabular-nums text-primary-900">
                          {nominaCargando
                            ? '…'
                            : gasto
                              ? gasto.gasto.toLocaleString('es-VE', { maximumFractionDigits: 2 })
                              : '—'}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-slate-700">{c.nota_minima}</td>
                        <td className="px-4 py-3 text-slate-600">
                          {c.periodicidad === 'MENSUAL' ? 'Mensual' : 'Trimestral'}
                        </td>
                        <td className="px-4 py-3">
                          <Badge color={c.activo ? 2 : 0}>{c.activo ? 'Activo' : 'Inactivo'}</Badge>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-1">
                            <ButtonIcon
                              variant="ghost"
                              title={`Editar ${c.cargo}`}
                              aria-label={`Editar ${c.cargo}`}
                              onClick={() => abrirEdicion(c)}
                            >
                              <Pencil className="h-4 w-4" />
                            </ButtonIcon>
                            <ButtonIcon
                              variant={c.activo ? 'dangerGhost' : 'success'}
                              title={c.activo ? `Desactivar ${c.cargo}` : `Activar ${c.cargo}`}
                              aria-label={c.activo ? `Desactivar ${c.cargo}` : `Activar ${c.cargo}`}
                              onClick={() => void alternarActivo(c)}
                            >
                              <Power className="h-4 w-4" />
                            </ButtonIcon>
                            <ButtonIcon
                              variant="dangerGhost"
                              title={`Eliminar ${c.cargo}`}
                              aria-label={`Eliminar ${c.cargo}`}
                              onClick={() => setABorrar(c)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </ButtonIcon>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-slate-200 bg-slate-50 text-sm">
                    <td className="px-4 py-3 font-bold text-slate-700" colSpan={3}>
                      Total proyectado
                    </td>
                    <td className="px-4 py-3 text-right font-bold tabular-nums text-slate-700">
                      {nominaCargando ? '…' : totalesCargos ? totalesCargos.ocupantes : '—'}
                    </td>
                    <td className="px-4 py-3 text-right font-bold tabular-nums text-primary-900">
                      {nominaCargando
                        ? '…'
                        : totalesCargos
                          ? totalesCargos.gasto.toLocaleString('es-VE', { maximumFractionDigits: 2 })
                          : '—'}
                    </td>
                    <td className="px-4 py-3 text-right text-xs font-normal text-slate-500" colSpan={4}>
                      Tope antes de prorratear con la nota
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )
      ) : (
        <div className="space-y-4">
          {/* Controles del período: la periodicidad la eligió el cargo, así
              que primero se elige esa y recién después el período. */}
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3">
            <div role="group" aria-label="Periodicidad" className="flex p-1 bg-slate-100 rounded-xl">
              {(['MENSUAL', 'TRIMESTRAL'] as Periodicidad[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  aria-pressed={periodicidad === p}
                  onClick={() => cambiarPeriodicidad(p)}
                  className={cn(
                    'rounded-lg px-3 py-1.5 text-xs font-semibold transition-all',
                    periodicidad === p ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  )}
                >
                  {p === 'MENSUAL' ? 'Mensual' : 'Trimestral'}
                </button>
              ))}
            </div>

            <Field label="Período" className="w-52">
              <Select value={periodo} onChange={(e) => setPeriodo(e.target.value)}>
                {periodos.map((p) => (
                  <option key={p} value={p}>
                    {etiquetaPeriodo(p)}
                  </option>
                ))}
              </Select>
            </Field>

            <div role="group" aria-label="Estado del pago" className="flex gap-1.5 self-end">
              {(['TODOS', 'PENDIENTE', 'PAGADO'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  aria-pressed={filtro === f}
                  onClick={() => setFiltro(f)}
                  className={cn(
                    'rounded-full px-3 py-1.5 text-xs font-bold transition-colors',
                    filtro === f ? 'bg-primary text-white' : 'border border-slate-200 bg-white text-slate-600'
                  )}
                >
                  {f === 'TODOS' ? 'Todos' : f === 'PENDIENTE' ? 'Pendientes' : 'Pagados'}
                </button>
              ))}
            </div>

            <Field label="Buscar" className="ml-auto w-52">
              <Input
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Nombre, cargo o cédula"
                aria-label="Buscar por nombre, cargo o cédula"
              />
            </Field>
          </div>

          {/* Los números del período: cuánto se paga en total, qué ya salió y
              qué sigue esperando nota. */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              { rotulo: 'A pagar', valor: kpis.total, detalle: `${pagos.length} persona${pagos.length === 1 ? '' : 's'}` },
              { rotulo: 'Pagado', valor: kpis.pagado, detalle: `${kpis.pagados} de ${pagos.length}` },
              { rotulo: 'Pendiente', valor: kpis.pendiente, detalle: `${kpis.pendientes} de ${pagos.length}` },
              { rotulo: 'Sin nota', valor: null, detalle: `${kpis.sinNota} sin cargar` }
            ].map((k) => (
              <div key={k.rotulo} className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{k.rotulo}</p>
                <p className="mt-1 text-xl font-extrabold tabular-nums text-primary-900">
                  {k.valor == null ? '—' : k.valor.toLocaleString('es-VE', { maximumFractionDigits: 2 })}
                </p>
                <p className="text-xs text-slate-500">{k.detalle}</p>
              </div>
            ))}
          </div>

          {cargandoPagos ? (
            <div className="flex justify-center py-16">
              <Spinner />
            </div>
          ) : !configsDePeriodicidad.length ? (
            <div className="rounded-2xl border border-slate-200 bg-white">
              <EmptyState
                title={`No hay cargos con bono ${periodicidad === 'MENSUAL' ? 'mensuales' : 'trimestrales'}`}
                subtitle="Marcá en la pestaña Cargos qué puestos gozan de bono y con qué periodicidad."
              />
            </div>
          ) : !pagos.length ? (
            <div className="rounded-2xl border border-slate-200 bg-white">
              <EmptyState
                title={`Sin pagos para ${etiquetaPeriodo(periodo)}`}
                subtitle="Generá los pagos con la nómina actual de las sucursales y después cargá la nota de cada uno."
              />
            </div>
          ) : !pagosFiltrados.length ? (
            <div className="rounded-2xl border border-slate-200 bg-white">
              <EmptyState title="Ningún pago coincide con el filtro" subtitle="Probá con otra búsqueda o con «Todos»." />
            </div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
              <table className="w-full min-w-[860px] text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs font-bold uppercase tracking-wide text-slate-400">
                    <th className="px-4 py-3">Trabajador</th>
                    <th className="px-4 py-3">Cargo</th>
                    <th className="px-4 py-3">Sucursal</th>
                    <th className="px-4 py-3 text-right">Nota</th>
                    <th className="px-4 py-3 text-right">Monto</th>
                    <th className="px-4 py-3">Estado</th>
                    <th className="px-4 py-3 text-right">Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {pagosFiltrados.map((p) => {
                    const bruto = notas[p.id]
                    const nota = notaVigente(p, bruto)
                    const monto = montoACobrar(p.monto_base, nota, p.nota_minima)
                    const enVuelo = guardandoId === p.id
                    return (
                      <tr key={p.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <span className="block font-semibold text-slate-800">{p.nombre}</span>
                          <span className="block text-xs text-slate-500">{cedulaDe(p)}</span>
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {p.cargo}
                          {p.departamento ? (
                            <span className="block text-xs font-normal text-slate-500">{p.departamento}</span>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 text-slate-600">{p.sucursal?.nombre ?? '—'}</td>
                        <td className="px-4 py-3 text-right">
                          <Input
                            type="number"
                            min={0}
                            max={100}
                            step={1}
                            value={bruto ?? (p.nota?.toString() ?? '')}
                            onChange={(e) => setNotas((prev) => ({ ...prev, [p.id]: e.target.value }))}
                            onBlur={() => void guardarNota(p)}
                            disabled={enVuelo}
                            aria-label={`Nota de ${p.nombre}`}
                            className="w-20 text-right"
                          />
                        </td>
                        <td className="px-4 py-3 text-right font-bold tabular-nums text-primary-900">
                          {enVuelo ? '…' : monto.toLocaleString('es-VE', { maximumFractionDigits: 2 })}
                        </td>
                        <td className="px-4 py-3">
                          <Badge color={p.estado === 'PAGADO' ? 2 : 3}>
                            {p.estado === 'PAGADO' ? 'Pagado' : 'Pendiente'}
                          </Badge>
                          {p.estado === 'PAGADO' && p.pagado_en ? (
                            <span className="ml-1 text-xs text-slate-500">{fechaCorta(p.pagado_en)}</span>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {p.estado === 'PAGADO' ? (
                            <Button
                              variant="ghost"
                              className="min-h-[34px] px-3 py-1.5 text-xs"
                              disabled={enVuelo}
                              onClick={() => void deshacer(p)}
                            >
                              Deshacer
                            </Button>
                          ) : (
                            <Button
                              variant="success"
                              className="min-h-[34px] px-3 py-1.5 text-xs"
                              disabled={enVuelo}
                              onClick={() => setAPagar(p)}
                            >
                              Marcar pagado
                            </Button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* --- Alta y edición de un cargo ------------------------------------- */}
      <Modal
        open={modalAbierto}
        onClose={() => setModalAbierto(false)}
        title={editando ? `Editar ${editando.cargo}` : 'Nuevo cargo con bono'}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setModalAbierto(false)}>
              Cancelar
            </Button>
            <Button onClick={() => void guardar()} disabled={guardandoCargo}>
              {guardandoCargo ? 'Guardando…' : 'Guardar'}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Field label="Cargo" hint="Tiene que escribirse como figura en la nómina: es con lo que se cruza para generar los pagos.">
            <Input
              value={form.cargo}
              onChange={(e) => setForm((f) => ({ ...f, cargo: e.target.value }))}
              list="bonos-sugerencias-cargo"
              placeholder="Ej.: Cajero integral"
              autoFocus
            />
            <datalist id="bonos-sugerencias-cargo">
              {cargoSugerido.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </Field>

          {/* El área separa cargos IGUALES: «Comprador/a» de Compras no es
              el mismo bono que «Comprador/a» de Servicios Generales, aunque
              en la nómina los dos se llamen igual. */}
          <Field
            label="Departamento (opcional)"
            hint="Acota el bono al área: sólo cobran las personas con ese departamento en la nómina. Vacío = cualquier departamento."
          >
            <Input
              value={form.departamento}
              onChange={(e) => setForm((f) => ({ ...f, departamento: e.target.value }))}
              list="bonos-sugerencias-departamento"
              placeholder="Ej.: Compras"
            />
            <datalist id="bonos-sugerencias-departamento">
              {deptoSugeridos.map((d) => (
                <option key={d} value={d} />
              ))}
            </datalist>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Monto del bono" hint="Vale para todas las sucursales; si restringís el alcance, cada una puede tener el suyo.">
              <Input
                type="number"
                min={0}
                step="0.01"
                value={form.monto}
                onChange={(e) => setForm((f) => ({ ...f, monto: e.target.value }))}
                placeholder="0,00"
              />
            </Field>
            <Field label="Nota mínima" hint="Debajo no se cobra.">
              <Input
                type="number"
                min={0}
                max={100}
                step={1}
                value={form.nota_minima}
                onChange={(e) => setForm((f) => ({ ...f, nota_minima: e.target.value }))}
              />
            </Field>
          </div>

          <Field label="Frecuencia de pago">
            <Select
              value={form.periodicidad}
              onChange={(e) => setForm((f) => ({ ...f, periodicidad: e.target.value as Periodicidad }))}
            >
              <option value="MENSUAL">Mensual</option>
              <option value="TRIMESTRAL">Trimestral</option>
            </Select>
          </Field>

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form.activo}
              onChange={(e) => setForm((f) => ({ ...f, activo: e.target.checked }))}
              className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary/20"
            />
            Activo (genera pagos en su período)
          </label>

          {/* El ALCANCE: dónde se paga este cargo. Sin marcar, todas las
              sucursales con el monto de arriba; marcando, sólo el conjunto y
              cada sucursal con su propio monto (el umbral y la periodicidad
              siguen siendo del cargo). */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
              <input
                type="checkbox"
                checked={especifico}
                onChange={(e) => setEspecifico(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary/20"
              />
              Sólo en sucursales específicas
            </label>
            <p className="text-xs text-slate-500">
              Sin marcarlo, el bono aplica a todas las sucursales con el monto base. Marcado, sólo a las de abajo,
              cada una con su monto.
            </p>
            {especifico ? (
              <div className="max-h-60 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200">
                {sucursalesActivas.length === 0 ? (
                  <p className="p-3 text-sm text-slate-500">No hay sucursales activas cargadas.</p>
                ) : (
                  <>
                    <div className="flex items-center justify-between gap-2 bg-slate-50 px-3 py-2">
                      <span className="text-xs font-bold uppercase tracking-wide text-slate-400">
                        {Object.keys(porSucursal).length} de {sucursalesActivas.length}
                      </span>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          className="min-h-[28px] px-2 py-1 text-[11px]"
                          onClick={marcarTodas}
                        >
                          Todas
                        </Button>
                        <Button
                          variant="ghost"
                          className="min-h-[28px] px-2 py-1 text-[11px]"
                          onClick={() => setPorSucursal({})}
                        >
                          Ninguna
                        </Button>
                      </div>
                    </div>
                    {sucursalesActivas.map((s) => {
                      const marcada = s.id in porSucursal
                      return (
                        <div key={s.id} className="flex items-center gap-2 px-3 py-2">
                          {/* El nombre también tilda la casilla: tocar sólo el
                              texto y que no pase nada es la misma trampa de
                              la celda de la tabla. El input del monto queda
                              FUERA de la etiqueta para que escribir ahí no
                              alterne la casilla. */}
                          <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                            <input
                              type="checkbox"
                              checked={marcada}
                              onChange={() => alternarSucursal(s.id)}
                              aria-label={`Incluir ${s.nombre}`}
                              className="h-4 w-4 shrink-0 rounded border-slate-300 text-primary focus:ring-primary/20"
                            />
                            <span className="min-w-0 truncate text-sm text-slate-700">{s.nombre}</span>
                          </label>
                          <Input
                            type="number"
                            min={0}
                            step="0.01"
                            value={marcada ? porSucursal[s.id] : form.monto}
                            disabled={!marcada}
                            onChange={(e) => setPorSucursal((prev) => ({ ...prev, [s.id]: e.target.value }))}
                            aria-label={`Monto en ${s.nombre}`}
                            className="w-24 text-right"
                          />
                        </div>
                      )
                    })}
                  </>
                )}
              </div>
            ) : null}
          </div>

          {/* El gasto que se está por comprometer: monto × ocupantes del
              alcance tal como está armado AHORA, antes de guardar. */}
          {nomina ? (
            <p className="rounded-xl bg-primary-50 p-3 text-xs text-primary-800">
              Ocupantes en el alcance: <b className="tabular-nums">{gastoSeleccion.ocupantes}</b> · gasto total
              proyectado:{' '}
              <b className="tabular-nums">
                {gastoSeleccion.gasto.toLocaleString('es-VE', { maximumFractionDigits: 2 })}
              </b>{' '}
              (monto × ocupantes, antes de prorratear con la nota).
            </p>
          ) : (
            <p className="rounded-xl bg-slate-50 p-3 text-xs text-slate-500">
              {nominaCargando
                ? 'Consultando la nómina para estimar el gasto de este cargo…'
                : 'Sin la nómina no se puede estimar el gasto: los ocupantes se cuentan contra la API de trabajadores.'}
            </p>
          )}

          <p className="rounded-xl bg-slate-50 p-3 text-xs text-slate-500">
            El monto se prorratea con la nota que cargues en cada pago: con nota mínima 70, una nota 70 paga el 70%
            del monto y una nota 100 paga el total. 69 o menos no paga nada.
          </p>
        </div>
      </Modal>

      {/* --- Confirmaciones --------------------------------------------------- */}
      <Confirmar
        open={Boolean(aBorrar)}
        texto={
          aBorrar
            ? `¿Eliminar el bono de «${aBorrar.cargo}»? Se borran también sus pagos generados. Esta acción no se puede deshacer.`
            : ''
        }
        onConfirm={() => void borrar()}
        onCancel={() => setABorrar(null)}
        textoConfirmar="Sí, eliminar"
      />

      <Confirmar
        open={Boolean(aPagar)}
        texto={
          aPagar
            ? `¿Marcar como pagado el bono de ${aPagar.nombre} (${aPagar.cargo}) por ${montoACobrar(
                aPagar.monto_base,
                aPagar.nota,
                aPagar.nota_minima
              ).toLocaleString('es-VE', { maximumFractionDigits: 2 })} en ${etiquetaPeriodo(aPagar.periodo)}?`
            : ''
        }
        variant="success"
        textoConfirmar="Sí, pagado"
        onConfirm={() => void confirmarPago()}
        onCancel={() => setAPagar(null)}
      />

      {/* ¿QUIÉNES son los ocupantes? El conteo es de la nómina y con cruce
          exacto: si el número no coincide con lo esperado, acá se ve con qué
          cargo figura cada persona en cada tienda. */}
      <Modal
        open={Boolean(detalleCargos)}
        onClose={() => setDetalleCargos(null)}
        wide
        title={`Ocupantes de «${detalleCargos?.cargo ?? ''}»`}
        footer={
          <div className="flex justify-end">
            <Button variant="ghost" onClick={() => setDetalleCargos(null)}>
              Cerrar
            </Button>
          </div>
        }
      >
        {detalleLista === null ? (
          <p className="text-sm text-slate-500">Consultando la nómina…</p>
        ) : !detalleLista.length ? (
          <p className="text-sm text-slate-500">
            No hay trabajadores <b>activos</b> con ese cargo exacto en las sucursales de su alcance. Si esperabas
            ver gente, revisá cómo está escrito el cargo en la nómina.
          </p>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-slate-500">
              {detalleLista.length} ocupante{detalleLista.length === 1 ? '' : 's'}, cada uno con el monto de su
              sucursal. Sólo personas activas —«Nuevo ingreso» cuenta— y con el cargo exacto.
            </p>
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
              {detalleLista.map((o) => (
                <li
                  key={`${o.nacionalidad}-${o.dni}`}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm"
                >
                  <span className="min-w-0 flex-1 font-semibold text-slate-800">{o.nombre}</span>
                  <span className="tabular-nums text-slate-500">{cedulaDe(o)}</span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                    {o.cargo_nomina || 'sin cargo en la nómina'}
                  </span>
                  <span className="rounded-full bg-primary-50 px-2 py-0.5 text-xs text-primary-700">
                    {o.departamento_nomina || 'sin departamento en la nómina'}
                  </span>
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                    {o.estado_nomina || 'sin estado en la nómina'}
                  </span>
                  <span className="text-slate-600">{nombreSucursal(o.sucursal_id)}</span>
                  <span className="font-bold tabular-nums text-primary-900">
                    {o.monto.toLocaleString('es-VE', { maximumFractionDigits: 2 })}
                  </span>
                </li>
              ))}
            </ul>
            {/* Cada tienda del alcance con SU número y, si es 0, el motivo:
                es lo que contesta «me trae de dos de cuatro». */}
            {detalleTiendas?.length ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">
                  Por tienda del alcance
                </p>
                <ul className="space-y-1 text-sm">
                  {detalleTiendas.map((t) => (
                    <li key={t.nombre} className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-slate-700">{t.nombre}</span>
                      {t.cuenta == null ? (
                        <span className="text-slate-400">…</span>
                      ) : t.motivo ? (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                          0 · {t.motivo}
                        </span>
                      ) : (
                        <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800">
                          {t.cuenta} {t.cuenta === 1 ? 'ocupante' : 'ocupantes'}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )}
      </Modal>

      {/* ¿EN QUÉ tiendas entra el cargo? La celda de la tabla abre esto: sin
          alcance se listan todas las activas con el monto base; con alcance,
          sólo las del conjunto, marcando cuáles llevan monto propio. */}
      <Modal
        open={Boolean(detalleAlcance)}
        onClose={() => setDetalleAlcance(null)}
        wide
        title={`Sucursales de «${detalleAlcance?.cargo ?? ''}»`}
        footer={
          <div className="flex justify-end">
            <Button variant="ghost" onClick={() => setDetalleAlcance(null)}>
              Cerrar
            </Button>
          </div>
        }
      >
        {detalleSucursales === null ? null : !detalleSucursales.length ? (
          <p className="text-sm text-slate-500">No hay sucursales activas cargadas.</p>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-slate-500">
              {detalleAlcance?.sucursales.length
                ? `${detalleSucursales.length} sucursal(es) en el alcance. Las que llevan monto propio lo muestran; las demás, el monto base del cargo.`
                : 'Sin alcance marcado: el cargo aplica a TODAS las sucursales con el monto base.'}
            </p>
            <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
              {detalleSucursales.map((s) => (
                <li key={s.nombre} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 font-semibold text-slate-800">{s.nombre}</span>
                  <Badge color={s.propia ? 1 : 0}>{s.propia ? 'Monto propio' : 'Monto base'}</Badge>
                  <span className="font-bold tabular-nums text-primary-900">
                    {s.monto.toLocaleString('es-VE', { maximumFractionDigits: 2 })}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Modal>
    </div>
  )
}
