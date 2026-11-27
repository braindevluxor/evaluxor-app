import { supabase } from '../supabase'
import { claveNormalizada } from './responsables'

/**
 * EL TABULADOR DE PAQUETES: LAS CIFRAS DE TALENTO HUMANO, EN LA CONSOLA
 * ---------------------------------------------------------------
 * Por cargo: código, departamento, dependencia, plantilla (plazas) y las
 * cifras del paquete, cada una en su moneda de declaración:
 *
 *  - `salario_bs`, `bono_traslado_bs`        → BS
 *  - `bono_asistencia_usd`, `cestatickets_usd`,
 *    `paquete_aprobado_usd`                  → USD
 *
 * El BONO COMPENSATORIO no se guarda: es `bonoCompensatorio()`, la resta
 * PAQUETE − (SALARIO + TRASLADO + ASISTENCIA + CESTATICKETS) hecha en USD
 * con la tasa del BCV —así no puede quedar desfasado si mañana cambia un
 * salario o la tasa—. Si falta el paquete o falta la tasa, no hay número:
 * la celda queda «—».
 *
 * A diferencia del tabulador anterior (foto del Excel, sólo lectura), ÉSTE
 * se edita desde la consola: `guardarFila` da de alta o modifica y
 * `eliminarFila` borra. Se guarda SIEMPRE en la moneda declarada —nadie
 * convierte al escribir—; la conversión es cosa de la vista y vive en
 * `valorParaVista`, con la tasa del BCV (`src/lib/tasaBcv.ts`).
 *
 * Se lee con la sesión de la consola y la política `puede_bonos` (LÍDER y
 * GERENTE TH) —una cifra de sueldo no es contenido de todo el mundo—; `anon`
 * sin privilegio de tabla. Son pocas filas: se cargan ENTERAS de una y la
 * pantalla busca, filtra y ordena en memoria.
 */

/** La moneda en que una cifra fue declarada (y en la que se GUARDA). */
export type Moneda = 'BS' | 'USD'

/**
 * Las tres formas de mirar la tabla:
 *
 *  - `DECLARADO` (según declaración): cada columna en SU moneda, sin tocar.
 *  - `BS`: las columnas USD se convierten a bolívares con la tasa.
 *  - `USD`: las columnas BS se convierten a dólares con la tasa.
 */
export type VistaMoneda = 'DECLARADO' | 'BS' | 'USD'

export const VISTAS: { valor: VistaMoneda; etiqueta: string }[] = [
  { valor: 'DECLARADO', etiqueta: 'Según declaración' },
  { valor: 'BS', etiqueta: 'Solo BS' },
  { valor: 'USD', etiqueta: 'Solo USD' }
]

/** Los campos monetarios, con su moneda de declaración (el orden de la tabla). */
export type CampoMonetario =
  | 'salario_bs'
  | 'bono_traslado_bs'
  | 'bono_asistencia_usd'
  | 'cestatickets_usd'
  | 'paquete_aprobado_usd'

export const COLUMNAS_MONEDA: { campo: CampoMonetario; etiqueta: string; moneda: Moneda }[] = [
  { campo: 'salario_bs', etiqueta: 'Salario', moneda: 'BS' },
  { campo: 'bono_traslado_bs', etiqueta: 'Bono traslado', moneda: 'BS' },
  { campo: 'bono_asistencia_usd', etiqueta: 'Bono asistencia', moneda: 'USD' },
  { campo: 'cestatickets_usd', etiqueta: 'Cestatickets', moneda: 'USD' },
  { campo: 'paquete_aprobado_usd', etiqueta: 'Paquete aprobado', moneda: 'USD' }
]

/** Un renglón del tabulador tal como está guardado (en su moneda). */
export interface FilaTabulador {
  id: string
  codigo: string
  cargo: string
  departamento: string
  dependencia: string
  /** Plazas del puesto. `null` = no declarado (se muestra «—»). */
  plantilla: number | null
  salario_bs: number | null
  bono_traslado_bs: number | null
  bono_asistencia_usd: number | null
  cestatickets_usd: number | null
  paquete_aprobado_usd: number | null
}

/** Lo que se escribe al crear o editar: la MISMA fila, sin `id` si es alta. */
export type FilaTabuladorEntrada = Omit<FilaTabulador, 'id'> & { id?: string }

/* --- Las vistas (pura) ---------------------------------------------------- */

/**
 * ¿ESTA columna se pinta en otra moneda que la suya, en ESTA vista?
 * `DECLARADO` no convierte nada; `BS` sólo las USD; `USD` sólo las BS.
 */
export function esConvertido(moneda: Moneda, vista: VistaMoneda): boolean {
  return vista !== 'DECLARADO' && vista !== moneda
}

/**
 * El valor a pintar en una celda: el declarado, o su conversión a la
 * moneda de la vista con la tasa del BCV.
 *
 *  - De USD a BS multiplica (valor × tasa); de BS a USD divide (valor ÷ tasa).
 *  - `null` (no declarado) sigue siendo `null`: no se inventa cifra.
 *  - Sin tasa (o con una tasa inválida) la conversión NO existe: devuelve
 *    `null` y la pantalla lo pinta como «—» con su aviso, en vez de
 *    mostrar un número de mentira.
 */
export function valorParaVista(
  valor: number | null,
  moneda: Moneda,
  vista: VistaMoneda,
  tasa: number | null
): number | null {
  if (valor == null) return null
  if (!esConvertido(moneda, vista)) return valor
  if (tasa == null || !Number.isFinite(tasa) || tasa <= 0) return null
  return moneda === 'USD' ? valor * tasa : valor / tasa
}

/**
 * EL BONO COMPENSATORIO: la única cifra que NO se guarda, porque es la
 * RESTA de las demás.
 *
 *     PAQUETE APROBADO (USD) − (SALARIO + TRASLADO en BS pasados a USD
 *     por la tasa) − ASISTENCIA − CESTATICKETS (ambos USD)
 *
 * Devuelve la cifra **en USD** —la moneda en que se decide—, y la pantalla
 * la pinta como cualquier otra columna USD: en la vista «solo BS» se
 * multiplica por la tasa al mostrarla.
 *
 * `null` = no hay número que calcular, y por eso la celda es «—»:
 *
 *  - Sin `paquete_aprobado_usd` no hay de qué restar.
 *  - Si hay BS que convertir y no hay tasa (o es inválida), la resta
 *    mezclaría monedas: no se hace.
 *  - Un componente no declarado no resta (cuenta como 0).
 */
export function bonoCompensatorio(fila: FilaTabulador, tasa: number | null): number | null {
  const paquete = fila.paquete_aprobado_usd
  if (paquete == null) return null

  const bs = (fila.salario_bs ?? 0) + (fila.bono_traslado_bs ?? 0)
  let bsEnUsd = 0
  if (bs > 0) {
    if (tasa == null || !Number.isFinite(tasa) || tasa <= 0) return null
    bsEnUsd = bs / tasa
  }

  return paquete - bsEnUsd - (fila.bono_asistencia_usd ?? 0) - (fila.cestatickets_usd ?? 0)
}

/* --- La regla de negocio (pura) ------------------------------------------- */

/**
 * El error de una fila, o `null` si está bien. Todo lo que se rechaza es
 * para que no entre basura a la base: cargo sin letras, cifras negativas
 * o no numéricas.
 */
export function validarFila(entrada: FilaTabuladorEntrada): string | null {
  if (!entrada.cargo.trim()) return 'Escribí el cargo.'
  if (!claveNormalizada(entrada.cargo)) return 'El cargo debe tener letras o números.'
  if (entrada.plantilla != null && entrada.plantilla < 0) {
    return 'La plantilla no puede ser negativa.'
  }
  const campos: { etiqueta: string; valor: number | null }[] = [
    { etiqueta: 'Salario (BS)', valor: entrada.salario_bs },
    { etiqueta: 'Bono traslado (BS)', valor: entrada.bono_traslado_bs },
    { etiqueta: 'Bono asistencia (USD)', valor: entrada.bono_asistencia_usd },
    { etiqueta: 'Cestatickets (USD)', valor: entrada.cestatickets_usd },
    { etiqueta: 'Paquete aprobado (USD)', valor: entrada.paquete_aprobado_usd }
  ]
  for (const campo of campos) {
    if (campo.valor != null && campo.valor < 0) return `${campo.etiqueta} no puede ser negativo.`
  }
  return null
}

/* --- La base -------------------------------------------------------------- */

const COLUMNAS = 'id, codigo, cargo, departamento, dependencia, plantilla, salario_bs, bono_traslado_bs, bono_asistencia_usd, cestatickets_usd, paquete_aprobado_usd'

/**
 * El tabulador ENTERO: son pocas filas, se traen de una y todo el filtro,
 * el orden y la búsqueda corren en pantalla — sin consulta por tecla.
 *
 * Sin sesión o sin permiso, el error de RLS sale acá y la pantalla lo
 * explica — no hay data layer que lo salve.
 */
export async function listarTabulador(): Promise<FilaTabulador[]> {
  const { data, error } = await supabase
    .from('tabulador_paquete')
    .select(COLUMNAS)
    .order('cargo')
  if (error) throw error
  return (data ?? []) as FilaTabulador[]
}

/**
 * Crea o modifica UNA fila. Con `id` actualiza; sin él, inserta. El `clave`
 * del cargo se recalcula siempre: es lo que la pantalla usa para buscar.
 */
export async function guardarFila(entrada: FilaTabuladorEntrada): Promise<void> {
  const error = validarFila(entrada)
  if (error) throw new Error(error)

  const fila = {
    codigo: entrada.codigo.trim(),
    cargo: entrada.cargo.trim(),
    clave: claveNormalizada(entrada.cargo),
    departamento: entrada.departamento.trim(),
    dependencia: entrada.dependencia.trim(),
    plantilla: entrada.plantilla,
    salario_bs: entrada.salario_bs,
    bono_traslado_bs: entrada.bono_traslado_bs,
    bono_asistencia_usd: entrada.bono_asistencia_usd,
    cestatickets_usd: entrada.cestatickets_usd,
    paquete_aprobado_usd: entrada.paquete_aprobado_usd,
    updated_at: new Date().toISOString()
  }

  const consulta = entrada.id
    ? supabase.from('tabulador_paquete').update(fila).eq('id', entrada.id)
    : supabase.from('tabulador_paquete').insert(fila)
  const { error: err } = await consulta
  if (err) throw err
}

/** Borra una fila. Si RLS no deja (rol sin `puede_bonos`), llega el error. */
export async function eliminarFila(id: string): Promise<void> {
  const { error } = await supabase.from('tabulador_paquete').delete().eq('id', id)
  if (error) throw error
}
