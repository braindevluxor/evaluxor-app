import { supabase } from '../supabase'
import { formatearFechaHora, desdeAhora } from '../tiempo'
import { ETIQUETAS_ROL } from '../roles'

/**
 * LA MESA DE AYUDA (HELPDESK TI): LOS CASOS Y SU CHAT
 * ---------------------------------------------------
 * Tres tablas (ver `helpdesk.sql` en schema.sql):
 *
 *  - `helpdesk_ticket`: el caso. Su `codigo` (HD-1043…) lo genera una
 *    SECUENCIA en la base y es la primary key — así la numeración no se
 *    repite aunque dos sucursales creen a la vez.
 *  - `helpdesk_mensaje`: el chat (mensajes de la sucursal, de TI y del
 *    sistema; las NOTAS INTERNAS sólo las lee el equipo de TI —lo decide
 *    el RLS—).
 *  - `helpdesk_tecnico`: el equipo de GUARDIA, elegido por el Gerente de
 *    TI desde la nómina. Es distinto de la LISTA DE ASIGNACIÓN
 *    (`listarCandidatosHelpdesk`): ésa son los USUARIOS con rol
 *    TECNICO_TI.
 *
 * Quién escribe qué lo decide la base: cualquiera con sesión crea casos y
 * manda mensajes `branch`; el equipo de TI atiende (`es_equipo_ti()`),
 * ASIGNAR es de Líder o Gerente de TI (`es_gerente_ti()`, además en un
 * disparador) y el equipo de guardia lo administra ese mismo par. Ésta capa
 * sólo traduce la forma de la pantalla ↔ la de las tablas.
 */

export type EstadoHelpdesk = 'Abierto' | 'En Progreso' | 'Resuelto' | 'Cerrado'
export type PrioridadHelpdesk = 'Baja' | 'Media' | 'Alta' | 'Crítica'

export interface MensajeHelpdesk {
  id: string
  senderType: 'branch' | 'it' | 'system'
  senderName: string
  /** El cuerpo del globo (con `[Adjunto: …]` ya escrito, como pinta la pantalla). */
  text: string
  /** 'HH:MM', derivado de `created_at` (la pantalla lo pinta al final del globo). */
  timestamp: string
  /** Nota interna: la sucursal no la ve (lo decide el RLS). */
  isInternal?: boolean
}

/** El caso con la forma EXACTA que consume la pantalla. */
export interface TicketHelpdesk {
  /** 'HD-1043' (primary key). */
  id: string
  title: string
  description: string
  /** Nombre de la sucursal que reporta (denormalizado al crear). */
  branch: string
  reporterName: string
  category: string
  priority: PrioridadHelpdesk
  status: EstadoHelpdesk
  /** DNI del técnico asignado como texto (id de la lista de la pantalla). */
  assignedTo: string | null
  resolutionMinutes: number | null
  /** Fecha corta "29/09 18:40" para el encabezado del detalle. */
  createdAt: string
  /** Relativo ("hace 5 min") para la lista. */
  updatedAt: string
  /** Sólo con detalle abierto: la lista no las trae. */
  messages: MensajeHelpdesk[]
}

/** Un atendedor de casos, con la forma de la pantalla (avatar y color). */
export interface TecnicoHelpdesk {
  id: string
  name: string
  role: string
  avatar: string
  color: string
  /**
   * La identidad con la que se GUARDA la asignación: el DNI si viene de la
   * nómina (equipo de guardia) o el `usuarioId` si es un USUARIO con rol
   * TECNICO_TI —los usuarios no tienen DNI—. Nunca los dos.
   */
  dni: number | null
  /** `profiles.id` cuando el atendedor es un usuario con rol TECNICO_TI. */
  usuarioId?: string | null
}

const COLORES = ['bg-blue-600', 'bg-emerald-600', 'bg-violet-600', 'bg-amber-600', 'bg-rose-600']

function iniciales(nombre: string): string {
  const partes = nombre.trim().split(/\s+/).filter(Boolean)
  if (!partes.length) return '?'
  return (partes[0][0] + (partes[1]?.[0] ?? '')).toUpperCase()
}

function horaCorta(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' })
}

type FilaTicket = {
  codigo: string
  titulo: string
  descripcion: string | null
  sucursal_nombre: string | null
  reportado_nombre: string | null
  categoria: string
  prioridad: PrioridadHelpdesk
  estado: EstadoHelpdesk
  tecnico_dni: number | null
  /** El usuario con rol TECNICO_TI que atiende (si el atendedor es un usuario). */
  tecnico_usuario: string | null
  resolucion_minutos: number | null
  created_at: string
  updated_at: string
}

type FilaMensaje = {
  id: string
  sender_type: MensajeHelpdesk['senderType']
  sender_name: string
  texto: string
  es_nota_interna: boolean
  adjunto: string | null
  created_at: string
}

function aTicket(f: FilaTicket, messages: MensajeHelpdesk[] = []): TicketHelpdesk {
  return {
    id: f.codigo,
    title: f.titulo,
    description: f.descripcion ?? '',
    branch: f.sucursal_nombre ?? 'Sucursal',
    reporterName: f.reportado_nombre ?? '',
    category: f.categoria,
    priority: f.prioridad,
    status: f.estado,
    assignedTo:
    f.tecnico_usuario ?? (f.tecnico_dni != null ? String(f.tecnico_dni) : null),
    resolutionMinutes: f.resolucion_minutos,
    createdAt: formatearFechaHora(f.created_at),
    updatedAt: desdeAhora(f.updated_at),
    messages
  }
}

function aMensaje(f: FilaMensaje): MensajeHelpdesk {
  return {
    id: f.id,
    senderType: f.sender_type,
    senderName: f.sender_name,
    text: f.texto,
    timestamp: horaCorta(f.created_at),
    isInternal: f.es_nota_interna || undefined
  }
}

const COLS_TICKET =
  'codigo, titulo, descripcion, sucursal_nombre, reportado_nombre, categoria, prioridad, estado, tecnico_dni, tecnico_usuario, resolucion_minutos, created_at, updated_at'

/** Todos los casos, del más reciente al más viejo (como los pinta la lista). */
export async function listarTicketsHelpdesk(): Promise<TicketHelpdesk[]> {
  const { data, error } = await supabase
    .from('helpdesk_ticket')
    .select(COLS_TICKET)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map((f) => aTicket(f as FilaTicket))
}

/** El chat de UN caso, en orden. Se pide al abrir el detalle. */
export async function listarMensajesHelpdesk(codigo: string): Promise<MensajeHelpdesk[]> {
  const { data, error } = await supabase
    .from('helpdesk_mensaje')
    .select('id, sender_type, sender_name, texto, es_nota_interna, adjunto, created_at')
    .eq('codigo_ticket', codigo)
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []).map((f) => aMensaje(f as FilaMensaje))
}

/**
 * Crea el caso con su primer mensaje (la descripción), como lo arma la
 * pantalla. El `codigo` lo pone la base (secuencia) y se devuelve el caso
 * ya mapeado, con ese mensaje adentro.
 */
export async function crearTicketHelpdesk(datos: {
  titulo: string
  descripcion: string
  sucursalId: string | null
  sucursalNombre: string
  reporterName: string
  categoria: string
  prioridad: PrioridadHelpdesk
}): Promise<TicketHelpdesk> {
  const usuario = (await supabase.auth.getUser()).data.user
  const { data, error } = await supabase
    .from('helpdesk_ticket')
    .insert({
      titulo: datos.titulo,
      descripcion: datos.descripcion,
      sucursal_id: datos.sucursalId,
      sucursal_nombre: datos.sucursalNombre,
      reportado_por: usuario?.id ?? null,
      reportado_nombre: datos.reporterName,
      categoria: datos.categoria,
      prioridad: datos.prioridad
    })
    .select(COLS_TICKET)
    .single()
  if (error) throw error
  const ticket = aTicket(data as FilaTicket)
  const primerMensaje: MensajeHelpdesk = {
    id: `local-${Date.now()}`,
    senderType: 'branch',
    senderName: `${datos.reporterName} (${datos.sucursalNombre})`,
    text: datos.descripcion,
    timestamp: new Date().toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' })
  }
  const { data: m, error: e2 } = await supabase
    .from('helpdesk_mensaje')
    .insert({
      codigo_ticket: ticket.id,
      sender_type: 'branch',
      sender_name: primerMensaje.senderName,
      texto: primerMensaje.text
    })
    .select('id')
    .single()
  if (e2) throw e2
  primerMensaje.id = m.id
  return { ...ticket, messages: [primerMensaje] }
}

/**
 * Un mensaje del chat: lo escribe la SUCURSAL (`branch`) o TI (`it`, que
 * además puede pasar el estado a "En Progreso" en el mismo movimiento —
 * el auto-move de la pantalla).
 */
export async function enviarMensajeHelpdesk(
  codigo: string,
  mensaje: {
    senderType: 'branch' | 'it'
    senderName: string
    text: string
    isInternal?: boolean
    adjunto?: string | null
    /** El estado al que la respuesta de TI mueve el caso (auto-move). */
    cambiarA?: EstadoHelpdesk
  }
): Promise<void> {
  if (mensaje.cambiarA) {
    const { error } = await supabase
      .from('helpdesk_ticket')
      .update({ estado: mensaje.cambiarA })
      .eq('codigo', codigo)
    if (error) throw error
  }
  const { error } = await supabase.from('helpdesk_mensaje').insert({
    codigo_ticket: codigo,
    sender_type: mensaje.senderType,
    sender_name: mensaje.senderName,
    texto: mensaje.text,
    es_nota_interna: mensaje.isInternal ?? false,
    adjunto: mensaje.adjunto ?? null
  })
  if (error) throw error
}

/**
 * La gesti�n de TI sobre el caso —estado, prioridad, técnico—: UN update
 * + el mensaje de sistema que explica el cambio (el mismo texto que arma
 * la pantalla). Sólo el Líder puede llamarla (RLS).
 */
export async function actualizarTicketHelpdesk(
  codigo: string,
  cambios: {
    estado?: EstadoHelpdesk
    prioridad?: PrioridadHelpdesk
    tecnicoDni?: number | null
    tecnicoUsuario?: string | null
    tecnicoNombre?: string | null
    resolucionMinutos?: number | null
  },
  mensajeSistema: string
): Promise<void> {
  const campos: Record<string, unknown> = {}
  if (cambios.estado !== undefined) campos.estado = cambios.estado
  if (cambios.prioridad !== undefined) campos.prioridad = cambios.prioridad
  if (cambios.tecnicoDni !== undefined) campos.tecnico_dni = cambios.tecnicoDni
  if (cambios.tecnicoUsuario !== undefined) campos.tecnico_usuario = cambios.tecnicoUsuario
  if (cambios.tecnicoNombre !== undefined) campos.tecnico_nombre = cambios.tecnicoNombre
  if (cambios.resolucionMinutos !== undefined) campos.resolucion_minutos = cambios.resolucionMinutos
  if (Object.keys(campos).length) {
    const { error } = await supabase.from('helpdesk_ticket').update(campos).eq('codigo', codigo)
    if (error) throw error
  }
  const { error } = await supabase.from('helpdesk_mensaje').insert({
    codigo_ticket: codigo,
    sender_type: 'system',
    sender_name: 'Sistema HelpDesk',
    texto: mensajeSistema
  })
  if (error) throw error
}

/** El equipo TI: sólo los activos, con la forma de la pantalla. */
export async function listarTecnicosHelpdesk(): Promise<TecnicoHelpdesk[]> {  const { data, error } = await supabase
    .from('helpdesk_tecnico')
    .select('dni, nacionalidad, nombre, especialidad')
    .eq('activo', true)
    .order('nombre')
  if (error) throw error
  return (data ?? []).map((t, i) => ({
    id: String(t.dni),
    name: t.nombre,
    role: t.especialidad || 'Mesa de Ayuda',
    avatar: iniciales(t.nombre),
    color: COLORES[i % COLORES.length],
    dni: t.dni
  }))
}

/**
 * La LISTA DE ASIGNACIÓN: los USUARIOS con rol TECNICO_TI.
 *
 * Se leen de `profiles` —cualquier sesión puede leerla (RLS
 * `profiles_select`)— y sólo los ACTIVOS: a un usuario apagado no se le
 * asigna un caso. La forma es la MISMA que la del equipo de guardia para
 * que la pantalla use un solo tipo de objeto, con `usuarioId` como
 * identidad (los usuarios no tienen DNI) y `dni` en null.
 */
export async function listarCandidatosHelpdesk(): Promise<TecnicoHelpdesk[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, nombre, usuario, activo')
    .eq('rol', 'TECNICO_TI')
    .eq('activo', true)
    .order('nombre')
  if (error) throw error
  return (data ?? []).map((p, i) => {
    const nombre = p.nombre?.trim() || p.usuario
    return {
      id: String(p.id),
      name: nombre,
      role: ETIQUETAS_ROL.TECNICO_TI,
      avatar: iniciales(nombre),
      color: COLORES[i % COLORES.length],
      dni: null,
      usuarioId: p.id,
    }
  })
}

/**
 * Agrega un técnico desde la nómina (el Líder busca por nombre y lo suma).
 * Re-elegir al mismo lo REACTIVA con la especialidad nueva.
 */
export async function agregarTecnicoHelpdesk(t: {
  dni: number
  nacionalidad?: string
  nombre: string
  especialidad?: string
}): Promise<void> {
  const { error } = await supabase.from('helpdesk_tecnico').upsert(
    {
      dni: t.dni,
      nacionalidad: t.nacionalidad ?? 'V',
      nombre: t.nombre,
      especialidad: t.especialidad?.trim() || 'Mesa de Ayuda',
      activo: true
    },
    { onConflict: 'nacionalidad,dni' }
  )
  if (error) throw error
}

/** Saca un técnico del equipo (los casos viejos conservan su nombre). */
export async function quitarTecnicoHelpdesk(dni: number): Promise<void> {
  const { error } = await supabase.from('helpdesk_tecnico').delete().eq('dni', dni)
  if (error) throw error
}
