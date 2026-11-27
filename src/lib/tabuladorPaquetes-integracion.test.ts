import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { bloqueSql } from './supabaseSql'

function fuente(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

/**
 * Tabulador de paquetes: el cableado.
 *
 * Las reglas de conversión y de permisos tienen sus propios tests
 * (`tabuladorPaquetes.test.ts` y `tabuladorPaquetes-sql.test.ts`); éste
 * mira lo que ninguno ve: que la pantalla exista con SU ruta y SU menú (la
 * misma cerradura que los bonos), que las TRES vistas sigan cableadas, y
 * que el SQL del esquema siga trayendo el bloque de esta tabla. Si alguien
 * saca la entrada del menú o rompe la vista, falla acá y no en producción.
 */
describe('tabulador de paquetes · la ruta y el menú', () => {
  const app = fuente('../App.tsx')
  const consola = fuente('../components/layouts/ConsoleLayout.tsx')

  it('la ruta está adentro de la consola y pide los DOS roles de bonos', () => {
    expect(app).toContain('<ConsoleLayout />')
    expect(app.indexOf('path="/config/bonos/tabulador"')).toBeGreaterThan(
      app.indexOf('<ConsoleLayout />')
    )
    // Mismo `RequireRol` que `/config/bonos`: LÍDER y GERENTE TH.
    expect(app).toMatch(
      /path="\/config\/bonos\/tabulador"[\s\S]{0,200}roles=\{\[\s*'LIDER',\s*'GERENTE_TH'\s*\]}/
    )
  })

  it('el menú lo ofrece en las DOS ramas de «Compensación» y con su título', () => {
    // Dos items con la misma ruta: la del Líder y la del Gerente de
    // Talento Humano, que sólo ve ese bloque.
    expect(consola.match(/to: '\/config\/bonos\/tabulador'/g)).toHaveLength(2)

    const bloques = consola.match(/seccion: 'Compensación',\s*items: \[[\s\S]*?\n {6}\]/g) ?? []
    expect(bloques).toHaveLength(2)
    for (const bloque of bloques) {
      expect(bloque).toContain("'/config/bonos'")
      expect(bloque).toContain("'/config/bonos/tabulador'")
    }

    // Y con su título en la cabecera, igual que el resto de las vistas.
    expect(consola).toContain("'/config/bonos/tabulador'")
    expect(consola).toContain('Tabulador de paquetes')
  })
})

describe('tabulador de paquetes · las tres vistas', () => {
  const pagina = fuente('../pages/config/TabuladorPaquetes.tsx')

  it('ofrece las tres formas de mirar la tabla', () => {
    expect(pagina).toContain('VISTAS')
    expect(pagina).toContain('Según declaración')
    expect(pagina).toContain('Solo BS')
    expect(pagina).toContain('Solo USD')
  })

  it('pinta las CIFRAS con la moneda de la vista y convierte con la tasa', () => {
    expect(pagina).toContain('COLUMNAS_MONEDA')
    expect(pagina).toContain('valorParaVista')
    expect(pagina).toContain('esConvertido')
    // La tasa que convierte es la del BCV (o la manual), no otra.
    expect(pagina).toContain('obtenerTasaBcv')
    expect(pagina).toContain('leerTasaManual')
    // Sin tasa no hay conversión inventada: hay un aviso en pantalla.
    expect(pagina).toContain('Sin tasa de cambio')
  })

  it('el formulario carga y guarda en la moneda declarada', () => {
    expect(pagina).toContain('guardarFila')
    expect(pagina).toContain('eliminarFila')
    expect(pagina).toContain('validarFila')
  })

  it('el bono compensatorio se CALCULA en pantalla, no se carga', () => {
    expect(pagina).toContain('bonoCompensatorio')
    expect(pagina).toContain('Bono compensatorio (calculado, no se guarda)')
  })
})

describe('tabulador-paquetes.sql · el bloque sigue en el esquema', () => {
  it('existe la marca y la tabla con sus cifras', () => {
    const sql = bloqueSql('tabulador-paquetes.sql')
    expect(sql).toContain('create table if not exists public.tabulador_paquete')
    for (const columna of [
      'salario_bs',
      'bono_traslado_bs',
      'bono_asistencia_usd',
      'cestatickets_usd',
      'paquete_aprobado_usd'
    ]) {
      expect(sql).toContain(columna)
    }
    // El compensatorio NO se guarda: el bloque lo baja de la tabla.
    expect(sql).toContain('drop column if exists bono_compensatorio_usd')
    // Cerradura de bonos, como el resto de la compensación.
    expect(sql).toContain('public.puede_bonos()')
    expect(sql).toContain('enable row level security')
    expect(sql).toMatch(/revoke all on public\.tabulador_paquete from anon/)
  })
})
