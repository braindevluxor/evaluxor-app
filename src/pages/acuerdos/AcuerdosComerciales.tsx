import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useLocation } from 'react-router-dom'
import { PortalCabecera } from '../../components/PortalCabecera'
import { Badge, Button, ButtonIcon, Confirmar, EmptyState, Field, Input, Modal, Select, SkeletonFilas, Spinner } from '../../components/ui'
import { useAuth } from '../../context/AuthContext'
import { avisar } from '../../lib/aviso'
import { cobraAcuerdos, gestionaAcuerdos } from '../../lib/roles'
import { colorDe, fechasDeCobro, haySolape, hoyISO, usd, vigente } from '../../lib/acuerdos'
import {
  crearOpcionCatalogo,
  darDeBajaAcuerdo,
  deshacerCobro,
  eliminarAcuerdo,
  eliminarEspacio,
  eliminarProveedor,
  guardarAcuerdo,
  guardarEspacio,
  guardarProveedor,
  listarAcuerdos,
  listarCatalogo,
  listarCobros,
  listarEspaciosTodos,
  listarPlanos,
  listarProveedores,
  listarSucursalesAcuerdos,
  listarTiposEspacio,
  registrarCobro,
  subirContrato,
  quitarContrato,
  urlFirmada,
  type AcuerdoConRelacion,
  type ClaseCatalogo,
  type CobroConAcuerdo,
  type Espacio,
  type OpcionCatalogo,
  type PlanoSucursal,
  type Proveedor,
  type SucursalAcuerdo,
  type TipoEspacio
} from '../../lib/data/acuerdos'
import { PlanoAcuerdos } from './PlanoAcuerdos'
import { CalendarioAcuerdos } from './CalendarioAcuerdos'
import { DashboardAcuerdos } from './DashboardAcuerdos'
import { HistorialAcuerdos } from './HistorialAcuerdos'
import { CalendarDays, Paperclip, Pencil, Plus, Trash2, X } from 'lucide-react'

type Vista = 'dashboard' | 'planos' | 'proveedores' | 'acuerdos' | 'calendario' | 'historial'

/**
 * Cada vista es una RUTA: así el menú lateral puede enlazarlas ( NavLink
 * marca «estás acá») y RECARGAR la página no pierde la vista —antes vivían
 * en un `useState` que arrancaba en «dashboard» en cada recarga.
 */
const RUTAS_VISTA: Record<Vista, string> = {
  dashboard: '/acuerdos',
  planos: '/acuerdos/planos',
  proveedores: '/acuerdos/proveedores',
  acuerdos: '/acuerdos/acuerdos',
  calendario: '/acuerdos/calendario',
  historial: '/acuerdos/historial'
}

function vistaDeRuta(pathname: string): Vista {
  const entrada = (Object.entries(RUTAS_VISTA) as [Vista, string][]).find(([, ruta]) => ruta === pathname)
  return entrada?.[0] ?? 'dashboard'
}

const FORM_ACUERDO = {
  espacio_id: '',
  proveedor_id: '',
  fecha_inicio: '',
  fecha_fin: '',
  monto: '',
  frecuencia: '',
  tipo_pago: ''
}

/** El contrato adjunto elegido en el formulario (se sube al guardar). */
type ContratoElegido = { archivo: File } | { quitar: true } | null

const FORM_PROVEEDOR = { nombre: '', rif: '', contacto: '', telefono: '', correo: '' }

/**
 * ACUERDOS COMERCIALES
 * --------------------
 * El alquiler de espacios del piso de venta (cabezales, góndolas, checkout…)
 * a proveedores: el PLANO por sucursal con los espacios y su estado, el
 * REGISTRO de proveedores, los ACUERDOS con sus fechas y montos en dólares,
 * el CALENDARIO de cobros con su mora y comprobantes, el DASHBOARD de
 * rentabilidad y el HISTORIAL.
 *
 * Quién entra: LÍDER (sólo ve), COOR_ACU (crea y gestiona) y AUD_EX (marca
 * como cobrado) — la misma terna que `puede_ver_acuerdos()` en RLS. Los
 * controles se piden con `gestionaAcuerdos()` / `cobraAcuerdos()`.
 *
 * Los datos se cargan ENTEROS al abrir (son pocos) y todo lo que depende
 * de la fecha —vigencia, mora, calendario— se calcula en `lib/acuerdos.ts`.
 */
export function AcuerdosPage() {
  const { profile } = useAuth()
  const rol = profile?.rol ?? 'SIN_ROL'
  /** Crea y gestiona (Coordinador de Acuerdos). */
  const puedeGestionar = gestionaAcuerdos(rol)
  /** Registra cobros y comprobantes (Auditor). */
  const puedeCobrar = cobraAcuerdos(rol)

  // La vista sale de la URL (no de un state): al recargar o compartir el
  // enlace se queda en la misma pantalla.
  const { pathname } = useLocation()
  const vista = vistaDeRuta(pathname)
  /** El mes que mira el dashboard (`YYYY-MM`): hoy, hasta que se cambie. */
  const [mes, setMes] = useState(() => hoyISO().slice(0, 7))
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sucursales, setSucursales] = useState<SucursalAcuerdo[]>([])
  const [tipos, setTipos] = useState<TipoEspacio[]>([])
  const [frecuencias, setFrecuencias] = useState<OpcionCatalogo[]>([])
  const [tiposPago, setTiposPago] = useState<OpcionCatalogo[]>([])
  const [proveedores, setProveedores] = useState<Proveedor[]>([])
  const [planos, setPlanos] = useState<PlanoSucursal[]>([])
  const [acuerdos, setAcuerdos] = useState<AcuerdoConRelacion[]>([])
  const [cobros, setCobros] = useState<CobroConAcuerdo[]>([])
  /** La sucursal del plano y del selector de espacios. */
  const [sucursalId, setSucursalId] = useState('')
  const [espacios, setEspacios] = useState<Espacio[]>([])

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      const [suc, tip, fre, tpg, prov, plan, acu, cob, esp] = await Promise.all([
        listarSucursalesAcuerdos(),
        listarTiposEspacio(),
        listarCatalogo('FRECUENCIA'),
        listarCatalogo('TIPO_PAGO'),
        listarProveedores(),
        listarPlanos(),
        listarAcuerdos(),
        listarCobros(),
        listarEspaciosTodos()
      ])
      setSucursales(suc)
      setTipos(tip)
      setFrecuencias(fre)
      setTiposPago(tpg)
      setProveedores(prov)
      setPlanos(plan)
      setAcuerdos(acu)
      setCobros(cob)
      setEspacios(esp)
      setSucursalId((actual) => actual || suc[0]?.id || '')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar el módulo.')
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  /** Los espacios de la sucursal elegida: los pinta el plano y los ofrece el formulario. */
  const espaciosSucursal = useMemo(
    () => espacios.filter((e) => e.sucursal_id === sucursalId),
    [espacios, sucursalId]
  )

  /** El tipo de un espacio, para rotularlo. */
  const tipoDe = useCallback(
    (tipoId: string) => tipos.find((t) => t.id === tipoId)?.nombre ?? 'Espacio',
    [tipos]
  )

  /* ---------------------------------------------------------------------- */
  /* FORMULARIOS                                                            */
  /* ---------------------------------------------------------------------- */

  const [formAcuerdo, setFormAcuerdo] = useState<typeof FORM_ACUERDO | null>(null)
  const [editandoAcuerdo, setEditandoAcuerdo] = useState<string | null>(null)
  const [guardandoAcuerdo, setGuardandoAcuerdo] = useState(false)
  /** Qué hacer con el contrato al guardar: subir uno nuevo, quitar el actual, o no tocar nada. */
  const [contrato, setContrato] = useState<ContratoElegido>(null)

  /** El contrato que YA tiene el acuerdo que se está editando (si hay). */
  const contratoActual = useMemo(
    () => acuerdos.find((a) => a.id === editandoAcuerdo)?.contrato ?? null,
    [acuerdos, editandoAcuerdo]
  )

  /** Abre el contrato en otra pestaña (URL firmada: el bucket es privado). */
  const verContrato = async (ruta: string) => {
    try {
      const u = await urlFirmada(ruta)
      window.open(u, '_blank', 'noopener')
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'No se pudo abrir el contrato.', 'error')
    }
  }

  const [formProveedor, setFormProveedor] = useState<typeof FORM_PROVEEDOR | null>(null)
  const [editandoProveedor, setEditandoProveedor] = useState<string | null>(null)
  const [aBorrarProveedor, setABorrarProveedor] = useState<Proveedor | null>(null)
  const [aBorrarEspacio, setABorrarEspacio] = useState<Espacio | null>(null)
  const [aBorrarAcuerdo, setABorrarAcuerdo] = useState<AcuerdoConRelacion | null>(null)
  /** El borrado REAL (no la baja): se confirma aparte porque es definitivo. */
  const [aEliminar, setAEliminar] = useState<AcuerdoConRelacion | null>(null)

  const abrirAcuerdo = (acuerdo?: AcuerdoConRelacion) => {
    setEditandoAcuerdo(acuerdo?.id ?? null)
    setContrato(null)
    setFormAcuerdo(
      acuerdo
        ? {
            espacio_id: acuerdo.espacio_id,
            proveedor_id: acuerdo.proveedor_id,
            fecha_inicio: acuerdo.fecha_inicio,
            fecha_fin: acuerdo.fecha_fin,
            monto: String(acuerdo.monto_usd).replace('.', ','),
            frecuencia: acuerdo.frecuencia,
            tipo_pago: acuerdo.tipo_pago
          }
        : { ...FORM_ACUERDO }
    )
  }

  const guardarFormAcuerdo = async (e: FormEvent) => {
    e.preventDefault()
    if (!formAcuerdo) return
    const monto = Number(formAcuerdo.monto.replace(/\./g, '').replace(',', '.'))
    try {
      if (
        haySolape(
          acuerdos,
          formAcuerdo.espacio_id,
          formAcuerdo.fecha_inicio,
          formAcuerdo.fecha_fin,
          editandoAcuerdo ?? undefined
        )
      ) {
        throw new Error('Ese espacio ya tiene un acuerdo que se cruza en esas fechas.')
      }
      setGuardandoAcuerdo(true)
      const id = await guardarAcuerdo({
        id: editandoAcuerdo ?? undefined,
        espacio_id: formAcuerdo.espacio_id,
        proveedor_id: formAcuerdo.proveedor_id,
        fecha_inicio: formAcuerdo.fecha_inicio,
        fecha_fin: formAcuerdo.fecha_fin,
        monto_usd: monto,
        frecuencia: formAcuerdo.frecuencia,
        tipo_pago: formAcuerdo.tipo_pago
      })
      // El contrato se sube DESPUÉS, porque la carpeta necesita el id.
      if (contrato && 'archivo' in contrato) {
        await subirContrato(id, contrato.archivo)
      } else if (contrato && 'quitar' in contrato) {
        await quitarContrato(id)
      }
      avisar(editandoAcuerdo ? 'Acuerdo actualizado.' : 'Acuerdo creado.')
      setFormAcuerdo(null)
      setEditandoAcuerdo(null)
      setContrato(null)
      await cargar()
    } catch (e2) {
      avisar(e2 instanceof Error ? e2.message : 'No se pudo guardar el acuerdo.', 'error')
    } finally {
      setGuardandoAcuerdo(false)
    }
  }

  const guardarFormProveedor = async (e: FormEvent) => {
    e.preventDefault()
    if (!formProveedor) return
    try {
      await guardarProveedor({
        id: editandoProveedor ?? undefined,
        nombre: formProveedor.nombre,
        rif: formProveedor.rif,
        contacto: formProveedor.contacto,
        telefono: formProveedor.telefono,
        correo: formProveedor.correo
      })
      avisar(editandoProveedor ? 'Proveedor actualizado.' : 'Proveedor creado.')
      setFormProveedor(null)
      setEditandoProveedor(null)
      await cargar()
    } catch (e2) {
      avisar(e2 instanceof Error ? e2.message : 'No se pudo guardar el proveedor.', 'error')
    }
  }

  /** Baja lógica: sus acuerdos y cobros quedan intactos. */
  const borrarProveedor = async () => {
    if (!aBorrarProveedor) return
    try {
      await eliminarProveedor(aBorrarProveedor.id)
      avisar('Proveedor eliminado.')
      setABorrarProveedor(null)
      await cargar()
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'No se pudo eliminar el proveedor.', 'error')
    }
  }

  /** Una opción nueva de un select (frecuencia o tipo de pago). */
  const crearOpcion = async (clase: ClaseCatalogo, valor: string): Promise<string> => {
    try {
      const creada = await crearOpcionCatalogo(clase, valor)
      if (clase === 'FRECUENCIA') setFrecuencias((prev) => [...prev, creada])
      else setTiposPago((prev) => [...prev, creada])
      avisar(`Opción «${creada.valor}» agregada.`)
      return creada.valor
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'No se pudo crear la opción.', 'error')
      return ''
    }
  }


  const borrarEspacio = async () => {
    if (!aBorrarEspacio) return
    try {
      await eliminarEspacio(aBorrarEspacio.id)
      avisar('Espacio fuera del plano (su historial sigue).')
      setABorrarEspacio(null)
      setEspacios(await listarEspaciosTodos())
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'No se pudo quitar el espacio.', 'error')
    }
  }

  const borrarAcuerdo = async () => {
    if (!aBorrarAcuerdo) return
    try {
      await darDeBajaAcuerdo(aBorrarAcuerdo.id)
      avisar('Acuerdo dado de baja: queda en el historial.')
      setABorrarAcuerdo(null)
      await cargar()
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'No se pudo dar de baja el acuerdo.', 'error')
    }
  }

  /** El borrado definitivo: se lleva el acuerdo y TODOS sus cobros. */
  const eliminarAcuerdoDefinitivo = async () => {
    if (!aEliminar) return
    try {
      await eliminarAcuerdo(aEliminar.id)
      avisar('Acuerdo eliminado junto con sus cobros.')
      setAEliminar(null)
      await cargar()
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'No se pudo eliminar el acuerdo.', 'error')
    }
  }

  /** Cuántos cobros se pierden con el borrado (para el cartel de confirmación). */
  const cobrosDe = (acuerdoId: string) => cobros.filter((c) => c.acuerdo_id === acuerdoId).length

  /* ---------------------------------------------------------------------- */

  if (cargando) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <SkeletonFilas n={8} />
      </div>
    )
  }

  if (error) {
    return (
      <div>
        <EmptyState title="No se pudo cargar Acuerdos Comerciales" subtitle={error} />
        <button
          onClick={() => void cargar()}
          className="mt-3 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          Reintentar
        </button>
      </div>
    )
  }


  return (
    <div className="space-y-4">
      {/* La navegación entre vistas vive en la BARRA LATERAL (submenús de
          «Comercial»); en la cabecera queda la acción principal y el FILTRO
          DE MES del dashboard. */}
      <PortalCabecera>
        <div className="flex flex-wrap items-center gap-2">
          {vista === 'dashboard' ? (
            <label
              className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700"
              title="Filtra «Negociado vs recaudado» y «Factura vs nota de crédito»"
            >
              <CalendarDays className="h-4 w-4 text-slate-400" aria-hidden />
              <span className="hidden text-slate-400 sm:inline">Mes</span>
              <input
                type="month"
                value={mes}
                onChange={(e) => setMes(e.target.value || hoyISO().slice(0, 7))}
                aria-label="Mes del dashboard"
                className="w-[7.5rem] border-0 bg-transparent p-0 text-xs font-bold text-slate-800 focus:outline-none"
              />
            </label>
          ) : null}

          {puedeGestionar && vista !== 'planos' ? (
            <button
              type="button"
              onClick={() => abrirAcuerdo()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2 text-xs font-bold text-white shadow-sm transition-colors hover:bg-primary-700 cursor-pointer"
            >
              <Plus className="h-4 w-4 stroke-[2.5]" />
              <span>Nuevo acuerdo</span>
            </button>
          ) : null}
        </div>
      </PortalCabecera>

      {/* ===================== VISTA: DASHBOARD ===================== */}
      {vista === 'dashboard' ? (
        <DashboardAcuerdos
          sucursales={sucursales}
          espacios={espacios}
          acuerdos={acuerdos}
          cobros={cobros}
          tipos={tipos}
          mes={mes}
        />
      ) : null}

      {/* ===================== VISTA: PLANOS ===================== */}
      {vista === 'planos' ? (
        <PlanoAcuerdos
          sucursales={sucursales}
          sucursalId={sucursalId}
          onSucursal={setSucursalId}
          planos={planos}
          espacios={espaciosSucursal}
          tipos={tipos}
          acuerdos={acuerdos}
          cobros={cobros}
          puedeGestionar={puedeGestionar}
          onRecargar={() => void cargar()}
          onRecargarEspacios={async () => setEspacios(await listarEspaciosTodos())}
          tipoDe={tipoDe}
          onBorrarEspacio={setABorrarEspacio}
          onGuardarEspacio={async (entrada) => {
            await guardarEspacio(entrada)
            avisar('Espacio guardado.')
            setEspacios(await listarEspaciosTodos())
          }}
        />
      ) : null}

      {/* ===================== VISTA: PROVEEDORES ===================== */}
      {vista === 'proveedores' ? (
        <section className="space-y-4">
          {puedeGestionar ? (
            <div className="flex justify-end">
              <Button
                onClick={() => {
                  setEditandoProveedor(null)
                  setFormProveedor({ ...FORM_PROVEEDOR })
                }}
              >
                <Plus className="h-4 w-4" /> Nuevo proveedor
              </Button>
            </div>
          ) : null}

          {proveedores.length === 0 ? (
            <EmptyState
              title="Sin proveedores"
              subtitle={
                puedeGestionar
                  ? 'Cargá el primer proveedor para poder alquilarle espacios.'
                  : 'Todavía no se registró ningún proveedor.'
              }
            />
          ) : (
            <div className="rounded-2xl border border-slate-200 bg-white">
              <table className="w-full table-fixed text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs font-bold uppercase tracking-wide text-slate-400">
                    <th className="w-[26%] px-3 py-3">Nombre del proveedor</th>
                    <th className="w-[14%] px-3 py-3">RIF</th>
                    <th className="w-[18%] px-3 py-3">Contacto</th>
                    <th className="w-[16%] px-3 py-3">Teléfono</th>
                    <th className="w-[20%] px-3 py-3">Correo</th>
                    {puedeGestionar ? <th className="w-[6%] px-3 py-3 text-right">Acciones</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {proveedores.map((p) => (
                    <tr key={p.id} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="px-3 py-3">
                        <span className="flex items-center gap-2">
                          <span
                            className="h-3 w-3 shrink-0 rounded-full border border-white shadow"
                            style={{ backgroundColor: colorDe(p.color) }}
                            aria-hidden
                          />
                          <span
                            className="min-w-0 truncate text-xs font-semibold uppercase text-slate-900"
                            title={p.nombre}
                          >
                            {p.nombre}
                          </span>
                        </span>
                      </td>
                      <td className="truncate px-3 py-3 font-mono text-xs uppercase text-slate-600" title={p.rif}>
                        {p.rif || '—'}
                      </td>
                      <td className="truncate px-3 py-3 text-xs uppercase text-slate-600" title={p.contacto}>
                        {p.contacto || '—'}
                      </td>
                      <td className="truncate px-3 py-3 font-mono text-xs uppercase text-slate-600" title={p.telefono}>
                        {p.telefono || '—'}
                      </td>
                      <td className="px-3 py-3 text-xs uppercase" title={p.correo}>
                        {p.correo ? (
                          <a
                            href={`mailto:${p.correo}`}
                            className="block truncate text-slate-600 hover:text-primary-700 hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {p.correo}
                          </a>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>
                      {puedeGestionar ? (
                        <td className="px-3 py-3">
                          <span className="flex justify-end gap-1">
                            <ButtonIcon
                              onClick={() => {
                                setEditandoProveedor(p.id)
                                setFormProveedor({
                                  nombre: p.nombre,
                                  rif: p.rif,
                                  contacto: p.contacto,
                                  telefono: p.telefono,
                                  correo: p.correo
                                })
                              }}
                              title="Editar proveedor"
                              aria-label={`Editar ${p.nombre}`}
                            >
                              <Pencil className="h-4 w-4" />
                            </ButtonIcon>
                            <ButtonIcon
                              onClick={() => setABorrarProveedor(p)}
                              title="Eliminar proveedor"
                              aria-label={`Eliminar ${p.nombre}`}
                            >
                              <Trash2 className="h-4 w-4 text-red-500" />
                            </ButtonIcon>
                          </span>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      {/* ===================== VISTA: ACUERDOS ===================== */}
      {vista === 'acuerdos' ? (
        <section className="space-y-4">
          {/* El selector de espacios necesita la sucursal: se elige arriba
              (es la misma que usa el plano). */}
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Sucursal</span>
            <Select value={sucursalId} onChange={(e) => setSucursalId(e.target.value)} aria-label="Sucursal del plano">
              {sucursales.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombre}
                </option>
              ))}
            </Select>
            <span className="text-xs text-slate-500">
              {espaciosSucursal.length} {espaciosSucursal.length === 1 ? 'espacio cargado' : 'espacios cargados'}
              {planos.some((p) => p.sucursal_id === sucursalId) ? '' : ' · sin plano cargado'}
            </span>
          </div>

          {acuerdos.length === 0 ? (
            <EmptyState
              title="Sin acuerdos"
              subtitle={
                puedeGestionar
                  ? 'Creá el primer acuerdo: espacio, proveedor, fechas, monto y frecuencia.'
                  : 'Todavía no se registró ningún acuerdo comercial.'
              }
            />
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
              <table className="w-full min-w-[900px] text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs font-bold uppercase tracking-wide text-slate-400">
                    <th className="px-4 py-3">Espacio</th>
                    <th className="px-4 py-3">Proveedor</th>
                    <th className="px-4 py-3">Vigencia</th>
                    <th className="px-4 py-3 text-right">Monto</th>
                    <th className="px-4 py-3">Frecuencia</th>
                    <th className="px-4 py-3">Tipo de pago</th>
                    <th className="px-4 py-3">Estado</th>
                    <th className="px-4 py-3">Contrato</th>
                    <th className="px-4 py-3 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {acuerdos.map((a) => {
                    const tipo = a.espacio ? tipoDe(a.espacio.tipo_id) : ''
                    const estado = !a.activo
                      ? 'Baja'
                      : vigente(a)
                        ? 'Vigente'
                        : a.fecha_fin < hoy()
                          ? 'Vencido'
                          : 'Próximo'
                    return (
                      <tr key={a.id} className="border-t border-slate-100">
                        <td className="px-4 py-3">
                          <span className="font-mono text-xs font-bold text-primary">{a.espacio?.codigo ?? '—'}</span>
                          <span className="block text-xs text-slate-500">
                            {tipo}
                            {a.espacio?.detalle ? ` · ${a.espacio.detalle}` : ''}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="flex items-center gap-2 font-semibold text-slate-800">
                            <span
                              className="h-3 w-3 shrink-0 rounded-full"
                              style={{ backgroundColor: colorDe(a.proveedor?.color) }}
                              aria-hidden
                            />
                            {a.proveedor?.nombre ?? '—'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-600">
                          {fechaCorta(a.fecha_inicio)} → {fechaCorta(a.fecha_fin)}
                        </td>
                        <td className="px-4 py-3 text-right font-bold tabular-nums text-slate-900">
                          {usd(a.monto_usd)}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-600">{a.frecuencia}</td>
                        <td className="px-4 py-3 text-xs text-slate-600">{a.tipo_pago}</td>
                        <td className="px-4 py-3">
                          <Badge
                            color={
                              estado === 'Vigente' ? 2 : estado === 'Vencido' ? 4 : estado === 'Baja' ? 0 : 3
                            }
                          >
                            {estado}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          {a.contrato ? (
                            <button
                              type="button"
                              onClick={() => void verContrato(a.contrato!)}
                              title="Ver contrato adjunto"
                              aria-label={`Ver el contrato de ${a.proveedor?.nombre ?? ''}`}
                              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
                            >
                              <Paperclip className="h-3.5 w-3.5" /> Ver
                            </button>
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {puedeGestionar ? (
                            <span className="inline-flex gap-1">
                              <ButtonIcon onClick={() => abrirAcuerdo(a)} title="Editar acuerdo" aria-label={`Editar acuerdo de ${a.proveedor?.nombre ?? ''}`}>
                                <Pencil className="h-4 w-4" />
                              </ButtonIcon>
                              {a.activo ? (
                                <ButtonIcon
                                  variant="dangerGhost"
                                  onClick={() => setABorrarAcuerdo(a)}
                                  title="Dar de baja (queda en el historial)"
                                  aria-label={`Dar de baja el acuerdo de ${a.proveedor?.nombre ?? ''}`}
                                >
                                  <X className="h-4 w-4" />
                                </ButtonIcon>
                              ) : null}
                              <ButtonIcon
                                variant="dangerGhost"
                                onClick={() => setAEliminar(a)}
                                title="Eliminar definitivamente (con sus cobros)"
                                aria-label={`Eliminar el acuerdo de ${a.proveedor?.nombre ?? ''}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </ButtonIcon>
                            </span>
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      {/* ===================== VISTA: CALENDARIO ===================== */}
      {vista === 'calendario' ? (
        <CalendarioAcuerdos
          acuerdos={acuerdos}
          cobros={cobros}
          puedeCobrar={puedeCobrar}
          onRegistrar={async (entrada) => {
            try {
              await registrarCobro(entrada)
              avisar('Cobro registrado.')
              setCobros(await listarCobros())
            } catch (e) {
              avisar(e instanceof Error ? e.message : 'No se pudo registrar el cobro.', 'error')
            }
          }}
          onDeshacer={async (id) => {
            try {
              await deshacerCobro(id)
              avisar('Cobro deshecho.')
              setCobros(await listarCobros())
            } catch (e) {
              avisar(e instanceof Error ? e.message : 'No se pudo deshacer el cobro.', 'error')
            }
          }}
        />
      ) : null}

      {/* ===================== VISTA: HISTORIAL ===================== */}
      {vista === 'historial' ? (
        <HistorialAcuerdos acuerdos={acuerdos} cobros={cobros} sucursales={sucursales} tipoDe={tipoDe} />
      ) : null}

      {/* ===================== MODAL: ACUERDO ===================== */}
      <Modal
        open={!!formAcuerdo}
        onClose={() => {
          setFormAcuerdo(null)
          setEditandoAcuerdo(null)
          setContrato(null)
        }}
        title={editandoAcuerdo ? 'Editar acuerdo comercial' : 'Nuevo acuerdo comercial'}
        wide
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                setFormAcuerdo(null)
                setEditandoAcuerdo(null)
                setContrato(null)
              }}
              disabled={guardandoAcuerdo}
            >
              Cancelar
            </Button>
            <Button type="submit" form="form-acuerdo" disabled={guardandoAcuerdo}>
              {guardandoAcuerdo ? <Spinner size={16} /> : null}
              {editandoAcuerdo ? 'Guardar cambios' : 'Crear acuerdo'}
            </Button>
          </div>
        }
      >
        {formAcuerdo ? (
          <form id="form-acuerdo" className="space-y-4" onSubmit={(e) => void guardarFormAcuerdo(e)}>
            {/* Cada «recuadro» muestra su título y, al elegirlo, despliega
                las opciones — con salida para crear la que falte. */}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Sucursal del espacio">
                <Select
                  value={sucursalId}
                  onChange={(e) => setSucursalId(e.target.value)}
                  aria-label="Sucursal del espacio"
                >
                  {sucursales.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.nombre}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Espacio en piso de venta" hint="Ubicación exacta; si falta, créalo en Planos.">
                <Select
                  value={formAcuerdo.espacio_id}
                  onChange={(e) => setFormAcuerdo((f) => (f ? { ...f, espacio_id: e.target.value } : f))}
                  required
                >
                  <option value="">— Elegí el espacio —</option>
                  {espaciosSucursal.map((esp) => (
                    <option key={esp.id} value={esp.id}>
                      {esp.codigo} · {tipoDe(esp.tipo_id)}
                      {esp.detalle ? ` — ${esp.detalle}` : ''}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Proveedor">
                <div className="flex gap-2">
                  <Select
                    value={formAcuerdo.proveedor_id}
                    onChange={(e) => setFormAcuerdo((f) => (f ? { ...f, proveedor_id: e.target.value } : f))}
                    required
                    className="flex-1"
                  >
                    <option value="">— Elegí el proveedor —</option>
                    {proveedores.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nombre}
                      </option>
                    ))}
                  </Select>
                  <button
                    type="button"
                    onClick={() => {
                      setEditandoProveedor(null)
                      setFormProveedor({ ...FORM_PROVEEDOR })
                    }}
                    title="Registrar un proveedor nuevo"
                    aria-label="Registrar un proveedor nuevo"
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 cursor-pointer"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              </Field>
              <Field label="Monto de renta (USD)">
                <Input
                  inputMode="decimal"
                  value={formAcuerdo.monto}
                  onChange={(e) => setFormAcuerdo((f) => (f ? { ...f, monto: e.target.value } : f))}
                  placeholder="Ej: 120,00"
                  required
                />
              </Field>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Fecha de inicio">
                <Input
                  type="date"
                  value={formAcuerdo.fecha_inicio}
                  onChange={(e) => setFormAcuerdo((f) => (f ? { ...f, fecha_inicio: e.target.value } : f))}
                  required
                />
              </Field>
              <Field label="Fecha de fin">
                <Input
                  type="date"
                  value={formAcuerdo.fecha_fin}
                  onChange={(e) => setFormAcuerdo((f) => (f ? { ...f, fecha_fin: e.target.value } : f))}
                  min={formAcuerdo.fecha_inicio || undefined}
                  required
                />
              </Field>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <SelectorNuevo
                etiqueta="Frecuencia de pago"
                valor={formAcuerdo.frecuencia}
                opciones={frecuencias.map((f) => f.valor)}
                onElegir={(v) => setFormAcuerdo((f) => (f ? { ...f, frecuencia: v } : f))}
                onCrear={(v) => crearOpcion('FRECUENCIA', v)}
                placeholder="Ej: Quincenal"
              />
              <SelectorNuevo
                etiqueta="Tipo de pago"
                valor={formAcuerdo.tipo_pago}
                opciones={tiposPago.map((t) => t.valor)}
                onElegir={(v) => setFormAcuerdo((f) => (f ? { ...f, tipo_pago: v } : f))}
                onCrear={(v) => crearOpcion('TIPO_PAGO', v)}
                placeholder="Ej: Nota de crédito"
              />
            </div>

            {/* EL CONTRATO ADJUNTO: se sube al guardar (PDF o imagen). */}
            <Field
              label="Contrato (adjunto)"
              hint={
                contratoActual
                  ? 'Ya hay un contrato cargado: elegí otro archivo para reemplazarlo.'
                  : 'PDF o imagen, opcional. Se sube al guardar el acuerdo.'
              }
            >
              <div className="space-y-2">
                <input
                  type="file"
                  accept="application/pdf,image/png,image/jpeg,image/webp,image/gif"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    setContrato(f ? { archivo: f } : null)
                    e.target.value = ''
                  }}
                  className="block w-full text-xs text-slate-600 file:mr-3 file:rounded-xl file:border file:border-slate-200 file:bg-white file:px-3 file:py-1.5 file:text-xs file:font-bold file:text-slate-700 hover:file:bg-slate-50"
                />
                {contrato && 'archivo' in contrato ? (
                  <p className="rounded-xl bg-primary-50 px-3 py-2 text-xs font-semibold text-primary-900">
                    Se adjuntará: {contrato.archivo.name}
                  </p>
                ) : null}
                {contratoActual ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void verContrato(contratoActual)}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
                    >
                      <Paperclip className="h-3.5 w-3.5" /> Ver contrato actual
                    </button>
                    {!contrato || !('quitar' in contrato) ? (
                      <button
                        type="button"
                        onClick={() => setContrato({ quitar: true })}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-white px-3 py-1.5 text-xs font-bold text-red-600 hover:bg-red-50 cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Quitar contrato
                      </button>
                    ) : (
                      <span className="rounded-xl bg-red-50 px-3 py-1.5 text-xs font-bold text-red-600">
                        Se quitará al guardar
                      </span>
                    )}
                  </div>
                ) : null}
              </div>
            </Field>

            <p className="rounded-xl bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
              Con estas fechas y frecuencia se generan {fechasDeCobro(formAcuerdo.fecha_inicio, formAcuerdo.fecha_fin, formAcuerdo.frecuencia).length}{' '}
              {fechasDeCobro(formAcuerdo.fecha_inicio, formAcuerdo.fecha_fin, formAcuerdo.frecuencia).length === 1
                ? 'fecha de cobro'
                : 'fechas de cobro'}{' '}
              en el calendario.
            </p>
          </form>
        ) : null}
      </Modal>

      {/* ===================== MODAL: PROVEEDOR ===================== */}
      <Modal
        open={!!formProveedor}
        onClose={() => {
          setFormProveedor(null)
          setEditandoProveedor(null)
        }}
        title={editandoProveedor ? 'Editar proveedor' : 'Nuevo proveedor'}
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                setFormProveedor(null)
                setEditandoProveedor(null)
              }}
            >
              Cancelar
            </Button>
            <Button type="submit" form="form-proveedor">
              {editandoProveedor ? 'Guardar cambios' : 'Crear proveedor'}
            </Button>
          </div>
        }
      >
        {formProveedor ? (
          <form id="form-proveedor" className="space-y-4" onSubmit={(e) => void guardarFormProveedor(e)}>
            <Field label="Nombre del proveedor">
              <Input
                value={formProveedor.nombre}
                onChange={(e) => setFormProveedor((f) => (f ? { ...f, nombre: e.target.value } : f))}
                required
                placeholder="Ej: PUBLICIDAD NORTE C.A."
                className="uppercase"
                autoFocus
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2 [&_input]:uppercase">
              <Field label="RIF" hint="Opcional.">
                <Input
                  value={formProveedor.rif}
                  onChange={(e) => setFormProveedor((f) => (f ? { ...f, rif: e.target.value } : f))}
                  placeholder="Ej: J-12345678-9"
                />
              </Field>
              <Field label="Contacto (persona)" hint="Opcional.">
                <Input
                  value={formProveedor.contacto}
                  onChange={(e) => setFormProveedor((f) => (f ? { ...f, contacto: e.target.value } : f))}
                  placeholder="Ej: María González"
                />
              </Field>
              <Field label="Teléfono" hint="Opcional.">
                <Input
                  value={formProveedor.telefono}
                  onChange={(e) => setFormProveedor((f) => (f ? { ...f, telefono: e.target.value } : f))}
                  placeholder="Ej: 0414-1234567"
                />
              </Field>
              <Field label="Correo" hint="Opcional.">
                <Input
                  type="email"
                  value={formProveedor.correo}
                  onChange={(e) => setFormProveedor((f) => (f ? { ...f, correo: e.target.value } : f))}
                  placeholder="Ej: contacto@proveedor.com"
                />
              </Field>
            </div>
            <p className="rounded-xl bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
              El color del proveedor se asigna solo y es el que lo pinta en la lista y a su espacio en el
              plano. Los espacios rentados dejan de estar en blanco.
            </p>
          </form>
        ) : null}
      </Modal>

      <Confirmar
        open={!!aBorrarProveedor}
        texto={`¿Eliminar el proveedor ${aBorrarProveedor?.nombre ?? ''}? Sus acuerdos y cobros quedan en el historial.`}
        textoConfirmar="Eliminar"
        onConfirm={() => void borrarProveedor()}
        onCancel={() => setABorrarProveedor(null)}
      />
      <Confirmar
        open={!!aBorrarEspacio}
        texto={`¿Quitar el espacio ${aBorrarEspacio?.codigo} del plano? Su historial de rentas se conserva.`}
        textoConfirmar="Quitar del plano"
        onConfirm={() => void borrarEspacio()}
        onCancel={() => setABorrarEspacio(null)}
      />
      <Confirmar
        open={!!aBorrarAcuerdo}
        texto={`¿Dar de baja el acuerdo con ${aBorrarAcuerdo?.proveedor?.nombre ?? ''}? Queda en el historial, sin efecto desde hoy.`}
        textoConfirmar="Dar de baja"
        onConfirm={() => void borrarAcuerdo()}
        onCancel={() => setABorrarAcuerdo(null)}
      />
      <Confirmar
        open={!!aEliminar}
        texto={`¿Eliminar el acuerdo con ${aEliminar?.proveedor?.nombre ?? ''}? Es DEFINITIVO: se borra él${
          aEliminar?.contrato ? ', su contrato adjunto' : ''
        }${
          aEliminar && cobrosDe(aEliminar.id)
            ? ` y sus ${cobrosDe(aEliminar.id)} ${cobrosDe(aEliminar.id) === 1 ? 'cobro registrado' : 'cobros registrados'} con sus comprobantes`
            : ''
        }. No queda en el historial.`}
        textoConfirmar="Eliminar"
        onConfirm={() => void eliminarAcuerdoDefinitivo()}
        onCancel={() => setAEliminar(null)}
      />
    </div>
  )
}

/** Fecha corta `20/11/2026` desde un ISO. */
function fechaCorta(iso: string): string {
  if (!iso) return '—'
  const [a, m, d] = iso.split('-')
  return `${d}/${m}/${a}`
}

function hoy(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Un select que también CREA la opción que falta: muestra el valor actual,
 * despliega las opciones y la última entrada «＋ Crear nueva…» abre un campo
 * para escribirla. Es el mismo patrón para frecuencia y tipo de pago.
 */
function SelectorNuevo({
  etiqueta,
  valor,
  opciones,
  onElegir,
  onCrear,
  placeholder
}: {
  etiqueta: string
  valor: string
  opciones: string[]
  onElegir: (v: string) => void
  onCrear: (v: string) => Promise<string>
  placeholder: string
}) {
  const [creando, setCreando] = useState(false)
  const [texto, setTexto] = useState('')

  return (
    <Field label={etiqueta}>
      {creando ? (
        <div className="flex gap-2">
          <Input
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder={placeholder}
            autoFocus
            aria-label={`Nueva opción de ${etiqueta}`}
          />
          <button
            type="button"
            onClick={async () => {
              const creada = await onCrear(texto)
              if (creada) {
                onElegir(creada)
                setTexto('')
                setCreando(false)
              }
            }}
            className="shrink-0 rounded-xl bg-primary px-3 text-xs font-bold text-white hover:bg-primary-700 cursor-pointer"
          >
            Agregar
          </button>
          <button
            type="button"
            onClick={() => {
              setCreando(false)
              setTexto('')
            }}
            className="shrink-0 rounded-xl border border-slate-200 px-3 text-xs font-bold text-slate-600 hover:bg-slate-50 cursor-pointer"
          >
            Cancelar
          </button>
        </div>
      ) : (
        <Select value={valor} onChange={(e) => (e.target.value === '__nuevo__' ? setCreando(true) : onElegir(e.target.value))}>
          <option value="">— Elegí —</option>
          {opciones.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
          <option value="__nuevo__">＋ Crear nueva…</option>
        </Select>
      )}
    </Field>
  )
}
