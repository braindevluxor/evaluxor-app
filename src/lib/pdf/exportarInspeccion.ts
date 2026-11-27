import { putPreEntrega, type PreEntregaRecord } from '../offline/db'
import { subirRevisionPreEntrega } from '../offline/syncPreEntrega'
import { supabase } from '../supabase'
import { avisar } from '../aviso'
import type { Item } from '../types'
import { seccionarItems, type Persona } from '../inspeccionVehiculo'
import { armarDetalleInspeccion, asegurarEnlaceInspeccion } from '../data/compartirInspeccion'
import { exportarRevisionPreEntrega } from './exportarRevisionPreEntrega'
import { resolverPregunta } from './preguntasRevision'

/**
 * PDF DE UNA INSPECCIÓN DE VEHÍCULO, DESDE CUALQUIER PANTALLA
 * -----------------------------------------------------------
 * Lo comparten DOS lugares: la herramienta (donde se llena) y el historial
 * (donde se vuelve a descargar sin pasar por la pantalla). Reimplementarlo en
 * el historial daría dos versiones del mismo documento que se divergen, así
 * que la máquina vive acá y las pantallas sólo la llaman.
 *
 * EL DOCUMENTO YA NO LLEVA FOTOS: el papel no es el mejor lugar para mirar
 * evidencia. En su lugar lleva un QR con el enlace PÚBLICO al detalle
 * completo (tabla, comentarios y material visual), que se crea —o se
 * reutiliza— antes de generar la hoja. Ver `compartirInspeccion.ts`.
 *
 * Toca Storage (la carpeta de la inspección), la cola de subida y el enlace
 * público: a diferencia del resto de `lib/pdf`, éste no es puro.
 */
export interface PedidoInspeccion {
  registro: PreEntregaRecord
  /** Ítems del módulo completo (con secciones): de ahí salen las filas. */
  items: Item[]
  /** Persona del formulario, que puede haberse editado sin guardar. */
  persona: Persona
  moduloNombre: string
  evaluador: string | null
  /**
   * El id de QUIÉN exporta: es el que firma el enlace público (el QR del
   * PDF), con la misma sesión con la que hizo la inspección.
   */
  evaluadorId?: string | null
  online: boolean
}

export interface ResultadoExportacion {
  /**
   * `subida` = el PDF se generó y el registro quedó en el servidor.
   * `local` = se generó y quedó en el equipo (sin conexión, o el servidor
   * rechazó la subida: la cola lo reintenta sola).
   */
  resultado: 'subida' | 'local'
  /** El registro ya finalizado, para que la pantalla pinte el mismo estado. */
  registro: PreEntregaRecord
}

/**
 * Nombres de los archivos que hay en la carpeta de una revisión
 * (`pre-entrega/<id>/`), para rehidratar las `paths` de sus respuestas.
 *
 * Devuelve `[]` si falla (sin red, sin permiso): la inspección se abre igual,
 * sólo que sin fotos resueltas desde el bucket. Nunca es motivo para no abrir.
 */
export async function nombresEnCarpeta(revisionId: string): Promise<string[]> {
  const { data, error } = await supabase.storage.from('evidencias').list(`pre-entrega/${revisionId}`)
  if (error) return []
  return (data ?? [])
    .map((f) => f.name)
    .filter((n): n is string => typeof n === 'string' && !!n)
}

/** El checklist resuelto a filas del PDF, con la sección de cada una. */
export function filasParaPdf(
  items: Item[],
  respuestas: Record<string, unknown>
): { etiqueta: string; valor: string; grupo: string | null; observacion: string | null }[] {
  const filas: { etiqueta: string; valor: string; grupo: string | null; observacion: string | null }[] = []
  for (const g of seccionarItems(items)) {
    for (const item of g.items) {
      const p = resolverPregunta(item, respuestas[item.id])
      // Cada fila lleva SU observación: la del punto en la fila del punto.
      // Antes los comentarios se juntaban en una sola fila «· Nota» con
      // todos adentro, ilegible y despegado de su punto.
      for (const f of p.filas) {
        filas.push({
          etiqueta: `${item.texto} · ${f.etiqueta}`,
          valor: f.valor,
          grupo: g.seccion ?? 'Dictamen',
          observacion: f.observacion ?? null
        })
      }
    }
  }
  return filas
}

/** Nombre o apellido en MAYÚSCULAS: es lo que se firma en el papel. */
function mayus(texto?: string | null): string | null {
  const limpio = texto?.trim()
  return limpio ? limpio.toUpperCase() : null
}

/**
 * El enlace PÚBLICO al detalle completo (tabla, comentarios y material
 * visual): es lo que apunta el QR que lleva el PDF.
 *
 * Si no se puede crear —sin permiso, sin red, bloque sin aplicar— el
 * documento se genera SIN QR y se avisa: un problema con el enlace no puede
 * dejar a nadie sin su inspección.
 */
async function enlaceDelDetalle(
  r: PreEntregaRecord,
  p: PedidoInspeccion,
  items: { etiqueta: string; valor: string; grupo: string | null; observacion: string | null }[]
): Promise<string | null> {
  try {
    const detalle = armarDetalleInspeccion({
      titulo: p.moduloNombre,
      fecha: r.fecha,
      evaluador: p.evaluador,
      observaciones: r.observaciones.trim() || null,
      vehiculo: {
        placa: r.placa,
        marca: typeof r.vehiculo.marca === 'string' ? r.vehiculo.marca : null,
        modelo: typeof r.vehiculo.modelo === 'string' ? r.vehiculo.modelo : null,
        color: typeof r.vehiculo.color === 'string' ? r.vehiculo.color : null,
        anio: r.vehiculo.anio == null ? null : String(r.vehiculo.anio),
        kilometraje: r.vehiculo.kilometraje == null ? null : String(r.vehiculo.kilometraje),
        combustible: typeof r.vehiculo.combustible === 'string' ? r.vehiculo.combustible : null
      },
      persona: {
        cedula: p.persona.cedula || null,
        nombre: p.persona.nombre || null,
        apellido: p.persona.apellido || null,
        telefono: p.persona.telefono || null,
        firma: r.chofer_firma
      },
      items,
      itemsEvaluables: p.items.filter((i) => i.tipo !== 'CONTENEDOR'),
      respuestas: r.respuestas
    })
    return await asegurarEnlaceInspeccion(r.id, detalle, p.evaluadorId ?? null)
  } catch (e) {
    avisar(
      `El PDF sale sin QR: ${e instanceof Error ? e.message : 'no se pudo crear el enlace público'}`,
      'aviso'
    )
    return null
  }
}

/**
 * Genera el documento, deja el registro como FINALIZADO en el equipo y lo sube
 * si hay conexión.
 *
 * Devuelve cómo terminó para que cada pantalla avise con su texto: el que
 * exporta desde la herramienta ya está mirando el registro, el del historial
 * recién lo cargó.
 */
export async function exportarInspeccion(p: PedidoInspeccion): Promise<ResultadoExportacion> {
  const r = p.registro
  const items = filasParaPdf(p.items, r.respuestas)
  // El QR va en la hoja, así que el enlace se asegura ANTES de generarla.
  const urlDetalle = await enlaceDelDetalle(r, p, items)

  await exportarRevisionPreEntrega({
    titulo: p.moduloNombre,
    fecha: r.fecha,
    evaluador: p.evaluador,
    observaciones: r.observaciones.trim() || null,
    vehiculo: {
      placa: r.placa,
      marca: typeof r.vehiculo.marca === 'string' ? r.vehiculo.marca : null,
      modelo: typeof r.vehiculo.modelo === 'string' ? r.vehiculo.modelo : null,
      color: typeof r.vehiculo.color === 'string' ? r.vehiculo.color : null,
      anio: r.vehiculo.anio == null ? null : String(r.vehiculo.anio),
      kilometraje: r.vehiculo.kilometraje == null ? null : String(r.vehiculo.kilometraje),
      combustible: typeof r.vehiculo.combustible === 'string' ? r.vehiculo.combustible : null
    },
    chofer: {
      cedula: p.persona.cedula || null,
      nombre: p.persona.nombre || null,
      apellido: p.persona.apellido || null,
      cargo: null,
      firma: r.chofer_firma
    },
    etiquetaPersona: 'conductor',
    personaCampos: [
      { etiqueta: 'Cédula / RIF', valor: p.persona.cedula || null },
      // MAYÚSCULAS: es lo que se firma en papel, y así se lee en el acta.
      { etiqueta: 'Nombre', valor: mayus(p.persona.nombre) },
      { etiqueta: 'Apellido', valor: mayus(p.persona.apellido) },
      { etiqueta: 'Teléfono', valor: p.persona.telefono || null }
    ],
    items,
    urlDetalle
  })

  // La inspección quedó hecha: se marca finalizada y se sube en el acto si
  // hay señal. Si no, la cola la sube sola y la borra de local al confirmarla.
  const finalizada: PreEntregaRecord = { ...r, estado: 'FINALIZADA', updated_at: Date.now() }
  await putPreEntrega(finalizada)
  if (p.online) {
    try {
      await subirRevisionPreEntrega(finalizada)
      return { resultado: 'subida', registro: finalizada }
    } catch {
      return { resultado: 'local', registro: finalizada }
    }
  }
  return { resultado: 'local', registro: finalizada }
}
