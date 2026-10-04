// Contrato de tipos del driver del lector biométrico.

import type { MarcajeBridge, DetalleOrigen } from './archivos.js'

/** Estado del lector tal como lo informa el puente. */
export interface EstadoDispositivo {
  conectado: boolean
  modelo: string | null
  marca: string
  serial: string | null
  transporte?: string
  transporteEtiqueta?: string
  /** Por el transporte detectado se pueden leer marcajes. */
  sirve?: boolean
  mensaje: string | null
}

export declare const MODELO: string
export declare const MARCA: string
export declare function leerDispositivo(): Promise<EstadoDispositivo>
export declare function leerMarcajes(
  desde?: string,
  hasta?: string,
  opts?: { modo?: 'real' | 'demo' }
): Promise<MarcajeBridge[]>
export declare function origenDeMarcajes(): Promise<DetalleOrigen[]>
export declare function leerArchivoPuntual(ruta: string): Promise<MarcajeBridge[]>
