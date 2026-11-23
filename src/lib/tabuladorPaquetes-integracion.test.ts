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
 * Las reglas de forma y de permisos tienen sus propios tests
 * (`tabuladorPaquetes-sql.test.ts`); éste mira lo que ninguno ve: que la
 * pantalla exista con SU ruta y SU menú (la misma cerradura que los
 * bonos), que el data layer sólo LEE —una cifra de sueldo no se toca desde
 * la app—, y que el generador Python apunte a las mismas tablas que el
 * esquema.
 */
describe('tabulador de paquetes · la ruta y el menú', () => {
  const app = fuente('../App.tsx')
  const consola = fuente('../components/layouts/ConsoleLayout.tsx')

  it('la ruta está adentro de la consola y pide los DOS roles de bonos', () => {
    const grupo = app.indexOf('<ConsoleLayout />')
    const ruta = app.indexOf('path="/config/bonos/tabulador"')
    expect(ruta).toBeGreaterThan(-1)
    expect(ruta).toBeGreaterThan(grupo)

    // La MISMA cerradura que /config/bonos: ruta + RLS `puede_bonos`.
    const bloque = app.slice(ruta, ruta + 400)
    expect(bloque).toContain('RequireRol')
    expect(bloque).toContain("roles={['LIDER', 'GERENTE_TH']}")
    expect(app).toContain("import('./pages/config/TabuladorPaquetes')")
  })

  it('el menú lo ofrece a los dos roles que gestionan bonos', () => {
    expect(consola).toContain("to: '/config/bonos/tabulador'")
    // Aparece en las DOS ramas de `config`: la del Líder (Gestión completa)
    // y la del Gerente de Talento Humano (sólo bonos).
    const apariciones = consola.split("to: '/config/bonos/tabulador'").length - 1
    expect(apariciones).toBe(2)
    // Y con título en la cabecera, para no llegar a una vista sin título.
    expect(consola).toContain("'/config/bonos/tabulador': {")
    expect(consola).toContain("titulo: 'Tabulador de paquetes'")
  })
})

describe('tabulador de paquetes · la pantalla y sus datos', () => {
  const pagina = fuente('../pages/config/TabuladorPaquetes.tsx')
  const datos = fuente('./data/tabuladorPaquetes.ts')

  it('todo pasa por el data layer, y el data layer sólo LEE', () => {
    expect(pagina).toContain('listarTabulador')
    expect(datos).toContain("from('bono_tabulador_paquete')")
    expect(datos).toContain("from('bono_tabulador_config')")
    // SIN escritura: el tabulador se reemplaza con el SQL del import.
    expect(datos).not.toContain('.insert(')
    expect(datos).not.toContain('.update(')
    expect(datos).not.toContain('.delete(')
    expect(datos).not.toContain('supabase.rpc(')
    // La pantalla no tiene formularios de edición: es consulta (lo único
    // que se guarda es la tasa manual, en localStorage y sin tocar la base).
    expect(pagina).not.toContain('<form')
    expect(pagina).not.toContain('onSubmit')
  })

  it('la tasa es la del BCV, con la alternativa manual en el navegador', () => {
    const tasa = fuente('../lib/tasaBcv.ts')
    // La API pública con CORS abierto: el navegador la pide directo, sin
    // proxy ni función de servidor…
    expect(tasa).toContain('ve.dolarapi.com/v1/dolares')
    // …y sólo la OFICIAL (la del BCV), nunca la paralela.
    expect(tasa).toContain("'oficial'")
    // La manual vive en localStorage: el tabulador sigue de sólo lectura
    // y el import del Excel no la pisa.
    expect(tasa).toContain('luxor_tabulador_tasa_manual')

    expect(pagina).toContain('obtenerTasaBcv')
    expect(pagina).toContain('leerTasaManual')
    expect(pagina).toContain('Volver a BCV')
    // La prioridad que muestra el chip: manual → BCV → archivo.
    expect(pagina).toContain('tasaManual ?? tasaBcv?.valor ?? tabulador?.config?.tasa_cambio')
  })

  it('la consulta trae las DOS hojas, con búsqueda, filtro y detalle', () => {
    expect(pagina).toContain('HOJAS_TABULADOR')
    expect(pagina).toContain("useState<HojaTabulador>('OFICINA')")
    expect(pagina).toContain('Buscar por cargo o código')
    expect(pagina).toContain('Todos los departamentos')
    // Orden por las cifras que muestra la tabla…
    expect(pagina).toContain("type CampoOrden = 'cargo'")
    // …y el desglose en un modal, con las etiquetas que manda el import.
    expect(pagina).toContain('<Modal')
    expect(pagina).toContain('etiquetas.get(key)')
    // El PAQUETE está en DÓLARES (así lo aprueba el Excel), y la tabla
    // principal NO lleva ni Plazas ni Salario —sólo el detalle.
    expect(pagina).toContain('Paquete aprobado (USD)')
    expect(pagina).not.toContain("texto: 'Plazas'")
    expect(pagina).not.toContain("texto: 'Salario (Bs)'")
    expect(pagina).not.toContain('Paquete aprobado (Bs)')
    // Sin nada de edición de datos: ni botón de guardar proyectos.
    expect(pagina).not.toContain('Guardar')
  })

  it('el bloque existe en el schema y el generador apunta a sus tablas', () => {
    expect(bloqueSql('bono-tabulador.sql')).toContain('bono_tabulador_paquete')
    expect(bloqueSql('bono-tabulador.sql')).toContain('puede_bonos()')
    const script = fuente('../../scripts/generar_tabulador_paquetes.py')
    expect(script).toContain('delete from public.bono_tabulador_paquete')
    expect(script).toContain('insert into public.bono_tabulador_config')
    // La hoja y las columnas propias del esquema: el script no puede
    // emitir una hoja que el check rechaza.
    expect(script).toContain('"OFICINA"')
    expect(script).toContain('"SUCURSALES"')
  })
})
