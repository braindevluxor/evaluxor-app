import { getPhotos, putPreEntrega, type PreEntregaRecord } from '../offline/db'
import { subirRevisionPreEntrega } from '../offline/syncPreEntrega'
import { supabase } from '../supabase'
import type { Item } from '../types'
import { evidenciasDeRespuestas, seccionarItems, type Persona } from '../inspeccionVehiculo'
import { exportarRevisionPreEntrega } from './exportarRevisionPreEntrega'
import { resolverPregunta } from './preguntasRevision'

/**
 * PDF DE UNA INSPECCIÓN DE VEHÍCULO, DESDE CUALQUIER PANTALLA
 * -----------------------------------------------------------
 * Lo comparten DOS lugares: la herramienta (donde se llena) y el historial
 * (donde se vuelve a descargar sin pasar por la pantalla). Reimplementarlo en
 * el historial daría dos versiones del mismo documento que se divergen —la
 * del historial sin las fotos del bucket, o sin marcar la inspección como
 * finalizada—, así que la máquina vive acá y las pantallas sólo la llaman.
 *
 * Toca IndexedDB (fotos locales y el registro), Storage (paths firmados) y la
 * cola de subida: a diferencia del resto de `lib/pdf`, éste no es puro.
 */
export interface PedidoInspeccion {
  registro: PreEntregaRecord
  /** Ítems del módulo completo (con secciones): de ahí salen filas y fotos. */
  items: Item[]
  /** Persona del formulario, que puede haberse editado sin guardar. */
  persona: Persona
  moduloNombre: string
  evaluador: string | null
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
): { etiqueta: string; valor: string; grupo: string | null }[] {
  const filas: { etiqueta: string; valor: string; grupo: string | null }[] = []
  for (const g of seccionarItems(items)) {
    for (const item of g.items) {
      const p = resolverPregunta(item, respuestas[item.id])
      for (const f of p.filas) {
        filas.push({ etiqueta: `${item.texto} · ${f.etiqueta}`, valor: f.valor, grupo: g.seccion ?? 'Dictamen' })
      }
      if (p.veredicto) {
        filas.push({ etiqueta: `${item.texto} · Nota`, valor: p.veredicto, grupo: g.seccion ?? 'Dictamen' })
      }
    }
  }
  return filas
}

/**
 * Las fotos de las respuestas como URLs listas para el documento.
 *
 * Dos orígenes: las que siguen en el dispositivo (IndexedDB) y las que ya
 * están en el bucket (paths firmados). Se revocan todas al terminar para no
 * dejar blob: colgados de la memoria de la pestaña.
 */
export async function fotosParaPdf(
  registro: PreEntregaRecord,
  items: Item[]
): Promise<{ urls: string[]; fotos: { src: string; pie: string }[] }> {
  const evaluables = items.filter((i) => i.tipo !== 'CONTENEDOR')
  const evidencias = evidenciasDeRespuestas(evaluables, registro.respuestas)
  const urls: string[] = []
  const fotos: { src: string; pie: string }[] = []

  for (const ev of evidencias) {
    for (const foto of await getPhotos(ev.photoIds)) {
      const src = URL.createObjectURL(foto.blob)
      urls.push(src)
      fotos.push({ src, pie: ev.pie })
    }
  }

  const firmadas = new Map<string, string>()
  const paths = [...new Set(evidencias.flatMap((ev) => ev.paths))]
  if (paths.length) {
    const { data } = await supabase.storage.from('evidencias').createSignedUrls(paths, 3600)
    const firmadasDeVuelta = data ?? []
    for (let i = 0; i < firmadasDeVuelta.length; i++) {
      const signedUrl = firmadasDeVuelta[i]?.signedUrl
      if (signedUrl) firmadas.set(paths[i], signedUrl)
    }
  }
  for (const ev of evidencias) {
    for (const p of ev.paths) {
      const src = firmadas.get(p)
      if (src) fotos.push({ src, pie: ev.pie })
    }
  }

  return { urls, fotos }
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
  const { urls, fotos } = await fotosParaPdf(r, p.items)
  try {
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
      etiquetaPersona: 'propietario',
      personaCampos: [
        { etiqueta: 'Cédula / RIF', valor: p.persona.cedula || null },
        { etiqueta: 'Nombre', valor: p.persona.nombre || null },
        { etiqueta: 'Apellido', valor: p.persona.apellido || null },
        { etiqueta: 'Teléfono', valor: p.persona.telefono || null }
      ],
      items: filasParaPdf(p.items, r.respuestas),
      fotos
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
  } finally {
    for (const u of urls) URL.revokeObjectURL(u)
  }
}
