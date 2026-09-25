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

export async function listarResponsables(branchId: string): Promise<{ responsables: ResponsableCatalogo[]; mensaje: string | null }> {
  try {
    const respuesta = await supabase.functions.invoke('listar-colaboradores', {
      body: { branchID: branchId, catalogo: true }
    })
    const cuerpo = (respuesta.data ?? null) as RespuestaFuncion | null
    if (respuesta.error || !cuerpo || cuerpo.ok === false) {
      return { responsables: [], mensaje: 'No se pudo consultar departamentos y cargos.' }
    }
    const datos = cuerpo.data
    const encontrados = normalizarCatalogoResponsables(datos)
    const unicos = new Map<string, ResponsableCatalogo>()
    for (const responsable of encontrados) {
      const clave = `${responsable.departamento.toLocaleLowerCase()}::${responsable.cargo.toLocaleLowerCase()}`
      if (!unicos.has(clave)) unicos.set(clave, responsable)
    }
    return {
      responsables: [...unicos.values()].sort((a, b) => a.departamento.localeCompare(b.departamento) || a.cargo.localeCompare(b.cargo)),
      mensaje: null
    }
  } catch {
    return { responsables: [], mensaje: 'Sin conexión para consultar departamentos y cargos.' }
  }
}