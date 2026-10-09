import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

function fuente(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

describe('departamentos · entra desde la Consola y solo el Líder', () => {
  it('la ruta está protegida y el menú la lista junto a Sucursales', () => {
    const app = fuente('../../App.tsx')
    const consola = fuente('../../components/layouts/ConsoleLayout.tsx')
    expect(app).toContain('path="/config/departamentos"')
    expect(app).toContain('<SoloLider><DepartamentosPage /></SoloLider>')
    expect(consola).toContain("to: '/config/departamentos'")
    expect(consola).toContain("label: 'Departamentos'")
    // Cabecera de la vista: rótulo y subtítulo que dicen qué es un departamento.
    expect(consola).toContain("'/config/departamentos': { titulo: 'Departamentos'")
    expect(consola).toContain('Áreas de la organización que se evalúan por separado')
  })
})

describe('departamentos · el listado es de departamentos, no sucursales', () => {
  it('la pantalla habla con su módulo de datos y con su propio formulario', () => {
    const pagina = fuente('./Departamentos.tsx')
    expect(pagina).toContain('listarDepartamentosAdmin')
    expect(pagina).toContain('guardarDepartamento')
    expect(pagina).toContain('id="form-departamento"')
    // Nada de columnas de tienda: un departamento no tiene shop_id ni Gerente S.
    expect(pagina).not.toContain('listarSucursalesAdmin')
    expect(pagina).not.toContain('shop_id')
    expect(pagina).not.toContain('branch_id')
  })

  it('un nombre repetido se traduce en un mensaje que se entiende', () => {
    const datos = fuente('../../lib/data/departamentos.ts')
    expect(datos).toContain("supabase.from('departamentos_centralizados')")
    expect(datos).toContain('23505')
    expect(datos).toContain('Ya existe un departamento con ese nombre.')
    // Alta y edición en una sola función, como guardarSucursal.
    expect(datos).toContain('export async function guardarDepartamento')
    expect(datos).toContain('.insert(')
    expect(datos).toContain('.update(')
  })

  it('el tipo nuevo queda en el catálogo de tipos', () => {
    const tipos = fuente('../../lib/types.ts')
    expect(tipos).toContain('export interface Departamento')
    expect(tipos).toContain('nombre: string')
  })
})

describe('departamentos · eliminar', () => {
  it('la fila trae botón rojo y pide confirmación, con la salida blanda a mano', () => {
    const pagina = fuente('./Departamentos.tsx')
    expect(pagina).toContain('title="Eliminar"')
    expect(pagina).toContain('bg-red-600')
    expect(pagina).toContain('title="Eliminar departamento"')
    expect(pagina).toContain('no se puede deshacer')
    // La baja lógica (inactivo) sigue siendo lo recomendado para no perder nada.
    expect(pagina).toContain('en vez de eliminarlo márcalo como')
  })

  it('la función borra por id y, si algo lo impide, lo explica en castellano', () => {
    const datos = fuente('../../lib/data/departamentos.ts')
    expect(datos).toContain('export async function eliminarDepartamento')
    expect(datos).toContain("supabase.from('departamentos_centralizados').delete().eq('id', id)")
    // 23503 = foreign_key_violation: el departamento todavía tiene evaluaciones.
    expect(datos).toContain('23503')
    expect(datos).toContain('tiene evaluaciones asociadas')
  })
})

describe('departamentos · SQL de Supabase', () => {
  const sql = fuente('../../../supabase/departamentos-centralizados.sql')

  it('crea la tabla con RLS: leen los autenticados, gestionan solo el Líder', () => {
    expect(sql).toContain('create table if not exists public.departamentos_centralizados')
    // Nunca la tabla homónima: en la base ya vive una `departamentos` de otro
    // proceso (con una columna `codigo NOT NULL` que esta app no conoce).
    expect(sql).not.toMatch(/create table if not exists public\.departamentos\b/)
    expect(sql).toContain('enable row level security')
    expect(sql).toContain('for select to authenticated using (true)')
    expect(sql).toMatch(/for all using \(public\.es_lider\(\)\) with check \(public\.es_lider\(\)\)/)
    expect(sql).toContain('uniq_departamentos_centralizados_nombre')
  })

  it('Central pasa a llamarse Taller Automotriz sin importar cuántas veces se corra', () => {
    expect(sql).toContain("set nombre = 'Taller Automotriz'")
    expect(sql).toContain("where nombre = 'Central'")
  })

  it('la siembra solo corre si la tabla quedó vacía', () => {
    expect(sql).toContain("('Mercadeo')")
    expect(sql).toContain("('Administración')")
    expect(sql).toMatch(/where not exists \(select 1 from public\.departamentos_centralizados\)/)
  })

  it('el esquema consolidado también la trae', () => {
    const schema = fuente('../../../supabase/schema.sql')
    expect(schema).toContain('create table if not exists public.departamentos_centralizados')
    expect(schema).not.toMatch(/create table if not exists public\.departamentos\b/)
    expect(schema).toContain(
      'drop policy if exists departamentos_centralizados_select on public.departamentos_centralizados'
    )
    expect(schema).toContain(
      'create policy departamentos_centralizados_lider on public.departamentos_centralizados'
    )
  })
})

describe('departamentos · configurar módulos, ítems y puntos', () => {
  it('usa la misma pantalla que las sucursales, sin duplicarla', () => {
    const pagina = fuente('./Departamentos.tsx')
    const config = fuente('./SucursalConfig.tsx')
    expect(pagina).toContain('title="Configurar módulos e ítems"')
    expect(pagina).toContain('<DepartamentoConfigModal')
    // Una sola implementación; cada unidad solo dice de dónde lee y dónde guarda.
    expect(config).toContain('export function ConfigUnidadModal')
    expect(config).toContain('export function SucursalConfigModal')
    expect(config).toContain('export function DepartamentoConfigModal')
    expect(config).toContain('cargar={listarSucursalConfigAdmin}')
    expect(config).toContain('cargar={listarDepartamentoConfigAdmin}')
    // La herramienta Revisión Pre-Entrega no se asigna por unidad, ni acá ni en sucursales.
    expect(config).toContain('mods.filter((m) => !m.herramienta)')
  })

  it('se guarda en las tres tablas departamento_*', () => {
    const datos = fuente('../../lib/data/departamentos.ts')
    for (const tabla of ['departamento_modulos', 'departamento_items', 'departamento_opciones']) {
      expect(datos).toContain(`'${tabla}'`)
    }
    expect(datos).toContain('export async function listarDepartamentoConfigAdmin')
    expect(datos).toContain('export async function configurarDepartamentoModulos')
    expect(datos).toContain('export async function configurarDepartamentoItems')
    expect(datos).toContain('export async function configurarDepartamentoOpciones')
  })

  it('el SQL trae las tres tablas, con su única, su cascada y su RLS', () => {
    const sql = fuente('../../../supabase/departamentos-centralizados.sql')
    for (const tabla of ['departamento_modulos', 'departamento_items', 'departamento_opciones']) {
      expect(sql).toContain(`create table if not exists public.${tabla}`)
      expect(sql).toContain(`policy ${tabla}_select on public.${tabla}`)
      expect(sql).toContain(`policy ${tabla}_lider on public.${tabla}`)
    }
    expect(sql).toContain('unique (departamento_id, modulo_id)')
    expect(sql).toContain('unique (departamento_id, item_id)')
    expect(sql).toContain('unique (departamento_id, item_id, opcion_id)')
    // Al borrar el departamento, su configuración no queda huérfana.
    expect(sql).toContain('references public.departamentos_centralizados(id) on delete cascade')
  })

  it('el esquema consolidado también las trae', () => {
    const schema = fuente('../../../supabase/schema.sql')
    for (const tabla of ['departamento_modulos', 'departamento_items', 'departamento_opciones']) {
      expect(schema).toContain(`create table if not exists public.${tabla}`)
      expect(schema).toContain(`create policy ${tabla}_lider on public.${tabla}`)
    }
  })
})
