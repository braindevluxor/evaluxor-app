// Contrato de tipos de la detección USB del puente biométrico.

export interface HallazgoLector {
  id: string
  nombre: string
  modelo: string | null
  transporte: string
  transporteEtiqueta: string
  /** Por este transporte se pueden leer marcajes. */
  sirve: boolean
  estado: string
  deviceId: string | null
}

export interface DeteccionLector {
  conectado: boolean
  /** Se pudo consultar el administrador de dispositivos. */
  disponible: boolean
  modelo?: string | null
  nombre?: string
  serial?: string | null
  transporte?: string
  transporteEtiqueta?: string
  sirve?: boolean
  mensaje: string
  hallazgos?: HallazgoLector[]
}

export interface FirmaLector {
  id: string
  vendor?: string
  vid?: string
  pid?: string
  modelo?: string
  transporte?: string
}

export declare const FIRMAS_POR_DEFECTO: FirmaLector[]
export declare const TRANSPORTES: Record<string, { etiqueta: string; sirve: boolean; explicacion: string }>
export declare function detectarLector(): Promise<DeteccionLector>
