// Contrato de tipos del lector de archivos del puente biométrico.
// (El puente es JavaScript plano: esto le dice a la web qué forma tienen los
// datos, para que un cambio acá no se descubra en pantalla al sincronizar.)

/** Marcaje tal como lo entrega el puente. */
export interface MarcajeBridge {
  dni: string
  fecha: string // ISO
  tipo: 'ENTRADA' | 'SALIDA' | 'OTRO'
}

export interface MapeoColumnas {
  dni: number
  fecha: number
  tipo: number
}

export interface LecturaArchivo {
  marcajes: MarcajeBridge[]
  columnas: MapeoColumnas | null
  huboEncabezado: boolean
  origen: string
}

export interface DetalleOrigen {
  archivo: string
  leidos: number
  encabezado?: boolean
  columnas?: MapeoColumnas | null
}

export declare function parsearFecha(valor: unknown): Date | null
export declare function parsearTipo(valor: unknown): 'ENTRADA' | 'SALIDA' | 'OTRO'
export declare function partirLinea(linea: string, sep: string): string[]
export declare function detectarSeparador(lineas: string[]): string
export declare function mapearEncabezado(celdas: string[]): MapeoColumnas | null
export declare function leerArchivo(ruta: string): LecturaArchivo
export declare function leerMarcajesDeArchivos(
  carpeta?: string,
  rutasPuntuales?: string[]
): { marcajes: MarcajeBridge[]; detalle: DetalleOrigen[] }
