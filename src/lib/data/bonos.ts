import { supabase } from '../supabase'
import { listarSucursalesAdmin } from './catalog'
import {
  cedula,
  departamentoDeColaborador,
  estadoDeColaborador,
  listarColaboradores,
  nombreCompleto,
  trabajadoresDeCargoExacto,
  type ColaboradorAPI
} from './colaboradores'
import { claveNormalizada } from './responsables'

/**
 * Bonos por desempeño: la configuración (`bonos_cargo`) y su pago
 * (`bonos_pago`).
 *
 * LA REGLA, EN UNA LÍNEA
 * ----------------------
 * La nota se carga a mano en cada pago y con ella se calcula el monto:
 * por debajo del umbral del cargo no se cobra nada (0 a 69 con umbral 70) y
 * desde el umbral en adelante se paga el porcentaje obtenido
 * (`monto × nota / 100`). Eso vive en `montoACobrar`, que es puro y está
 * probado aparte: la tabla sólo guarda la foto del resultado.
 *
 * El período lo define la periodicidad del CARGO (mensual o trimestral), por
 * eso `periodo` es un texto con dos caras: `2026-11` y `2026-T1`.
 */

export type Periodicidad = 'MENSUAL' | 'TRIMESTRAL'

export type EstadoPago = 'PENDIENTE' | 'PAGADO'

/**
 * Una sucursal dentro del alcance de un cargo.
 *
 * `monto` NULL = usa el monto base del cargo; con valor = el monto de ESA
 * sucursal, que es como se cubre «montos distintos por tipo de tienda».
 */
export interface BonoCargoSucursal {
  sucursal_id: string
  monto: number | null
}

export interface BonoCargo {
  id: string
  cargo: string
  /** `cargo` normalizado: es contra lo que se garantiza la unicidad en la base. */
  clave: string
  activo: boolean
  monto: number
  nota_minima: number
  periodicidad: Periodicidad
  /**
   * Departamento al que acota el bono: NULL = cualquier departamento.
   *
   * Es lo que separa dos «Comprador/a» del mismo cargo en áreas distintas
   * (Compras vs Servicios Generales): con área acotada sólo cuentan y cobran
   * las personas de esa área, y dos filas con áreas distintas pueden convivir
   * en la MISMA sucursal.
   */
  departamento: string | null
  /**
   * El alcance: SÓLO estas sucursales. **Vacío = aplica a todas** con el
   * monto base. No es un campo de la tabla: son las filas de
   * `bonos_cargo_sucursal`, leídas con la plantilla.
   */
  sucursales: BonoCargoSucursal[]
  created_at: string
  updated_at: string
}

export interface BonoPago {
  id: string
  bono_cargo_id: string
  periodo: string
  sucursal_id: string
  nacionalidad: string
  dni: number
  nombre: string
  cargo: string
  /** Departamento del cargo al que pertenece ESTA persona, congelado. */
  departamento: string | null
  monto_base: number
  nota_minima: number
  nota: number | null
  monto: number
  estado: EstadoPago
  pagado_en: string | null
  pagado_por: string | null
  observaciones: string | null
  created_at: string
  updated_at: string
  /** Embebido por el join con `sucursales` en `listarPagos`. */
  sucursal?: { nombre: string } | null
}

/** Lo que se guarda al crear o editar un cargo con bono. */
export interface BonoCargoEntrada {
  id?: string
  cargo: string
  activo: boolean
  monto: number
  nota_minima: number
  periodicidad: Periodicidad
  /** Departamento al que acota; vacío o null = cualquier departamento. */
  departamento: string | null
  /** El alcance elegido: vacío = todas las sucursales. */
  sucursales: BonoCargoSucursal[]
}

/* --- La regla de negocio (pura) ------------------------------------------- */

/**
 * El monto a cobrar: nota bajo el umbral no paga nada; desde el umbral en
 * adelante se paga el porcentaje obtenido (monto × nota / 100).
 *
 * Sin nota el resultado es 0 —no se inventa un cobro—, que es también lo que
 * guarda la base mientras la nota siga vacía. El redondeo va a dos decimales
 * porque es plata: `85.555…` no existe en un recibo.
 */
export function montoACobrar(montoBase: number, nota: number | null, notaMinima: number): number {
  if (nota == null || !Number.isFinite(nota)) return 0
  if (nota < notaMinima) return 0
  return Math.round(montoBase * (nota / 100) * 100) / 100
}

/**
 * El monto que le corresponde a una sucursal para ESTE cargo.
 *
 * El alcance es el que decide: sin sucursales marcadas el cargo aplica a
 * todas con su monto base; con alcance, sólo a las del conjunto, cada una con
 * el suyo (o el del cargo si no trae uno propio). **Fuera del conjunto
 * devuelve NULL**, que se lee como «este cargo no se paga acá».
 */
export function montoParaSucursal(cfg: Pick<BonoCargo, 'monto' | 'sucursales'>, sucursalId: string): number | null {
  if (!cfg.sucursales.length) return cfg.monto
  const fila = cfg.sucursales.find((s) => s.sucursal_id === sucursalId)
  if (!fila) return null
  return fila.monto ?? cfg.monto
}

/** Un ocupante tal como lo cuenta la nómina, con la sucursal donde entra. */
export interface DetalleOcupante {
  sucursal_id: string
  nacionalidad: string
  dni: number
  nombre: string
  /** El cargo tal como está escrito en la nómina: es POR QUÉ se lo contó. */
  cargo_nomina: string
  /** El departamento que trae la persona (`department_name`): vacío si no trae. */
  departamento_nomina: string
  /** El estado que trae la persona (`status`…): «Nuevo ingreso» cuenta como activo. */
  estado_nomina: string
  /** El monto de SU sucursal en este cargo: el que se le aplica. */
  monto: number
}

/**
 * Quiénes son los ocupantes de un cargo: una lista, una fila por PERSONA.
 *
 * Tres reglas, y las tres van contra el gasto de más:
 *
 *  1. Sólo ACTIVOS (`esActivo`): el estado puede venir como booleano, número
 *     o string, y también como `is_active`; cualquier forma de «no» queda
 *     afuera, y sin flag tampoco se cuenta.
 *  2. Cargo EXACTO (`trabajadoresDeCargoExacto`): «Gerente de mercado» no
 *     alcanza a cualquier «Gerente» ni a un «Gerente de Mercado Regional»
 *     que pasa por cuatro tiendas.
 *  3. Una sola vez por persona, aunque aparezca en la nómina de DOS
 *     sucursales de su alcance: un cargo único por tienda no se cobra dos
 *     veces. Si eso pasa, manda la primera sucursal en orden de id —y ese
 *     orden es estable para que el número no cambie de una corrida a otra.
 */
export function ocupantesDeCargo(
  cfg: Pick<BonoCargo, 'cargo' | 'monto' | 'departamento' | 'sucursales'>,
  porSucursal: ReadonlyMap<string, readonly ColaboradorAPI[]>
): DetalleOcupante[] {
  const vistos = new Set<string>()
  const salida: DetalleOcupante[] = []
  for (const sucursalId of Array.from(porSucursal.keys()).sort()) {
    const monto = montoParaSucursal(cfg, sucursalId)
    if (monto == null) continue
    for (const c of trabajadoresDeCargoExacto(porSucursal.get(sucursalId) ?? [], cfg.cargo, cfg.departamento)) {
      if (c.dni == null) continue
      const nacionalidad = (c.nationality ?? 'V').trim() || 'V'
      const clave = `${nacionalidad}|${c.dni}`
      if (vistos.has(clave)) continue
      vistos.add(clave)
      salida.push({
        sucursal_id: sucursalId,
        nacionalidad,
        dni: c.dni,
        nombre: nombreCompleto(c) || `DNI ${c.dni}`,
        cargo_nomina: c.role_name ?? '',
        departamento_nomina: departamentoDeColaborador(c),
        estado_nomina: estadoDeColaborador(c),
        monto
      })
    }
  }
  return salida
}

/**
 * El gasto NOMINAL de un cargo: ocupantes × el monto de SU sucursal, sumado.
 *
 * Es el TECHO del gasto, no el pago final: con las notas cargadas cada fila
 * se prorratea hacia abajo (`montoACobrar`), y el total real vive en la
 * pestaña Pagos. Acá se multiplica para que al configurar se vea de una
 * cuánto sale el cargo antes de tocar una sola nota.
 *
 * Sin nómina leída no hay ocupantes que contar: devuelve ceros, y la
 * pantalla lo pinta como «—» con su aviso, no como un gasto de cero.
 */
export function gastoDeCargo(
  cfg: Pick<BonoCargo, 'cargo' | 'monto' | 'departamento' | 'sucursales'>,
  porSucursal: ReadonlyMap<string, readonly ColaboradorAPI[]>
): { ocupantes: number; gasto: number } {
  const ocupantes = ocupantesDeCargo(cfg, porSucursal)
  const gasto = ocupantes.reduce((acc, o) => acc + o.monto, 0)
  return { ocupantes: ocupantes.length, gasto: Math.round(gasto * 100) / 100 }
}

/** El resultado de cruzar un alcance contra las filas que ya existen. */
export interface ConflictoAlcance {
  /** Hay una fila sin conjunto («todas»): choca con cualquier otra del cargo. */
  todas: boolean
  /** Sucursales concretas que ya están tomadas por otra fila del mismo cargo. */
  ids: string[]
}

/**
 * Las sucursales que YA están tomadas por OTRA configuración del mismo cargo.
 *
 * ÉSTA es la regla que evita registrar dos veces el mismo cargo en la misma
 * sucursal: dos filas con la misma `clave` sólo conviven si sus conjuntos no
 * se cruzan, y una fila SIN conjunto —que se paga en todas— choca con
 * cualquier otra. Se ignora la fila que se está editando (`ignorarId`) para
 * que guardar no choque contra sí misma.
 *
 * El DEPARTAMENTO separa las cuentas: el mismo cargo en áreas distintas no
 * se pisa («Comprador/a» de Compras convive con «Comprador/a» de Servicios
 * Generales, incluso en la misma sucursal), porque sus personas no se cruzan.
 * Sí choca cualquier combinación en la que una de las dos no tenga área —
 * sin área significa «todas las áreas».
 *
 * Vive acá y no en un `unique` de la base porque «sin filas = todas» es una
 * regla que ningún índice sabe expresar.
 */
export function sucursalesTomadas(
  existentes: readonly BonoCargo[],
  clave: string,
  alcance: readonly BonoCargoSucursal[],
  ignorarId?: string,
  departamento: string | null = null
): ConflictoAlcance {
  const propias = new Set(alcance.map((s) => s.sucursal_id))
  const ids = new Set<string>()
  let todas = false
  for (const otro of existentes) {
    if (otro.clave !== clave || otro.id === ignorarId) continue
    if (!departamentosSePisan(otro.departamento, departamento)) continue
    // «Todas» de cualquiera de los dos lados: el cruce no es un conjunto
    // concreto, es la totalidad, y ahí no hay forma de no solaparse.
    if (!otro.sucursales.length || !propias.size) {
      todas = true
      continue
    }
    for (const s of otro.sucursales) {
      if (propias.has(s.sucursal_id)) ids.add(s.sucursal_id)
    }
  }
  return { todas, ids: [...ids] }
}

/** ¿Los dos departamentos se cruzan? Sin área en alguno de los dos: sí. */
export function departamentosSePisan(a: string | null, b: string | null): boolean {
  const raizA = a ? claveNormalizada(a) : ''
  const raizB = b ? claveNormalizada(b) : ''
  if (!raizA || !raizB) return true
  return raizA === raizB
}

const MESES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
]

/** El trimestre (1-4) al que pertenece un mes (0-11). */
export function trimestreDe(mes: number): number {
  return Math.floor(mes / 3) + 1
}

/**
 * El período al que pertenece una fecha: `2026-11` para los mensuales y
 * `2026-T1`…`2026-T4` para los trimestrales (enero-marzo es T1).
 */
export function periodoDe(fecha: Date, periodicidad: Periodicidad): string {
  const anio = fecha.getFullYear()
  const mes = fecha.getMonth()
  if (periodicidad === 'TRIMESTRAL') return `${anio}-T${trimestreDe(mes)}`
  return `${anio}-${String(mes + 1).padStart(2, '0')}`
}

/**
 * Los últimos `cantidad` períodos del calendario, del más nuevo al más
 * viejo, para el selector de la pantalla de pagos.
 *
 * Se arman desde el calendario y no desde los pagos que existen: un período
 * sin pagos todavía es un período al que se le pueden generar.
 */
export function periodosRecientes(periodicidad: Periodicidad, hoy = new Date(), cantidad = 12): string[] {
  const salida: string[] = []
  const actual = new Date(hoy.getFullYear(), hoy.getMonth(), 1)
  for (let i = 0; i < cantidad; i++) {
    salida.push(periodoDe(actual, periodicidad))
    if (periodicidad === 'TRIMESTRAL') {
      actual.setMonth(actual.getMonth() - 3)
    } else {
      actual.setMonth(actual.getMonth() - 1)
    }
  }
  return salida
}

/** Cómo se lee un período en pantalla: `Noviembre 2026` / `1er trimestre 2026`. */
export function etiquetaPeriodo(periodo: string): string {
  const [anio, parte] = periodo.split('-')
  if (parte?.startsWith('T')) {
    const n = Number(parte.slice(1))
    const sufijo = n === 1 ? 'er' : 'º'
    return `${n}${sufijo} trimestre ${anio}`
  }
  const mes = Number(parte)
  if (!mes || mes < 1 || mes > 12) return periodo
  return `${MESES[mes - 1]} ${anio}`
}

/* --- La generación de filas (pura) ---------------------------------------- */

/** Lo que se inserta en `bonos_pago` por cada persona elegible. */
export interface BonoPagoNuevo {
  bono_cargo_id: string
  periodo: string
  sucursal_id: string
  nacionalidad: string
  dni: number
  nombre: string
  cargo: string
  /** Departamento congelado en la fila, para distinguir cargos iguales. */
  departamento: string | null
  monto_base: number
  nota_minima: number
}

/**
 * Las filas a generar para un período, cruzando los cargos con bono contra
 * la nómina de cada sucursal.
 *
 * Sólo cargos ACTIVOS, sólo personas ACTIVAS con el cargo EXACTO
 * (`trabajadoresDeCargoExacto`: «Gerente de mercado» no alcanza a cualquier
 * «Gerente») y sólo las SUCURSALES dentro del alcance del cargo, cada una
 * con SU monto (`montoParaSucursal`).
 *
 * Y una persona se paga UNA VEZ por cargo y período: aunque aparezca en la
 * nómina de dos sucursales de su alcance, la clave es (cargo, persona) y no
 * (cargo, sucursal, persona) —un cargo único por tienda no se cobra dos
 * veces—. Si eso pasa, manda la primera sucursal en orden de id, que es un
 * orden estable: la fila no cambia de una corrida a otra.
 */
export function filasDeGeneracion(
  configs: readonly BonoCargo[],
  porSucursal: ReadonlyMap<string, readonly ColaboradorAPI[]>,
  periodo: string
): BonoPagoNuevo[] {
  const filas: BonoPagoNuevo[] = []
  const vistos = new Set<string>()
  for (const sucursalId of Array.from(porSucursal.keys()).sort()) {
    const gente = porSucursal.get(sucursalId) ?? []
    for (const cfg of configs) {
      if (!cfg.activo) continue
      // Primero el alcance: si este cargo no se paga en esta sucursal no hay
      // nada que cruzar con su nómina.
      const monto = montoParaSucursal(cfg, sucursalId)
      if (monto == null) continue
      for (const t of trabajadoresDeCargoExacto(gente, cfg.cargo, cfg.departamento)) {
        if (t.dni == null) continue
        const nacionalidad = (t.nationality ?? 'V').trim() || 'V'
        // La clave es POR CARGO Y POR PERSONA: ni la sucursal ni la fila de
        // configuración la cambian, así que ni dos tiendas ni dos filas del
        // mismo cargo pueden pagar dos veces al mismo trabajador.
        const clave = `${cfg.clave}|${nacionalidad}|${t.dni}`
        if (vistos.has(clave)) continue
        vistos.add(clave)
        filas.push({
          bono_cargo_id: cfg.id,
          periodo,
          sucursal_id: sucursalId,
          nacionalidad,
          dni: t.dni,
          nombre: nombreCompleto(t) || `DNI ${t.dni}`,
          cargo: cfg.cargo,
          departamento: cfg.departamento,
          monto_base: monto,
          nota_minima: cfg.nota_minima
        })
      }
    }
  }
  return filas
}

/* --- Consultas ------------------------------------------------------------- */

export async function listarBonosCargo(): Promise<BonoCargo[]> {
  const { data, error } = await supabase
    .from('bonos_cargo')
    .select('*, sucursales:bonos_cargo_sucursal(sucursal_id, monto)')
    .order('cargo')
  if (error) throw new Error(error.message)
  const filas = (data ?? []) as (Omit<BonoCargo, 'sucursales'> & { sucursales: BonoCargoSucursal[] | null })[]
  // Un cargo sin alcance viene con `sucursales: null` (sin filas hijas): eso
  // ES «aplica a todas», así que se normaliza a lista vacía y no a null.
  return filas.map((c) => ({ ...c, sucursales: c.sucursales ?? [] }))
}

export async function guardarBonoCargo(entrada: BonoCargoEntrada): Promise<void> {
  const cargo = entrada.cargo.trim()
  const clave = claveNormalizada(cargo)
  if (!cargo) throw new Error('Escribí el nombre del cargo.')
  if (!clave) throw new Error('El nombre del cargo debe tener letras o números.')
  if (!(entrada.monto >= 0)) throw new Error('El monto del bono no puede ser negativo.')
  if (!(entrada.nota_minima >= 0 && entrada.nota_minima <= 100)) {
    throw new Error('La nota mínima va de 0 a 100.')
  }

  const departamento = entrada.departamento?.trim() || null
  const rotulo = departamento ? `«${cargo}» (${departamento})` : `«${cargo}»`
  const campos = {
    cargo,
    clave,
    activo: entrada.activo,
    monto: entrada.monto,
    nota_minima: entrada.nota_minima,
    periodicidad: entrada.periodicidad,
    departamento,
    updated_at: new Date().toISOString()
  }

  // El alcance viaja DESPUÉS de la plantilla: primero el cargo, después sus
  // sucursales.
  const sucursales = normalizarAlcance(entrada.sucursales)

  // La regla de NO SOLAPE, antes de escribir nada: dos filas del mismo cargo
  // no pueden compartir sucursales NI departamento, y ninguna puede ser
  // «todas» mientras exista otra del mismo cargo. Sin esto, una misma
  // persona cobraría dos veces el mismo cargo en el mismo período.
  const conflicto = sucursalesTomadas(await listarBonosCargo(), clave, sucursales, entrada.id, departamento)
  if (conflicto.todas) {
    throw new Error(`${rotulo} ya está configurado para todas las sucursales: editá esa fila en vez de crear otra.`)
  }
  if (conflicto.ids.length) {
    throw new Error(
      `${rotulo} ya está configurado en ${conflicto.ids.length} de las sucursales que marcaste: no se registra dos veces el mismo cargo en la misma sucursal.`
    )
  }

  let id = entrada.id
  if (id) {
    const { error } = await supabase.from('bonos_cargo').update(campos).eq('id', id)
    if (error) throw new Error(mensajeDeError(error, 'No se pudo guardar el cargo.'))
  } else {
    const { data, error } = await supabase.from('bonos_cargo').insert(campos).select('id').single()
    if (error) throw new Error(mensajeDeError(error, 'No se pudo crear el cargo.'))
    id = data.id as string
  }

  // El conjunto se REEMPLAZA entero: es más simple que calcular un diff y
  // no queda ninguna sucursal vieja colgando si se sacó del medio.
  const { error: errorBorrado } = await supabase
    .from('bonos_cargo_sucursal')
    .delete()
    .eq('bono_cargo_id', id)
  if (errorBorrado) throw new Error(mensajeDeError(errorBorrado, 'No se pudo guardar el alcance.'))
  if (sucursales.length) {
    const { error: errorAlcance } = await supabase
      .from('bonos_cargo_sucursal')
      .insert(sucursales.map((s) => ({ bono_cargo_id: id, sucursal_id: s.sucursal_id, monto: s.monto })))
    if (errorAlcance) throw new Error(mensajeDeError(errorAlcance, 'No se pudo guardar el alcance.'))
  }
}

/**
 * El alcance como va a la base: sin duplicados (el primary key lo rechazaría
 * igual, pero con un mensaje que no le dice nada a nadie) y con el monto ya
 * validado. Una sucursal repetida se queda con la primera.
 */
function normalizarAlcance(entradas: readonly BonoCargoSucursal[]): BonoCargoSucursal[] {
  const vistas = new Set<string>()
  const salida: BonoCargoSucursal[] = []
  for (const s of entradas) {
    if (!s.sucursal_id || vistas.has(s.sucursal_id)) continue
    if (s.monto != null && !(s.monto >= 0)) {
      throw new Error('El monto por sucursal no puede ser negativo.')
    }
    vistas.add(s.sucursal_id)
    salida.push({ sucursal_id: s.sucursal_id, monto: s.monto })
  }
  return salida
}

export async function eliminarBonoCargo(id: string): Promise<void> {
  // Borrar el cargo borra sus pagos en cascada (FK `on delete cascade`): por
  // eso la pantalla lo avisa antes de ofrecerlo.
  const { error } = await supabase.from('bonos_cargo').delete().eq('id', id)
  if (error) throw new Error(mensajeDeError(error, 'No se pudo eliminar el cargo.'))
}

export async function listarPagos(periodo: string): Promise<BonoPago[]> {
  const { data, error } = await supabase
    .from('bonos_pago')
    .select('*, sucursal:sucursales(nombre)')
    .eq('periodo', periodo)
    .order('nombre')
  if (error) throw new Error(error.message)
  return (data ?? []) as BonoPago[]
}

export interface ResultadoGeneracion {
  /** Filas nuevas insertadas. */
  creados: number
  /** Filas que ya existían: la generación se puede volver a correr sin duplicar. */
  existentes: number
  /** Sucursales de cuya nómina se pudo leer. */
  sucursales: number
  /** Sucursales cuya nómina no se pudo leer (sin su aviso, el resto sigue). */
  fallos: string[]
  /** Activas SIN ID de trabajadores: se quedaron afuera y hay que decirlo. */
  sinId: string[]
  /** Inactivas en Unidades: tampoco generan pagos. */
  inactivas: string[]
  /** De dónde salió la nómina: la tabla espejo o la API en vivo. */
  fuente: 'local' | 'api'
  /** Última actualización de la tabla espejo, si fue la que se usó. */
  actualizado_en: string | null
}

/** Los motivos de lo que no entró, en una sola línea para el aviso. */
function motivosDeNomina(r: Pick<ResultadoNomina, 'fallos' | 'sinId' | 'inactivas'>): string {
  return [
    r.fallos.length ? `no se pudo leer la nómina de ${r.fallos.join(', ')}` : '',
    r.sinId.length ? `${r.sinId.join(', ')} sin ID de trabajadores` : '',
    r.inactivas.length ? `${r.inactivas.join(', ')} inactivas en Unidades` : ''
  ]
    .filter(Boolean)
    .join('; ')
}

/** Lo que hace falta de una sucursal para pedirle su nómina. */
export interface SucursalNomina {
  id: string
  nombre: string
  shop_id: string | null
  branch_id: string | null
  activa?: boolean
}

/** Lo que se puede pedir y lo que queda afuera, antes de tocar la API. */
export interface ClasificacionNomina {
  /** Las que sí se pueden pedir: id, nombre y el branch con el que se pide. */
  pedir: { id: string; nombre: string; branch: string }[]
  /** Activas SIN ID de trabajadores: no hay con qué pedir su nómina. */
  sinId: string[]
  /** Inactivas en Unidades: no cuentan ni generan pagos. */
  inactivas: string[]
}

/**
 * Qué sucursales se le pueden pedir nómina y por qué las demás se quedan.
 *
 * ESTE ES EL FILTRO QUE ANTES ERA SILENCIOSO: una tienda sin `shop_id` ni
 * `branch_id`, o marcada como inactiva en Unidades, simplemente no aparecía
 * en el mapa y sus trabajadores no entraban al conteo ni a los pagos — sin
 * ningún aviso que dijera por qué faltaban. Los tres motivos salen acá con
 * su nombre, para que la pantalla los pueda mostrar.
 */
export function clasificarSucursalesParaNomina(sucursales: readonly SucursalNomina[]): ClasificacionNomina {
  const pedir: { id: string; nombre: string; branch: string }[] = []
  const sinId: string[] = []
  const inactivas: string[] = []
  for (const s of sucursales) {
    if (s.activa === false) {
      inactivas.push(s.nombre)
      continue
    }
    // `branch_id` PRIMERO: es el ID de la sucursal en la API de TRABAJADORES
    // (así lo dice el campo de Unidades: «puede diferir del shop_id»). El
    // `shop_id` es el Nº tienda para escanear productos y manda a OTRA tienda
    // —comprobado: con shop 13 (El Bosque) devolvía la nómina de Guacara—.
    // El shop_id queda como último recurso para sucursales antiguas que sólo
    // tengan ese.
    const branch = (s.branch_id ?? s.shop_id ?? '').trim()
    if (!branch) {
      sinId.push(s.nombre)
      continue
    }
    pedir.push({ id: s.id, nombre: s.nombre, branch })
  }
  // Orden estable: los mensajes y los carteles no deben cambiar de orden de
  // una corrida a otra.
  inactivas.sort()
  sinId.sort()
  return { pedir, sinId, inactivas }
}

/** El resultado de leer las nóminas, con el MOTIVO de lo que no se pudo. */
export interface ResultadoNomina {
  /** Nómina por id de sucursal: sólo las que se pudieron leer. */
  porSucursal: Map<string, ColaboradorAPI[]>
  /** La API respondió con error para esa sucursal. */
  fallos: string[]
  /** Activas SIN ID de trabajadores: no se ni pudo pedir. */
  sinId: string[]
  /** Inactivas en Unidades. */
  inactivas: string[]
}

/**
 * La nómina de las sucursales, por id de sucursal: la fuente de los
 * OCUPANTES de cada cargo, para contarlos y multiplicarlos por su monto.
 *
 * Cada una se pide por separado y sólo se guarda la que salió bien: una
 * consulta caída queda en `fallos` sin frenar a las demás. Las que ni se
 * pueden pedir quedan en `sinId` / `inactivas`, con su nombre, para que la
 * pantalla avise en vez de mostrar un conteo de más bajo en silencio.
 */
export async function cargarNominaPorSucursal(
  sucursales: readonly SucursalNomina[]
): Promise<ResultadoNomina> {
  const { pedir, sinId, inactivas } = clasificarSucursalesParaNomina(sucursales)
  const porSucursal = new Map<string, ColaboradorAPI[]>()
  const fallos: string[] = []
  await Promise.all(
    pedir.map(async (s) => {
      const r = await listarColaboradores(s.branch)
      if (r.mensaje) {
        fallos.push(s.nombre)
        return
      }
      porSucursal.set(s.id, r.colaboradores)
    })
  )
  fallos.sort()
  return { porSucursal, fallos, sinId, inactivas }
}

/* --- La nómina espejo: la tabla `trabajadores_nomina` --------------------- */

export interface FilaNomina {
  sucursal_id: string
  nacionalidad: string
  dni: number
  /** El registro CRUDO de la API: la normalización (activo, área, estado) es del cliente. */
  datos: Record<string, unknown>
  actualizado_en: string
}

/** La tabla espejo agrupada por sucursal: la misma forma que la API en vivo. */
export function nominaDeTabla(filas: readonly FilaNomina[]): Map<string, ColaboradorAPI[]> {
  const porSucursal = new Map<string, ColaboradorAPI[]>()
  for (const f of filas) {
    const gente = porSucursal.get(f.sucursal_id) ?? []
    gente.push({ ...f.datos, nationality: f.nacionalidad, dni: f.dni } as ColaboradorAPI)
    porSucursal.set(f.sucursal_id, gente)
  }
  return porSucursal
}

export async function listarNominaLocal(): Promise<{ filas: FilaNomina[]; actualizado_en: string | null }> {
  const { data, error } = await supabase
    .from('trabajadores_nomina')
    .select('sucursal_id, nacionalidad, dni, datos, actualizado_en')
  if (error) throw new Error(error.message)
  const filas = (data ?? []) as FilaNomina[]
  // Los ISO salen con el mismo formato: comparar como texto da el más nuevo.
  let ultima: string | null = null
  for (const f of filas) if (!ultima || f.actualizado_en > ultima) ultima = f.actualizado_en
  return { filas, actualizado_en: ultima }
}

/** Cuánto hace que se actualizó, en una forma que se pueda leer. */
export function etiquetaFrescura(iso: string | null, ahora = new Date()): string {
  if (!iso) return 'sin actualizar'
  const ms = ahora.getTime() - new Date(iso).getTime()
  if (!Number.isFinite(ms)) return 'sin actualizar'
  if (ms < 0) return 'recién actualizada'
  const horas = Math.floor(ms / 3600000)
  if (horas < 1) return `hace ${Math.max(1, Math.floor(ms / 60000))} min`
  if (horas < 24) return `hace ${horas} h`
  const dias = Math.floor(horas / 24)
  return `hace ${dias} ${dias === 1 ? 'día' : 'días'}`
}

/**
 * ¿La foto ya es vieja para tomar decisiones de plata? 36 horas: si el cron
 * corre a las 05:00, un pase de más de un día y medio significa que no corrió.
 */
export function nominaDesactualizada(iso: string | null, ahora = new Date(), umbralHoras = 36): boolean {
  if (!iso) return true
  const ms = ahora.getTime() - new Date(iso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return false
  return ms > umbralHoras * 3600000
}

/** El resumen que devuelve la Edge Function `actualizar-nomina`. */
export interface ResumenActualizacion {
  sucursales_ok: number
  sucursales_fallo: number
  sin_id: number
  trabajadores: number
  fallos: string[]
  sin_id_nombres: string[]
}

export interface FuenteNomina extends ResultadoNomina {
  /** `local` = tabla espejo; `api` = la API en vivo (la tabla está vacía). */
  fuente: 'local' | 'api'
  /** Última actualización de la tabla, si fue la que se usó. */
  actualizado_en: string | null
}

/**
 * La nómina para los bonos: PRIMERO la tabla espejo; si está vacía —o el
 * bloque todavía no se aplicó—, la API en vivo como respaldo.
 *
 * Así la pantalla funciona desde el primer día sin cron, y el cron la va
 * volviendo rápida y estable. Los motivos de lo que queda afuera (sin ID,
 * inactivas) salen de la clasificación de las sucursales, igual en las dos
 * fuentes; `fallos` sólo aplica a la API en vivo.
 */
export async function cargarNomina(sucursales: readonly SucursalNomina[]): Promise<FuenteNomina> {
  const { sinId, inactivas } = clasificarSucursalesParaNomina(sucursales)
  try {
    const { filas, actualizado_en } = await listarNominaLocal()
    if (filas.length) {
      return { porSucursal: nominaDeTabla(filas), fallos: [], sinId, inactivas, fuente: 'local', actualizado_en }
    }
  } catch {
    // Sin tabla (bloque no aplicado) o sin permiso: se cae a la API en vivo.
  }
  const enVivo = await cargarNominaPorSucursal(sucursales)
  return { ...enVivo, fuente: 'api', actualizado_en: null }
}

/** Pide a la Edge Function que refresque la tabla espejo, ahora. */
export async function actualizarNominaAhora(): Promise<ResumenActualizacion> {
  let data: unknown = null
  let error: { message?: string } | null = null
  try {
    const r = await supabase.functions.invoke('actualizar-nomina')
    data = r.data
    error = r.error
  } catch (e) {
    error = { message: e instanceof Error ? e.message : String(e) }
  }
  if (error) throw new Error(error.message || 'No se pudo actualizar la nómina.')
  const cuerpo = data as { ok?: boolean; error?: string; data?: ResumenActualizacion } | null
  if (!cuerpo || cuerpo.ok === false) {
    throw new Error(cuerpo?.error || 'No se pudo actualizar la nómina.')
  }
  return cuerpo.data as ResumenActualizacion
}

/**
 * Genera las filas de pago de un período con la nómina ACTUAL de las
 * sucursales.
 *
 * Sólo sucursales activas con ID de trabajadores (los departamentos no tienen
 * nómina de tienda), y cada una se pide por separado: una consulta caída deja
 * su aviso en `fallo` sin frenar a las demás. Lo que ya estaba generado no se
 * toca —el unique de la base lo garantiza—, así que correrla otra vez sólo
 * agrega a los que faltan.
 */
export async function generarPagos(periodo: string, periodicidad: Periodicidad): Promise<ResultadoGeneracion> {
  const configs = (await listarBonosCargo()).filter((c) => c.activo && c.periodicidad === periodicidad)
  if (!configs.length) {
    throw new Error(`No hay cargos con bono activos con periodicidad ${periodicidad === 'MENSUAL' ? 'mensual' : 'trimestral'}.`)
  }

  const resultadoNomina = await cargarNomina(await listarSucursalesAdmin())
  const { porSucursal, fallos, sinId, inactivas, fuente, actualizado_en } = resultadoNomina
  const motivos = motivosDeNomina(resultadoNomina)
  if (!porSucursal.size) {
    throw new Error(
      motivos ? `No se pudo cargar ninguna nómina: ${motivos}.` : 'No hay sucursales con ID de trabajadores configurado.'
    )
  }

  const filas = filasDeGeneracion(configs, porSucursal, periodo)
  if (!filas.length) {
    throw new Error(
      motivos ? `No se generó ningún pago: ${motivos}.` : 'La nómina no tiene personas activas con esos cargos.'
    )
  }

  // Lo ya generado no se duplica, y se compara POR CARGO Y POR PERSONA —sin
  // sucursal ni fila—: el mismo cargo puede vivir en dos configuraciones, y
  // una persona puede aparecer en la nómina de dos tiendas, pero no debe
  // cobrar dos veces el mismo cargo en un período.
  const claveDeFila = new Map(configs.map((c) => [c.id, c.clave]))
  const { data: actuales, error: errorLectura } = await supabase
    .from('bonos_pago')
    .select('bono_cargo_id, sucursal_id, nacionalidad, dni, cargo:bonos_cargo(clave)')
    .eq('periodo', periodo)
  if (errorLectura) throw new Error(errorLectura.message)
  const filasActuales = (actuales ?? []) as {
    bono_cargo_id: string
    sucursal_id: string
    nacionalidad: string
    dni: number
    // Sin tipos generados de la base, el join puede venir como objeto o como
    // arreglo de uno: los dos formatos se leen igual.
    cargo?: { clave: string } | Array<{ clave: string }> | null
  }[]
  const existentes = new Set(
    filasActuales.map((r) => {
      const cargo = Array.isArray(r.cargo) ? r.cargo[0] : r.cargo
      const clave = cargo?.clave ?? r.bono_cargo_id
      return `${clave}|${r.nacionalidad}|${r.dni}`
    })
  )
  const aInsertar = filas.filter((f) => {
    const clave = claveDeFila.get(f.bono_cargo_id) ?? f.bono_cargo_id
    return !existentes.has(`${clave}|${f.nacionalidad}|${f.dni}`)
  })

  // En tandas de 200: el límite de filas por insert de PostgREST no debería
  // alcanzarse, pero una nómina grande no puede fallar por un solo insert.
  for (let i = 0; i < aInsertar.length; i += 200) {
    const tanda = aInsertar.slice(i, i + 200)
    const { error } = await supabase.from('bonos_pago').insert(tanda)
    if (error) throw new Error(mensajeDeError(error, 'No se pudieron generar los pagos.'))
  }

  return {
    creados: aInsertar.length,
    existentes: existentes.size,
    sucursales: porSucursal.size,
    fallos,
    sinId,
    inactivas,
    fuente,
    actualizado_en
  }
}

/**
 * Guarda la nota de un pago y recalcula su monto con la regla del umbral.
 *
 * El monto se calcula ACÁ y no en la base porque la tabla guarda la foto: la
 * misma cuenta que ve la pantalla (`montoACobrar`) es la que se persiste, y
 * no hay dos versiones de la regla que puedan divergir.
 */
export async function guardarNotaPago(pago: BonoPago, nota: number | null): Promise<BonoPago> {
  if (nota != null && (nota < 0 || nota > 100)) throw new Error('La nota va de 0 a 100.')
  const monto = montoACobrar(pago.monto_base, nota, pago.nota_minima)
  const { data, error } = await supabase
    .from('bonos_pago')
    .update({ nota, monto, updated_at: new Date().toISOString() })
    .eq('id', pago.id)
    .select('*')
    .single()
  if (error) throw new Error(mensajeDeError(error, 'No se pudo guardar la nota.'))
  return { ...pago, ...(data as BonoPago), sucursal: pago.sucursal }
}

/** Marca un pago como PAGADO, con su fecha y quién lo registró. */
export async function marcarPagado(
  pago: BonoPago,
  datos: { fecha: string; observaciones?: string }
): Promise<BonoPago> {
  if (pago.nota == null) throw new Error('Cargá la nota antes de marcar el pago.')
  const { data: usuario } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('bonos_pago')
    .update({
      estado: 'PAGADO',
      pagado_en: datos.fecha,
      pagado_por: usuario.user?.id ?? null,
      observaciones: datos.observaciones?.trim() || null,
      updated_at: new Date().toISOString()
    })
    .eq('id', pago.id)
    .select('*')
    .single()
  if (error) throw new Error(mensajeDeError(error, 'No se pudo registrar el pago.'))
  return { ...pago, ...(data as BonoPago), sucursal: pago.sucursal }
}

/** Vuelve un pago a PENDIENTE (se equivocó la marca, no la nota). */
export async function volverAPendiente(pago: BonoPago): Promise<BonoPago> {
  const { data, error } = await supabase
    .from('bonos_pago')
    .update({
      estado: 'PENDIENTE',
      pagado_en: null,
      pagado_por: null,
      updated_at: new Date().toISOString()
    })
    .eq('id', pago.id)
    .select('*')
    .single()
  if (error) throw new Error(mensajeDeError(error, 'No se pudo deshacer el pago.'))
  return { ...pago, ...(data as BonoPago), sucursal: pago.sucursal }
}

/** La cédula como se pinta en la lista de pagos. */
export function cedulaDe(pago: Pick<BonoPago, 'nacionalidad' | 'dni'>): string {
  return cedula({ nationality: pago.nacionalidad, dni: pago.dni })
}

/**
 * El mensaje que se le muestra a quien intenta guardar: el de Postgres si
 * trae uno legible, si no el respaldo.
 *
 * El `23505` es el único que conviene traducir a mano: es un choque de unique
 * (la PK del alcance, por ejemplo) y «duplicate key value violates unique
 * constraint» no le dice nada a nadie.
 */
function mensajeDeError(error: { message: string; code?: string }, respaldo: string): string {
  if (error.code === '23505') return 'Esa sucursal ya está en el alcance de ese cargo.'
  return error.message || respaldo
}
