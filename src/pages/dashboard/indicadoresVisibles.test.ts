import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

function fuente(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

/**
 * Una consulta de indicadores que falla no puede disfrazarse de «aún no hay
 * datos».
 *
 * El síntoma que abre esto: el dashboard en ceros, sin ningún error en
 * pantalla —el `catch` de la página convertía cualquier falla (permiso,
 * columna que ya no existe, red) en una lista vacía, que se renderiza como
 * «Sin datos de módulos para mostrar en el rango». La capa de datos además
 * ignoraba el `error` de PostgREST, así que ni siquiera se levantaba excepción.
 */
describe('indicadores · la carga fallida se hace visible', () => {
  it('la capa de datos propaga el error de PostgREST en vez de devolver vacío', () => {
    const datos = fuente('../../lib/data/indicadores.ts')
    expect(datos).toContain('const { data: evals, error } = await query')
    expect(datos).toContain('if (error) throw new Error(')
    expect(datos).toContain('No se pudieron leer las evaluaciones:')
  })

  it('el dashboard lo dice en pantalla y lo escribe en la consola', () => {
    const pagina = fuente('./DashboardHome.tsx')
    expect(pagina).toContain('const [errorCarga, setErrorCarga] = useState<string | null>(null)')
    expect(pagina).toContain("console.error('No se pudieron cargar los indicadores:', e)")
    expect(pagina).toContain('role="alert"')
    expect(pagina).toContain('No se pudieron cargar los indicadores: {errorCarga}')
    // Y un intento nuevo que sí funcione limpia el aviso.
    expect(pagina).toContain('setErrorCarga(null)')
  })

  it('si la consulta sí corrió y no trajo nada, dice QUÉ buscó', () => {
    // Un vacío a secas no dice si no hay datos o si un filtro oculto tras
    // «Filtros» los está escondiendo: el rango y los filtros van escritos.
    const pagina = fuente('./DashboardHome.tsx')
    expect(pagina).toContain('No se encontraron evaluaciones con estos criterios.')
    expect(pagina).toContain('Se buscaron evaluaciones ')
    expect(pagina).toContain("' · sin filtrar sucursal'")
    expect(pagina).toContain("' · todos los módulos'")
    // Con la consulta fallida manda el recuadro rojo, no el de vacío.
    expect(pagina).toContain('!errorCarga && !datos.evaluaciones.length')
  })

  it('las evaluaciones activas se cuentan, con su puntaje en curso', () => {
    // A mitad de mes casi todo está abierto: un corte fijo a «sólo cerradas»
    // dejaba el dashboard entero en ceros. El puntaje de una abierta es su
    // avance real (recalculado con las respuestas), no el cero guardado.
    const pagina = fuente('./DashboardHome.tsx')
    expect(pagina).toContain("const [incluirActivas, setIncluirActivas] = useState(true)")
    expect(pagina).toContain('soloCerradas: incluirActivas ? undefined : true')
    expect(pagina).toContain('Contar también las evaluaciones activas')
    // Y «completadas» sigue midiendo sólo lo cerrado.
    expect(pagina).toContain("datos.evaluaciones.filter((e) => e.estado === 'CERRADA').length")
    // El texto del vacío sigue al modo elegido.
    expect(pagina).toContain("incluirActivas ? '(activas y cerradas)' : 'cerradas'")
    expect(pagina).toContain('Sólo se contaron las cerradas: marca')
  })
})
