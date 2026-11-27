import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Historial · el filtro de unidad se separa en dos modos.
 *
 * Antes el panel de filtros ofrecía Sucursal y Departamento a la vez y los dos
 * selects se limpiaban entre sí para no cruzarse. Ahora el modo se elige en la
 * barra superior (igual que en Unidades) y el panel sólo ofrece el filtro que
 * corresponde.
 *
 * Montar la pantalla exige router, offline, catálogo y Supabase, así que ésta
 * cubre lo que sólo se rompe con un cambio de una línea del fuente.
 */
const codigo = readFileSync(fileURLToPath(new URL('./Historial.tsx', import.meta.url)), 'utf8')

function fuente(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

describe('historial · selector Sucursal/Departamento en la barra superior', () => {
  it('el conmutador se cuelga de la cabecera, junto a Filtros y Aperturar', () => {
    expect(codigo).toContain("const [modoUnidad, setModoUnidad] = useState<'sucursal' | 'departamento'>('sucursal')")
    expect(codigo).toContain('aria-label="Filtrar por unidad"')
    expect(codigo).toContain('aria-pressed={modoUnidad === ')
    expect(codigo).toContain('title="Filtrar por sucursal"')
    expect(codigo).toContain('title="Filtrar por departamento"')
    // Mismo dibujo que el de Unidades: pestañas redondas, icono y rótulo.
    expect(codigo).toContain('<Store className="h-3.5 w-3.5 sm:mr-2" />')
    expect(codigo).toContain('<Building2 className="h-3.5 w-3.5 sm:mr-2" />')
    expect(codigo).toContain('<span className="hidden sm:inline">Sucursal</span>')
  })

  it('cambiar de modo despeja la selección que ya no aplica', () => {
    // Una evaluación es de una sucursal O de un departamento: al cambiar de
    // modo queda sólo el filtro nuevo, que es lo que antes hacía el cruce.
    expect(codigo).toContain('const cambiarModoUnidad = ')
    expect(codigo).toContain("if (modo === 'sucursal') setDepartamentoSel('')")
    expect(codigo).toContain("else setSucursalSel('')")
    // Y la consulta sigue mandando cada filtro por su lado.
    expect(codigo).toContain('sucursal_ids: sucursalSel ? [sucursalSel] : scope')
    expect(codigo).toContain('departamento_ids: departamentoSel ? [departamentoSel] : null')
  })

  it('el modo SEPARA la lista: cada opción trae su clase de evaluación', () => {
    // El criterio del cambio: elegir Departamento en la barra tiene que dejar
    // fuera las de sucursal, no sólo cambiar el desplegable del panel.
    expect(codigo).toContain("soloSucursales: modoUnidad === 'sucursal'")
    expect(codigo).toContain("soloDepartamentos: modoUnidad === 'departamento'")
    // Los argumentos están escritos UNA sola vez y los usan las dos cargas
    // (inicial y refresco de los 60 s): duplicarlos hizo que el modo se
    // cableara en una y en la otra no, y la lista no cambiaba.
    expect(codigo).toContain('const argsFiltro = () => ({')
    expect(codigo.match(/consultarEvaluaciones\(argsFiltro\(\)\)/g)?.length).toBe(2)
    expect(codigo.match(/soloSucursales: modoUnidad/g)?.length).toBe(1)
    // Y el modo figura en las dependencias de los dos efectos que consultan.
    expect(codigo.match(/modoUnidad, scope\?\.join\(','\)\]/g)?.length).toBe(2)
    // La capa de datos sabe cortar en las dos direcciones: sucursal = sin
    // `departamento_id`; departamento = sin `sucursal_id` (no al revés).
    const datos = fuente('../../lib/data/indicadores.ts')
    expect(datos).toContain('soloDepartamentos?: boolean')
    expect(datos).toContain("query = query.is('departamento_id', null)")
    expect(datos).toContain("query = query.is('sucursal_id', null)")
  })

  it('el panel sólo ofrece el filtro del modo elegido', () => {
    expect(codigo).toContain("{modoUnidad === 'sucursal' || scope ? (")
    expect(codigo).toContain('<Field label="Sucursal">')
    expect(codigo).toContain('<Field label="Departamento">')
    // Tres campos en vez de cuatro: Desde, Hasta y el único filtro de unidad.
    expect(codigo).toContain('lg:grid-cols-3')
    // El cruce viejo entre selects ya no hace falta.
    expect(codigo).not.toContain("if (e.target.value) setDepartamentoSel('')")
  })

  it('quien sólo ve su sucursal no tiene nada que separar', () => {
    // Con `scope` (GERENTE_S) no se ofrece el modo: su filtro es su sucursal.
    expect(codigo).toContain('{scope ? null : (')
  })
})
