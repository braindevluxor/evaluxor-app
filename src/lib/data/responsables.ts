import { supabase } from '../supabase'

export interface ResponsableCatalogo {
  departamento: string
  cargo: string
}

interface RespuestaFuncion {
  ok?: boolean
  status?: number
  data?: unknown
  error?: string
}

const CLAVES_DEPARTAMENTO = ['departamento', 'department', 'department_name', 'departmentname', 'area', 'area_name']
const CLAVES_CARGO = ['cargo', 'position', 'position_name', 'positionname', 'role', 'role_name', 'job_title', 'jobtitle']

function claveNormalizada(valor: string): string {
  return valor.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

function textoDe(obj: Record<string, unknown>, claves: string[]): string {
  const entradas = Object.entries(obj)
  for (const clave of claves) {
    const encontrada = entradas.find(([k]) => claveNormalizada(k) === claveNormalizada(clave))?.[1]
    if (typeof encontrada === 'string' && encontrada.trim()) return encontrada.trim()
  }
  return ''
}

function extraerCatalogo(valor: unknown, departamentoHeredado = '', salida: ResponsableCatalogo[] = []): ResponsableCatalogo[] {
  if (Array.isArray(valor)) {
    for (const entrada of valor) extraerCatalogo(entrada, departamentoHeredado, salida)
    return salida
  }
  if (!valor || typeof valor !== 'object') return salida

  const obj = valor as Record<string, unknown>
  const departamento = textoDe(obj, CLAVES_DEPARTAMENTO) || departamentoHeredado
  const departamentoAnidado = obj.department && typeof obj.department === 'object'
    ? textoDe(obj.department as Record<string, unknown>, ['name', ...CLAVES_DEPARTAMENTO])
    : ''
  const tieneDepartamento = Object.keys(obj).some((clave) => CLAVES_DEPARTAMENTO.some((c) => claveNormalizada(c) === claveNormalizada(clave)))
  const cargo = textoDe(obj, CLAVES_CARGO) || (tieneDepartamento && typeof obj.name === 'string' ? obj.name.trim() : '')
  const departamentoFinal = departamentoAnidado || departamento
  if (cargo) salida.push({ departamento: departamentoFinal || 'Sin departamento', cargo })
  if (departamentoFinal && !cargo) salida.push({ departamento: departamentoFinal, cargo: '' })

  for (const [clave, hijo] of Object.entries(obj)) {
    const esDepartamento = claveNormalizada(clave) === 'department' || CLAVES_DEPARTAMENTO.some((c) => claveNormalizada(c) === claveNormalizada(clave))
    const posibleDepartamento = typeof hijo === 'string' && esDepartamento ? hijo : departamentoFinal
    if (hijo && typeof hijo === 'object') extraerCatalogo(hijo, posibleDepartamento, salida)
  }
  return salida
}

export function normalizarCatalogoResponsables(valor: unknown): ResponsableCatalogo[] {
  return extraerCatalogo(valor)
}

/**
 * Une los catálogos de varias sucursales en una sola lista sin repetir cargos.
 * El mismo cargo puede venir en muchos branch (p. ej. «Soldador» en 16 de 17):
 * se muestra una sola vez, en el departamento que aparece primero por orden alfabético.
 */
export function fusionarCatalogo(entradas: ResponsableCatalogo[]): ResponsableCatalogo[] {
  const ordenadas = entradas
    .filter((e) => e.cargo.trim())
    .sort((a, b) => a.departamento.localeCompare(b.departamento) || a.cargo.localeCompare(b.cargo))
  const unicos = new Map<string, ResponsableCatalogo>()
  for (const entrada of ordenadas) {
    const cargo = entrada.cargo.trim()
    const clave = claveNormalizada(cargo)
    if (!clave || unicos.has(clave)) continue
    unicos.set(clave, { departamento: entrada.departamento || 'Sin departamento', cargo })
  }
  return [...unicos.values()].sort((a, b) => a.departamento.localeCompare(b.departamento) || a.cargo.localeCompare(b.cargo))
}

export interface DepartamentoCatalogo {
  departamento: string
  cargos: string[]
}

/** Agrupa el catálogo por departamento para mostrarlo como una lista única organizada. */
export function agruparPorDepartamento(catalogo: ResponsableCatalogo[]): DepartamentoCatalogo[] {
  const porDepartamento = new Map<string, string[]>()
  for (const { departamento, cargo } of catalogo) {
    const cargos = porDepartamento.get(departamento) ?? []
    cargos.push(cargo)
    porDepartamento.set(departamento, cargos)
  }
  return [...porDepartamento.entries()]
    .map(([departamento, cargos]) => ({ departamento, cargos }))
    .sort((a, b) => a.departamento.localeCompare(b.departamento))
}

type ConsultaCatalogo = ResponsableCatalogo[] | 'sin-conexion' | 'error'

async function consultarCatalogoBranch(branchId: string): Promise<ConsultaCatalogo> {
  try {
    const respuesta = await supabase.functions.invoke('listar-colaboradores', {
      body: { branchID: branchId, catalogo: true }
    })
    const cuerpo = (respuesta.data ?? null) as RespuestaFuncion | null
    if (respuesta.error || !cuerpo || cuerpo.ok === false) return 'error'
    return normalizarCatalogoResponsables(cuerpo.data)
  } catch {
    return 'sin-conexion'
  }
}

/**
 * Catálogo unificado de cargos: consulta todos los branch indicados (los de las
 * sucursales más la oficina central) y los devuelve sin repetir cargos.
 */
export async function listarResponsables(branchIds: string[]): Promise<{ responsables: ResponsableCatalogo[]; mensaje: string | null }> {
  const branches = Array.from(new Set(branchIds.map((b) => (b ?? '').trim()).filter(Boolean)))
  if (!branches.length) return { responsables: [], mensaje: 'No hay sucursales con ID de trabajadores (branch) configurado.' }

  const resultados = await Promise.all(branches.map(consultarCatalogoBranch))
  const entradas = resultados.flatMap((r) => (Array.isArray(r) ? r : []))
  if (!entradas.length) {
    const mensaje = resultados.every((r) => r === 'sin-conexion')
      ? 'Sin conexión para consultar departamentos y cargos.'
      : 'No se encontraron cargos o departamentos en las sucursales consultadas.'
    return { responsables: [], mensaje }
  }
  return { responsables: fusionarCatalogo(entradas), mensaje: null }
}