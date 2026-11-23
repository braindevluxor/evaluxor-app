import { supabase } from '../supabase'

/**
 * EL TABULADOR DE PAQUETES: EL EXCEL DE TALENTO HUMANO, EN LA CONSOLA
 * ---------------------------------------------------------------
 * `TABULADOR ESTRCII LUXOR` (Excel con hojas OFICINA y SUCURSALES) dice,
 * por cargo, la plantilla propuesta, el salario y el desglose de bonos que
 * componen el PAQUETE APROBADO. Los datos NO se editan desde acá: se
 * ajustan en el Excel y se reemplazan pegando el SQL que genera
 * `scripts/generar_tabulador_paquetes.py` (DELETE + INSERT), por eso este
 * módulo sólo LEE.
 *
 * Acá se lee con la sesión de la consola y la política `puede_bonos`
 * (LÍDER y GERENTE TH) —una cifra de sueldo no es contenido de todo el
 * mundo—; `anon` ni privilegio de tabla. Son ~195 filas: se cargan ENTERAS
 * de una y la pantalla busca, filtra y ordena en memoria.
 */

/** La hoja del Excel: cada una se consulta por separado. */
export type HojaTabulador = 'OFICINA' | 'SUCURSALES'

export const HOJAS_TABULADOR: readonly HojaTabulador[] = ['OFICINA', 'SUCURSALES'] as const

/** Un renglón del tabulador: las columnas propias + el resto en `componentes`. */
export interface FilaTabulador {
  id: number
  hoja: HojaTabulador
  codigo: string
  cargo: string
  departamento: string
  dependencia: string
  /** Plazas del puesto (null donde el Excel la dejó vacía). */
  plantilla: number | null
  /** Salario en bolívares (la columna SALARIO BS del Excel). */
  salario: number | null
  /** PAQUETE APROBADO, en DÓLARES —así lo aprueba el Excel—. */
  paquete: number | null
  /**
   * El resto del renglón (bonos, cupones, BCI, CT…) con la clave
   * normalizada del import. Las claves y sus etiquetas varían entre hojas
   * y entre versiones del archivo: la pantalla las rotula con `columnas`
   * del config, nunca con nombres fijos.
   */
  componentes: Record<string, number | string>
}

/** La etiqueta de una componente, mandada por el import (quien lee el Excel). */
export interface ColumnaTabulador {
  hoja: HojaTabulador
  key: string
  etiqueta: string
}

/** La fila única de config: encabezado del archivo + etiquetas por hoja. */
export interface ConfigTabulador {
  columnas: ColumnaTabulador[]
  /** Fecha del archivo (la que trae el Excel). */
  fecha_archivo: string | null
  tasa_cambio: number | null
  tasa_cupon: number | null
}

export interface Tabulador {
  filas: FilaTabulador[]
  config: ConfigTabulador | null
}

/**
 * El tabulador entero: las DOS hojas de una y la config de otra.
 *
 * Sin sesión o sin permiso, el error de RLS sale acá y la pantalla lo
 * explica — no hay data layer que lo salve.
 */
export async function listarTabulador(): Promise<Tabulador> {
  const [filas, config] = await Promise.all([
    supabase
      .from('bono_tabulador_paquete')
      .select(
        'id, hoja, codigo, cargo, departamento, dependencia, plantilla, salario, paquete, componentes'
      )
      .order('cargo'),
    supabase
      .from('bono_tabulador_config')
      .select('columnas, fecha_archivo, tasa_cambio, tasa_cupon')
      .eq('id', true)
      .maybeSingle()
  ])
  if (filas.error) throw filas.error
  if (config.error) throw config.error
  return {
    filas: (filas.data ?? []) as FilaTabulador[],
    config: (config.data as ConfigTabulador | null) ?? null
  }
}
