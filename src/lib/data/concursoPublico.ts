import { supabase } from '../supabase'

/**
 * LA LANDING PÚBLICA DE GRAN COSECHA (/concurso)
 * ----------------------------------------------
 * La página se comparte sin cuenta, así que todo lo que muestra sale de una
 * sola función SECURITY DEFINER (`ver_concurso_publico`, en schema.sql): anon
 * no tiene privilegio de tabla sobre nada.
 *
 * Mientras el bloque `gran-cosecha-publico.sql` no esté aplicado en la base,
 * la función no existe y la RPC falla: en ese caso la pantalla cae en
 * EJEMPLO_CONCURSO y lo avisa con una franja — nunca se muestra como real.
 *
 * `contenido` son las filas de `gran_cosecha_contenido` (periodo + clave):
 * bases, faq y ganadores viven en 'GLOBAL'; calendario, premios y jurado se
 * cargan por trimestre. `contenidoDe` resuelve cuál gana.
 */

/** Estados que la página pública muestra (CANCELADO queda afuera en el SQL). */
export type EstadoPublico = 'PROPUESTA' | 'EN_CURSO' | 'COMPLETADO'

/** Las claves de `gran_cosecha_contenido` que lee esta pantalla. */
export type ClaveContenido = 'bases' | 'calendario' | 'premios' | 'jurado' | 'faq' | 'ganadores'

export interface AvancePublico {
  porcentaje: number | null
  detalle: string
  created_at: string
}

export interface ProyectoPublico {
  id: string
  titulo: string
  descripcion: string
  /** Sólo nombres: el SQL nunca manda los usuario_id. */
  miembros: string[]
  avance: number
  avance_nota: string | null
  estado: EstadoPublico
  created_at: string
  avances: AvancePublico[]
}

export interface FilaContenido {
  clave: ClaveContenido
  periodo: string
  valor: unknown
  /** Sólo las filas del editor las traen: la RPC pública no las manda. */
  actualizado_at?: string
  actualizado_por?: string | null
}

export interface ConcursoPublico {
  periodo: string
  proyectos: ProyectoPublico[]
  contenido: FilaContenido[]
}

/* --- La forma esperada de cada `valor` (la valida el editor y la lee la página) - */

export interface BasesContenido {
  texto: string
}

export interface HitoCalendario {
  /** `YYYY-MM-DD`. */
  fecha: string
  titulo: string
  detalle?: string
}

export interface PremioContenido {
  puesto: string
  titulo: string
  detalle?: string
}

export interface JuradoContenido {
  nombre: string
  cargo: string
}

export interface FaqContenido {
  pregunta: string
  respuesta: string
}

export interface GanadorContenido {
  periodo: string
  proyecto: string
  equipo?: string
}

/** Tipos de los `valor` por clave, para que el editor no adivine. */
export interface ValoresContenido {
  bases: BasesContenido
  calendario: { hitos: HitoCalendario[] }
  premios: { items: PremioContenido[] }
  jurado: { items: JuradoContenido[] }
  faq: { items: FaqContenido[] }
  ganadores: { items: GanadorContenido[] }
}

/**
 * Lee el concurso de un período. Devuelve `null` si la función todavía no
 * existe en la base (bloque sin aplicar) o si no hay red: en los dos casos
 * la pantalla muestra el aviso de vista previa con datos de ejemplo.
 */
export async function obtenerConcursoPublico(periodo: string): Promise<ConcursoPublico | null> {
  try {
    const { data, error } = await supabase.rpc('ver_concurso_publico', { p_periodo: periodo })
    if (error) return null
    const paquete = data as ConcursoPublico | null
    if (!paquete || !Array.isArray(paquete.proyectos) || !Array.isArray(paquete.contenido)) return null
    return paquete
  } catch {
    return null
  }
}

/* -------------------------------------------------------------------------
 * EDITOR DE CONTENIDO (pantalla de Contenido, rol JUEZ/LÍDER)
 *
 * Escribe directo sobre `gran_cosecha_contenido` con sesión: la RLS de la
 * tabla usa la misma cerradura `puede_gran_cosecha()` que los proyectos, así
 * que si el rol no corresponde el guardado ni llega a la base.
 * ------------------------------------------------------------------------- */

/**
 * Traduce el error de una tabla o función que todavía no existe en la base
 * (bloque `gran-cosecha-publico.sql` sin aplicar en el SQL Editor) a un
 * mensaje que el editor pueda mostrar sin tecnicismos.
 */
function errorDeBloque(error: { code?: string; message: string }, mensaje: string): Error {
  if (error.code === '42P01' || error.code === '42883' || /gran_cosecha_contenido|ver_concurso_publico/.test(error.message)) {
    return new Error('El bloque gran-cosecha-publico.sql todavía no está aplicado en la base. Pegalo en el SQL Editor de Supabase y recargá esta pantalla.')
  }
  return new Error(mensaje)
}

/**
 * Todas las filas de contenido que el editor necesita para un trimestre: las
 * del período y las GLOBAL (bases, faq y ganadores viven en GLOBAL).
 */
export async function leerContenidoEditor(periodo: string): Promise<FilaContenido[]> {
  const { data, error } = await supabase
    .from('gran_cosecha_contenido')
    .select('periodo, clave, valor, actualizado_at, actualizado_por')
    .in('periodo', [periodo, 'GLOBAL'])
    .order('clave')
  if (error) throw errorDeBloque(error, 'No se pudo leer el contenido del concurso.')
  return (data ?? []) as FilaContenido[]
}

/**
 * Guarda una sección (upsert sobre la PK periodo+clave).
 *
 * `actualizado_por` va en la fila para que la pantalla pueda mostrar quién
 * tocó qué; la RLS es la que decide SI puede tocarlo.
 */
export async function guardarContenido(fila: {
  periodo: string
  clave: ClaveContenido
  valor: unknown
  autor: string | null
}): Promise<void> {
  const { error } = await supabase.from('gran_cosecha_contenido').upsert(
    {
      periodo: fila.periodo,
      clave: fila.clave,
      valor: fila.valor,
      actualizado_at: new Date().toISOString(),
      actualizado_por: fila.autor
    },
    { onConflict: 'periodo,clave' }
  )
  if (error) {
    if (error.code === '42501') {
      throw new Error('Tu rol no puede editar el contenido del concurso: se necesita JUEZ o LÍDER.')
    }
    throw errorDeBloque(error, 'No se pudo guardar el contenido.')
  }
}

/**
 * El contenido de una clave, prefiriendo el del período sobre el GLOBAL.
 *
 * El SQL devuelve las dos filas cuando existen las dos; gana la del período
 * porque es la que el editor cargó para ESTE trimestre. Sin fila de ningún
 * tipo, `null`: la sección muestra su estado vacío en vez de inventar.
 */
export function contenidoDe<K extends ClaveContenido>(
  contenido: readonly FilaContenido[],
  clave: K,
  periodo: string
): ValoresContenido[K] | null {
  const delPeriodo = contenido.find((f) => f.clave === clave && f.periodo === periodo)
  if (delPeriodo) return delPeriodo.valor as ValoresContenido[K]
  const global = contenido.find((f) => f.clave === clave && f.periodo === 'GLOBAL')
  if (global) return global.valor as ValoresContenido[K]
  return null
}

/**
 * El ejemplo re-etiquetado al trimestre que se está mirando.
 *
 * El dataset de ejemplo está escrito para 2026-T4, pero la página se abre
 * también en otros trimestres: sin re-etiquetar, `contenidoDe` buscaría las
 * filas del trimestre actual y no encontraría las del ejemplo. Acá se copian
 * sólo las filas con periodo propio (las GLOBAL se mantienen tal cual).
 */
export function ejemploPara(periodo: string): ConcursoPublico {
  return {
    periodo,
    proyectos: EJEMPLO_CONCURSO.proyectos,
    contenido: EJEMPLO_CONCURSO.contenido.map((f) => (f.periodo === 'GLOBAL' ? f : { ...f, periodo }))
  }
}

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
]

/**
 * `2026-12-18` → «18 de diciembre» (con año sólo si no es el corriente, para
 * que el calendario de un trimestre no lo repita en cada hito). Sin depender
 * del locale, igual que el resto de las fechas del repo.
 */
export function fechaLarga(fecha: string, hoy = new Date()): string {
  const [a, m, d] = fecha.split('-').map(Number)
  if (!a || !m || !d || m > 12 || d > 31) return fecha
  const anio = a === hoy.getFullYear() ? '' : ` de ${a}`
  return `${d} de ${MESES[m - 1]}${anio}`
}

/**
 * Días desde hoy hasta el hito: negativo si ya pasó, 0 si es hoy.
 * Se compara en días calendario, no en horas: el hito de las 00:00 de un
 * lunes no cuenta como "hoy" desde la madrugada del domingo.
 */
export function diasHasta(fecha: string, hoy = new Date()): number {
  const [a, m, d] = fecha.split('-').map(Number)
  if (!a || !m || !d) return 0
  const objetivo = Date.UTC(a, m - 1, d)
  const hoyUtc = Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate())
  return Math.round((objetivo - hoyUtc) / 86_400_000)
}

/** Estado de un hito del calendario respecto de hoy. */
export function estadoHito(fecha: string, hoy = new Date()): 'pasado' | 'hoy' | 'futuro' {
  const dias = diasHasta(fecha, hoy)
  return dias < 0 ? 'pasado' : dias === 0 ? 'hoy' : 'futuro'
}

/* -------------------------------------------------------------------------
 * VISTA PREVIA: datos de ejemplo.
 *
 * Se usan SÓLO cuando la RPC falla (bloque sin aplicar o sin red) y la
 * pantalla lo dice con una franja visible. No son proyectos reales: son la
 * materialización del boceto aprobado para que la página se pueda revisar
 * antes de que exista la base. Al aplicar el bloque y cargar contenido real,
 * estos datos desaparecen solos.
 * ---------------------------------------------------------------------- */

const dia = (n: number) => `2026-11-${String(n).padStart(2, '0')}T10:00:00Z`

export const EJEMPLO_CONCURSO: ConcursoPublico = {
  periodo: '2026-T4',
  proyectos: [
    {
      id: 'ej-1',
      titulo: 'Estantes sin quiebres',
      descripcion:
        'Un piloto de reorden en gondola para que el faltante de un frente no pare el pasillo: medicion diaria en tres sucursales y reposicion el mismo dia.',
      miembros: ['Carla Ruiz', 'Diego Sosa', 'Nadia Peña'],
      avance: 82,
      avance_nota: 'Cerramos el piloto en dos sucursales: falta la tercera.',
      estado: 'EN_CURSO',
      created_at: '2026-10-05T10:00:00Z',
      avances: [
        { porcentaje: 0, detalle: 'Proyecto presentado', created_at: '2026-10-05T10:00:00Z' },
        { porcentaje: 45, detalle: 'Primer piloto activo en Sucursal Centro', created_at: '2026-10-28T10:00:00Z' },
        { porcentaje: 82, detalle: 'Cerramos el piloto en dos sucursales: falta la tercera.', created_at: dia(10) }
      ]
    },
    {
      id: 'ej-2',
      titulo: 'Caja cero espera',
      descripcion:
        'Prediccion de picos de cola por horario y dia, con apertura de cajas preventiva en la franja que la gente ya sabe que se llena.',
      miembros: ['Ivan Ledesma', 'Paula Ortega', 'Marco Bianchi'],
      avance: 67,
      avance_nota: 'El modelo ya predice los sabados; falta el ajuste fino.',
      estado: 'EN_CURSO',
      created_at: '2026-10-07T10:00:00Z',
      avances: [
        { porcentaje: 0, detalle: 'Proyecto presentado', created_at: '2026-10-07T10:00:00Z' },
        { porcentaje: 30, detalle: 'Datos de dos meses cargados al modelo', created_at: '2026-10-24T10:00:00Z' },
        { porcentaje: 67, detalle: 'El modelo ya predice los sabados; falta el ajuste fino.', created_at: dia(8) }
      ]
    },
    {
      id: 'ej-3',
      titulo: 'Fruta fresca al dia',
      descripcion:
        'Rotacion por lote con etiqueta de llegada visible para el cliente: primero lo que esta en su punto, y descuento automatico en el ultimo dia.',
      miembros: ['Sofia Aguirre', 'Rocio Miranda', 'Hector Ponce'],
      avance: 54,
      avance_nota: 'Etiqueta probada en dos fruterias; falta el descuento automatico.',
      estado: 'EN_CURSO',
      created_at: '2026-10-12T10:00:00Z',
      avances: [
        { porcentaje: 0, detalle: 'Proyecto presentado', created_at: '2026-10-12T10:00:00Z' },
        { porcentaje: 54, detalle: 'Etiqueta probada en dos fruterias; falta el descuento automatico.', created_at: dia(6) }
      ]
    },
    {
      id: 'ej-4',
      titulo: 'Deposito a medida',
      descripcion:
        'Ubicacion sugerida por rotacion real de cada SKU en el deposito, para que la reposicion deje de depender de la memoria del encargado.',
      miembros: ['Julian Ferreyra', 'Camila Duarte', 'Oscar Rivas'],
      avance: 31,
      avance_nota: 'Mapeo del deposito central listo; sigue la sucursal norte.',
      estado: 'EN_CURSO',
      created_at: '2026-10-18T10:00:00Z',
      avances: [
        { porcentaje: 0, detalle: 'Proyecto presentado', created_at: '2026-10-18T10:00:00Z' },
        { porcentaje: 31, detalle: 'Mapeo del deposito central listo; sigue la sucursal norte.', created_at: dia(4) }
      ]
    },
    {
      id: 'ej-5',
      titulo: 'Aviso de vencimiento temprano',
      descripcion:
        'Alerta semanal por lote por vencer con sugerencia de posicion en gondola, para atacar el vencimiento antes de que sea merma.',
      miembros: ['Veronica Salas', 'Tomas Aguirre', 'Luz Fernandez'],
      avance: 12,
      avance_nota: 'Armado el listado de alertas; falta la prueba en sucursal.',
      estado: 'EN_CURSO',
      created_at: '2026-10-25T10:00:00Z',
      avances: [
        { porcentaje: 0, detalle: 'Proyecto presentado', created_at: '2026-10-25T10:00:00Z' },
        { porcentaje: 12, detalle: 'Armado el listado de alertas; falta la prueba en sucursal.', created_at: dia(2) }
      ]
    }
  ],
  contenido: [
    {
      clave: 'bases',
      periodo: 'GLOBAL',
      valor: {
        texto:
          'El concurso es de **toda la empresa**: cualquiera con cuenta en EvaLuxor puede presentar un proyecto.\n\n' +
          '- **Equipos de a tres personas como mínimo**, sin repetidos, de cualquier area o sucursal.\n' +
          '- **Un trimestre de desarrollo**: el proyecto se presenta, se avanza y se entrega dentro del mismo trimestre.\n' +
          '- **Avances con porcentaje y nota**: cada avance queda en la bitacora del proyecto, y la empresa lo ve en vivo.\n' +
          '- **Los jueces dan seguimiento** a cada equipo; no hay presentacion final sorpresa.\n' +
          '- **Nada se borra**: si un proyecto no sigue, se cancela y queda registrado, no desaparece.\n\n' +
          'Gana el proyecto que mejor combine avance real, aplicabilidad en la tienda y trabajo en equipo.'
      }
    },
    {
      clave: 'calendario',
      periodo: '2026-T4',
      valor: {
        hitos: [
          { fecha: '2026-10-01', titulo: 'Arranque del trimestre', detalle: 'Se abre la convocatoria para todos los equipos.' },
          { fecha: '2026-10-20', titulo: 'Cierre de inscripciones', detalle: 'Ultimo dia para presentar la ficha del proyecto.' },
          { fecha: '2026-11-30', titulo: 'Ultimo avance del mes', detalle: 'Cada equipo reporta porcentaje y nota de avance.' },
          { fecha: '2026-12-15', titulo: 'Cierre de entregas', detalle: 'El proyecto queda con su avance final.' },
          { fecha: '2026-12-18', titulo: 'Premiacion', detalle: 'Los jueces anuncian los ganadores del trimestre.' }
        ]
      }
    },
    {
      clave: 'premios',
      periodo: '2026-T4',
      valor: {
        items: [
          { puesto: '1er puesto', titulo: 'Gran Cosecha', detalle: 'Trofeo, reconocimiento publico y el proyecto replicado en la red.' },
          { puesto: '2do puesto', titulo: 'Segundo puesto', detalle: 'Reconocimiento publico del equipo ganador.' },
          { puesto: 'Mencion', titulo: 'Mencion del jurado', detalle: 'Para el proyecto mas creativo del trimestre.' }
        ]
      }
    },
    {
      clave: 'jurado',
      periodo: '2026-T4',
      valor: {
        items: [
          { nombre: 'Gerencia de Operaciones', cargo: 'Presidencia del jurado' },
          { nombre: 'Talento Humano', cargo: 'Vocal' },
          { nombre: 'Calidad y Servicio', cargo: 'Vocal' }
        ]
      }
    },
    {
      clave: 'faq',
      periodo: 'GLOBAL',
      valor: {
        items: [
          {
            pregunta: 'Quien puede participar?',
            respuesta: 'Cualquier colaborador con cuenta en EvaLuxor. No hace falta ser encargado ni de una sucursal especifica.'
          },
          {
            pregunta: 'Cuantos son por equipo?',
            respuesta: 'Tres personas como minimo, sin repetidos. Pueden ser de areas o sucursales distintas.'
          },
          {
            pregunta: 'Como se evalua?',
            respuesta: 'Los jueces dan seguimiento durante el trimestre y miran avance real, aplicabilidad en la tienda y trabajo en equipo. Cada avance queda en la bitacora del proyecto.'
          },
          {
            pregunta: 'Donde veo como va mi proyecto?',
            respuesta: 'En Gran Cosecha, dentro de EvaLuxor: ahi cargas los avances y ahi los ve toda la empresa en la pagina publica del concurso.'
          }
        ]
      }
    },
    {
      clave: 'ganadores',
      periodo: 'GLOBAL',
      valor: {
        items: [
          { periodo: 'T3 2026', proyecto: 'Almacen impecable', equipo: 'Lucia Bruni, Emilio Vega, Teresa Roldan' },
          { periodo: 'T2 2026', proyecto: 'Precio justo, siempre', equipo: 'Andres Mena, Raul Otero, Belen Quiroga' }
        ]
      }
    }
  ]
}
