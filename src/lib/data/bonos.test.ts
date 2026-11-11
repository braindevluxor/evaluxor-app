import { describe, expect, it } from 'vitest'
import {
  clasificarSucursalesParaNomina,
  etiquetaPeriodo,
  etiquetaFrescura,
  filasDeGeneracion,
  gastoDeCargo,
  leerTodo,
  montoACobrar,
  montoParaSucursal,
  nombreDeCargo,
  nominaDeTabla,
  nominaDesactualizada,
  ocupantesDeCargo,
  periodoDe,
  periodosRecientes,
  sucursalesTomadas,
  trimestreDe,
  type BonoCargo,
  type FilaNomina
} from './bonos'
import type { ColaboradorAPI } from './colaboradores'

/**
 * Bonos: la regla del prorrateo, los períodos y la generación de filas.
 *
 * Todo lo que se prueba acá es PURO: la pantalla y la base sólo guardan lo
 * que estas funciones deciden, así que si acá está bien, el resto es
 * transporte. La parte de SQL (checks, unique y RLS) está en
 * `bonos-sql.test.ts`.
 */

function cargo(parcial: Partial<BonoCargo> = {}): BonoCargo {
  return {
    id: 'b1',
    cargo: 'Cajero integral',
    alias: null,
    clave: 'cajerointegral',
    activo: true,
    monto: 100,
    nota_minima: 70,
    periodicidad: 'MENSUAL',
    // Sin área: aplica a cualquier departamento.
    departamento: null,
    // Vacío = aplica a todas las sucursales.
    sucursales: [],
    // Nadie excluido por defecto.
    excluidos: [],
    created_at: '2026-11-01T00:00:00Z',
    updated_at: '2026-11-01T00:00:00Z',
    ...parcial
  }
}

function gente(parcial: Partial<ColaboradorAPI> & { name: string; dni: number }): ColaboradorAPI {
  return { lastname: 'Pérez', role_name: 'Cajero integral', active: true, nationality: 'V', ...parcial }
}

describe('montoACobrar · el prorrateo desde el umbral', () => {
  it('sin nota no se paga nada: no se inventa un cobro', () => {
    expect(montoACobrar(100, null, 70)).toBe(0)
  })

  it('una nota por debajo del umbral no paga nada (69 con umbral 70)', () => {
    expect(montoACobrar(100, 69, 70)).toBe(0)
    expect(montoACobrar(100, 0, 70)).toBe(0)
  })

  it('desde el umbral se paga el porcentaje obtenido', () => {
    // En el umbral exacto: 70% del monto.
    expect(montoACobrar(100, 70, 70)).toBe(70)
    expect(montoACobrar(200, 70, 70)).toBe(140)
    expect(montoACobrar(100, 90, 70)).toBe(90)
    expect(montoACobrar(100, 100, 70)).toBe(100)
  })

  it('el umbral lo define el cargo: con umbral 80, una nota 75 no cobra', () => {
    expect(montoACobrar(100, 75, 80)).toBe(0)
    expect(montoACobrar(100, 80, 80)).toBe(80)
  })

  it('el monto queda redondeado a dos decimales: es plata, no un puntaje', () => {
    // 33.33 × 85% = 28.3305 → 28.33
    expect(montoACobrar(33.33, 85, 70)).toBe(28.33)
  })
})

describe('montoParaSucursal · el alcance y el monto de cada sucursal', () => {
  it('sin sucursales marcadas aplica a TODAS con el monto base', () => {
    const cfg = cargo({ monto: 100 })
    expect(montoParaSucursal(cfg, 's1')).toBe(100)
    expect(montoParaSucursal(cfg, 's99')).toBe(100)
  })

  it('con alcance, sólo las del conjunto: las demás no se pagan', () => {
    const cfg = cargo({ sucursales: [{ sucursal_id: 's1', monto: null }] })
    expect(montoParaSucursal(cfg, 's1')).toBe(100)
    expect(montoParaSucursal(cfg, 's2')).toBeNull()
  })

  it('cada sucursal del conjunto puede traer su propio monto', () => {
    const cfg = cargo({
      monto: 100,
      sucursales: [
        { sucursal_id: 's1', monto: 150 },
        // NULL = sigue el monto base del cargo.
        { sucursal_id: 's2', monto: null }
      ]
    })
    expect(montoParaSucursal(cfg, 's1')).toBe(150)
    expect(montoParaSucursal(cfg, 's2')).toBe(100)
  })
})

describe('sucursalesTomadas · el mismo cargo no se registra dos veces en una sucursal', () => {
  const existentes: BonoCargo[] = [
    cargo({
      id: 'b1',
      clave: 'cajero',
      sucursales: [
        { sucursal_id: 's1', monto: null },
        { sucursal_id: 's2', monto: null }
      ]
    }),
    cargo({ id: 'b2', clave: 'chofer', sucursales: [] })
  ]

  it('dos filas del mismo cargo no pueden compartir sucursal', () => {
    const r = sucursalesTomadas(existentes, 'cajero', [
      { sucursal_id: 's2', monto: null },
      { sucursal_id: 's3', monto: null }
    ])
    expect(r.todas).toBe(false)
    expect(r.ids).toEqual(['s2'])
  })

  it('un conjunto que no se cruza con el existente no tiene conflicto', () => {
    expect(sucursalesTomadas(existentes, 'cajero', [{ sucursal_id: 's9', monto: null }])).toEqual({
      todas: false,
      ids: []
    })
  })

  it('cargos distintos no se miran entre sí: cada uno tiene sus sucursales', () => {
    expect(sucursalesTomadas(existentes, 'vendedor', [{ sucursal_id: 's1', monto: null }])).toEqual({
      todas: false,
      ids: []
    })
  })

  it('una fila existente «todas» choca con cualquier conjunto del mismo cargo', () => {
    expect(sucursalesTomadas(existentes, 'chofer', [{ sucursal_id: 's5', monto: null }]).todas).toBe(true)
  })

  it('pedir «todas» choca si ya existe otra fila del mismo cargo con sucursales', () => {
    expect(sucursalesTomadas(existentes, 'cajero', []).todas).toBe(true)
    // Incluido el caso de dos «todas»: es el mismo cargo pagado en todos lados.
    expect(sucursalesTomadas(existentes, 'chofer', []).todas).toBe(true)
  })

  it('al editar, la propia fila no se mira: guardar no choque contra sí misma', () => {
    const yo = cargo({
      id: 'b1',
      clave: 'cajero',
      sucursales: [{ sucursal_id: 's1', monto: null }]
    })
    expect(sucursalesTomadas([yo], 'cajero', [{ sucursal_id: 's1', monto: null }], 'b1')).toEqual({
      todas: false,
      ids: []
    })
  })

  it('acumula los conflictos de más de una fila existente', () => {
    const otras = [
      cargo({ id: 'c1', clave: 'cajero', sucursales: [{ sucursal_id: 's1', monto: null }] }),
      cargo({ id: 'c2', clave: 'cajero', sucursales: [{ sucursal_id: 's2', monto: null }] })
    ]
    const r = sucursalesTomadas(otras, 'cajero', [
      { sucursal_id: 's1', monto: null },
      { sucursal_id: 's2', monto: null }
    ])
    expect([...r.ids].sort()).toEqual(['s1', 's2'])
    expect(r.todas).toBe(false)
  })

  it('el mismo cargo en DEPARTAMENTOS distintos no se pisa, ni en la misma sucursal', () => {
    const compras = cargo({
      id: 'd1',
      clave: 'comprador',
      departamento: 'Compras',
      sucursales: [{ sucursal_id: 's1', monto: null }]
    })
    // Mismo cargo, misma sucursal, área distinta: las DOS conviven.
    expect(
      sucursalesTomadas([compras], 'comprador', [{ sucursal_id: 's1', monto: null }], undefined, 'Servicios Generales')
    ).toEqual({ todas: false, ids: [] })
  })

  it('el MISMO departamento sí se pisa, y también si alguna fila no tiene área', () => {
    const compras = cargo({
      id: 'd1',
      clave: 'comprador',
      departamento: 'Compras',
      sucursales: [{ sucursal_id: 's1', monto: null }]
    })
    // Misma área y misma sucursal → choca.
    expect(
      sucursalesTomadas([compras], 'comprador', [{ sucursal_id: 's1', monto: null }], undefined, 'COMPRAS').ids
    ).toEqual(['s1'])
    // Sin área en la fila que se quiere crear («todas las áreas») → choca.
    expect(sucursalesTomadas([compras], 'comprador', [{ sucursal_id: 's1', monto: null }], undefined, null).ids).toEqual(
      ['s1']
    )
    // Y al revés: una fila SIN área existente se pisa con cualquier área.
    const general = cargo({
      id: 'g1',
      clave: 'comprador',
      departamento: null,
      sucursales: [{ sucursal_id: 's1', monto: null }]
    })
    expect(
      sucursalesTomadas([general], 'comprador', [{ sucursal_id: 's1', monto: null }], undefined, 'Compras').ids
    ).toEqual(['s1'])
  })
})

describe('clasificarSucursalesParaNomina · por qué una tienda queda fuera', () => {
  it('una activa con ID se puede pedir, y el branch sale del branch_id primero', () => {
    const r = clasificarSucursalesParaNomina([
      // `branch_id` manda: el shop_id es el Nº tienda para escanear productos
      // y, cuando difiere, devuelve la nómina de otra tienda.
      { id: 's1', nombre: 'El Bosque', shop_id: '13', branch_id: '12', activa: true },
      { id: 's2', nombre: 'Guacara', shop_id: '4', branch_id: '13', activa: true },
      { id: 's3', nombre: 'Sin branch, sólo shop', shop_id: '7', branch_id: null, activa: true }
    ])
    expect(r.pedir.map((p) => [p.nombre, p.branch])).toEqual([
      ['El Bosque', '12'],
      ['Guacara', '13'],
      ['Sin branch, sólo shop', '7']
    ])
    expect(r.sinId).toEqual([])
    expect(r.inactivas).toEqual([])
  })

  it('una activa SIN ID se queda en sinId, con su nombre y en orden estable', () => {
    const r = clasificarSucursalesParaNomina([
      { id: 's1', nombre: 'San Diego', shop_id: null, branch_id: null, activa: true },
      { id: 's2', nombre: 'Circulo Militar', shop_id: '   ', branch_id: null, activa: true }
    ])
    expect(r.pedir).toEqual([])
    expect(r.sinId).toEqual(['Circulo Militar', 'San Diego'])
  })

  it('una inactiva se queda en inactivas aunque tenga ID', () => {
    const r = clasificarSucursalesParaNomina([
      { id: 's1', nombre: 'Guacara', shop_id: '7', branch_id: null, activa: false },
      { id: 's2', nombre: 'El Bosque', shop_id: '12', branch_id: null, activa: true }
    ])
    expect(r.inactivas).toEqual(['Guacara'])
    expect(r.pedir.map((p) => p.nombre)).toEqual(['El Bosque'])
  })

  it('sin el campo `activa` se trata como activa: la ausencia no es una baja', () => {
    const r = clasificarSucursalesParaNomina([{ id: 's1', nombre: 'El Bosque', shop_id: '12', branch_id: null }])
    expect(r.pedir).toHaveLength(1)
    expect(r.inactivas).toEqual([])
  })
})

describe('nominaDeTabla · la tabla espejo con la misma forma que la API', () => {
  const filas: FilaNomina[] = [
    {
      sucursal_id: 's1',
      nacionalidad: 'V',
      dni: 111,
      datos: { name: 'Ana', lastname: 'Pérez', role_name: 'Subgerente', active: true, department_name: 'Operaciones' },
      actualizado_en: '2026-11-11T05:00:00.000Z'
    },
    {
      sucursal_id: 's1',
      nacionalidad: 'V',
      dni: 222,
      datos: { name: 'Beto', lastname: 'Gómez', role_name: 'Cajero', active: false },
      actualizado_en: '2026-11-11T05:00:00.000Z'
    },
    {
      sucursal_id: 's2',
      nacionalidad: 'E',
      dni: 333,
      datos: { name: 'Caro', lastname: 'Díaz', role_name: 'Subgerente' },
      actualizado_en: '2026-11-11T05:00:00.000Z'
    }
  ]

  it('agrupa por sucursal y conserva el registro crudo', () => {
    const porSucursal = nominaDeTabla(filas)
    expect([...porSucursal.keys()].sort()).toEqual(['s1', 's2'])
    expect(porSucursal.get('s1')).toHaveLength(2)
    expect(porSucursal.get('s1')?.[0].role_name).toBe('Subgerente')
    expect(porSucursal.get('s1')?.[1].active).toBe(false)
  })

  it('la identidad de la fila manda sobre lo que traiga el JSON', () => {
    const porSucursal = nominaDeTabla([
      { ...filas[0], nacionalidad: 'E', dni: 999, datos: { name: 'Ana', dni: 111 } }
    ])
    expect(porSucursal.get('s1')?.[0]).toMatchObject({ nationality: 'E', dni: 999 })
  })

  it('sin filas no hay nómina: la app cae a la API en vivo', () => {
    expect(nominaDeTabla([]).size).toBe(0)
  })
})

describe('frescura de la nómina espejo', () => {
  it('la etiqueta se lee en minutos, horas y días', () => {
    const ahora = new Date('2026-11-11T12:00:00Z')
    expect(etiquetaFrescura(null, ahora)).toBe('sin actualizar')
    expect(etiquetaFrescura('2026-11-11T11:30:00Z', ahora)).toBe('hace 30 min')
    expect(etiquetaFrescura('2026-11-11T05:00:00Z', ahora)).toBe('hace 7 h')
    expect(etiquetaFrescura('2026-11-10T05:00:00Z', ahora)).toBe('hace 1 día')
    expect(etiquetaFrescura('2026-11-08T05:00:00Z', ahora)).toBe('hace 3 días')
  })

  it('pasadas 36 horas la foto se considera vieja (el cron corre a las 05:00)', () => {
    const ahora = new Date('2026-11-11T12:00:00Z')
    expect(nominaDesactualizada(null, ahora)).toBe(true)
    // Hace 7 h: corrió esta madrugada.
    expect(nominaDesactualizada('2026-11-11T05:00:00Z', ahora)).toBe(false)
    // Hace 31 h: no corrió ayer, pero todavía se usa (sólo avisa).
    expect(nominaDesactualizada('2026-11-10T05:00:00Z', ahora)).toBe(false)
    // Hace 48 h: se pasó el umbral.
    expect(nominaDesactualizada('2026-11-09T12:00:00Z', ahora)).toBe(true)
  })
})

describe('gastoDeCargo · ocupantes × monto = gasto total del cargo', () => {
  // Nómina de dos sucursales: en s1 hay dos cajeros activos (uno escrito
  // «Cajera Integral», que es el mismo puesto), un chofer y un cajero
  // INACTIVO que no cuenta; en s2 hay un cajero.
  const nomina = new Map([
    [
      's1',
      [
        gente({ name: 'Ana', dni: 1, role_name: 'Cajero integral' }),
        gente({ name: 'Beto', dni: 2, role_name: 'Cajera Integral' }),
        gente({ name: 'Caro', dni: 3, role_name: 'Chofer' }),
        gente({ name: 'Dana', dni: 4, role_name: 'Cajero integral', active: false })
      ]
    ],
    ['s2', [gente({ name: 'Ema', dni: 5, role_name: 'Cajero integral' })]]
  ])

  it('multiplica el monto por la cantidad de ocupantes de cada sucursal', () => {
    // s1: 2 × 100 = 200 · s2: 1 × 100 = 100 → 3 ocupantes y 300 de gasto.
    expect(gastoDeCargo(cargo({ monto: 100 }), nomina)).toEqual({ ocupantes: 3, gasto: 300 })
  })

  it('respeta el monto propio de cada sucursal del alcance', () => {
    const cfg = cargo({
      monto: 100,
      sucursales: [
        { sucursal_id: 's1', monto: 150 },
        { sucursal_id: 's2', monto: null }
      ]
    })
    // s1: 2 × 150 = 300 · s2: 1 × 100 = 100.
    expect(gastoDeCargo(cfg, nomina)).toEqual({ ocupantes: 3, gasto: 400 })
  })

  it('una sucursal fuera del alcance no aporta ocupantes ni gasto', () => {
    const cfg = cargo({ sucursales: [{ sucursal_id: 's2', monto: null }] })
    expect(gastoDeCargo(cfg, nomina)).toEqual({ ocupantes: 1, gasto: 100 })
  })

  it('sin nómina no hay gasto que proyectar: no se inventan ocupantes', () => {
    expect(gastoDeCargo(cargo(), new Map())).toEqual({ ocupantes: 0, gasto: 0 })
  })

  it('el gasto queda redondeado a dos decimales: es plata, no una cuenta', () => {
    const tres = new Map([
      [
        's1',
        [gente({ name: 'Ana', dni: 1 }), gente({ name: 'Beto', dni: 2 }), gente({ name: 'Caro', dni: 3 })]
      ]
    ])
    // 0.1 × 3 = 0.30000000000000004 en coma flotante.
    expect(gastoDeCargo(cargo({ monto: 0.1 }), tres)).toEqual({ ocupantes: 3, gasto: 0.3 })
  })
})

describe('ocupantesDeCargo · quiénes son, con cruce exacto y una vez por persona', () => {
  it('«Gerente de mercado» no alcanza a cualquier Gerente', () => {
    const nomina = new Map([
      [
        's1',
        [
          gente({ name: 'Ana', dni: 1, role_name: 'Gerente de Mercado' }),
          // El peligro del cruce difuso: «Gerente» está contenido en el cargo
          // configurado, y «Gerente de Mercado Regional» lo contiene a él.
          gente({ name: 'Beto', dni: 2, role_name: 'Gerente' }),
          gente({ name: 'Caro', dni: 3, role_name: 'Gerente de Mercado Regional' }),
          // El mismo puesto con otras mayúsculas: sí cuenta.
          gente({ name: 'Dana', dni: 4, role_name: 'GERENTE DE MERCADO' }),
          // Cargo exacto pero INACTIVO: no cuenta.
          gente({ name: 'Ema', dni: 5, role_name: 'Gerente de Mercado', active: false })
        ]
      ]
    ])
    const cfg = cargo({ cargo: 'Gerente de mercado', clave: 'gerentedemercad' })
    expect(ocupantesDeCargo(cfg, nomina).map((o) => o.dni)).toEqual([1, 4])
  })

  it('una persona en la nómina de DOS sucursales se cuenta y se paga una sola vez', () => {
    const nomina = new Map([
      ['s1', [gente({ name: 'Ana', dni: 1 })]],
      ['s2', [gente({ name: 'Ana', dni: 1 })]]
    ])
    const cfg = cargo({ monto: 100 })
    expect(ocupantesDeCargo(cfg, nomina)).toHaveLength(1)
    expect(gastoDeCargo(cfg, nomina)).toEqual({ ocupantes: 1, gasto: 100 })
    // Y la generación deja UNA fila, en la primera sucursal en orden de id.
    const filas = filasDeGeneracion([cfg], nomina, '2026-11')
    expect(filas).toHaveLength(1)
    expect(filas[0].sucursal_id).toBe('s1')
  })

  it('el detalle trae el cargo de la nómina y el monto de SU sucursal', () => {
    const nomina = new Map([['s2', [gente({ name: 'Ana', dni: 7, role_name: 'Cajera Integral' })]]])
    const cfg = cargo({ monto: 100, sucursales: [{ sucursal_id: 's2', monto: 150 }] })
    expect(ocupantesDeCargo(cfg, nomina)).toEqual([
      {
        sucursal_id: 's2',
        nacionalidad: 'V',
        dni: 7,
        nombre: 'Ana Pérez',
        cargo_nomina: 'Cajera Integral',
        departamento_nomina: '',
        monto: 150,
        excluido: false
      }
    ])
  })

  it('una sucursal fuera del alcance no aporta gente aunque tengan el cargo', () => {
    const nomina = new Map([
      ['s1', [gente({ name: 'Ana', dni: 1 })]],
      ['s2', [gente({ name: 'Beto', dni: 2 })]]
    ])
    const cfg = cargo({ sucursales: [{ sucursal_id: 's2', monto: null }] })
    expect(ocupantesDeCargo(cfg, nomina).map((o) => o.dni)).toEqual([2])
  })

  it('el departamento separa cargos IGUALES: Compras no se junta con Servicios Generales', () => {
    const nomina = new Map([
      [
        's1',
        [
          gente({ name: 'Ana', dni: 1, role_name: 'Comprador/a', department_name: 'Compras' }),
          gente({ name: 'Beto', dni: 2, role_name: 'Comprador/a', department_name: 'Servicios Generales' }),
          gente({ name: 'Caro', dni: 3, role_name: 'Comprador/a' })
        ]
      ]
    ])
    const compras = cargo({ cargo: 'Comprador/a', departamento: 'Compras' })
    expect(ocupantesDeCargo(compras, nomina).map((o) => o.dni)).toEqual([1])
    // Sin área acotada siguen entrando los tres (compatibilidad hacia atrás).
    expect(ocupantesDeCargo(cargo({ cargo: 'Comprador/a' }), nomina).map((o) => o.dni)).toEqual([1, 2, 3])
    // Y la generación respeta el área y congela el departamento en la fila.
    const filas = filasDeGeneracion([compras], nomina, '2026-11')
    expect(filas.map((f) => f.dni)).toEqual([1])
    expect(filas[0].departamento).toBe('Compras')
  })

  it('el de «Nuevo ingreso» cuenta y se genera su fila, aunque `active` venga en false', () => {
    const nomina = new Map([
      [
        's1',
        [
          gente({
            name: 'Ana',
            dni: 1,
            role_name: 'Comprador/a',
            status: 'Nuevo ingreso',
            active: false
          })
        ]
      ]
    ])
    const cfg = cargo({ cargo: 'Comprador/a' })
    const lista = ocupantesDeCargo(cfg, nomina)
    expect(lista.map((o) => o.dni)).toEqual([1])
    expect(gastoDeCargo(cfg, nomina)).toEqual({ ocupantes: 1, gasto: 100 })
    expect(filasDeGeneracion([cfg], nomina, '2026-11').map((f) => f.dni)).toEqual([1])
  })

  it('y el retirado sigue fuera, aunque en la nómina le quede `active: true`', () => {
    const nomina = new Map([
      ['s1', [gente({ name: 'Beto', dni: 2, role_name: 'Comprador/a', status: 'Retirado', active: true })]]
    ])
    expect(ocupantesDeCargo(cargo({ cargo: 'Comprador/a' }), nomina)).toEqual([])
  })
})

describe('nombreDeCargo · el nombre con el que se muestra', () => {
  it('el alias manda, pero si no hay se muestra el cargo tal cual', () => {
    expect(nombreDeCargo({ cargo: 'Gerente de mercado', alias: 'Gerente de mercado (Tienda tipo A)' })).toBe(
      'Gerente de mercado (Tienda tipo A)'
    )
    expect(nombreDeCargo({ cargo: 'Gerente de mercado', alias: null })).toBe('Gerente de mercado')
    // Un alias en blanco no tapa al cargo.
    expect(nombreDeCargo({ cargo: 'Gerente de mercado', alias: '   ' })).toBe('Gerente de mercado')
    expect(nombreDeCargo({ cargo: 'Gerente de mercado' })).toBe('Gerente de mercado')
  })

  it('el alias es sólo de exhibición: el cruce con la nómina sigue usando `cargo`', () => {
    const conAlias = cargo({ cargo: 'Gerente de mercado', alias: 'Gerente de mercado (Tienda tipo A)' })
    const nomina = new Map([
      ['s1', [gente({ name: 'Ana', dni: 1, role_name: 'Gerente de Mercado' })]]
    ])
    // Si el alias se usara para comparar, no encontraría a nadie.
    expect(ocupantesDeCargo(conAlias, nomina).map((o) => o.dni)).toEqual([1])
  })
})

describe('leerTodo · el API corta en 1000 filas', () => {
  const lote = (n: number, desde: number) => Array.from({ length: n }, (_, i) => desde + i)

  it('lee página tras página hasta que un lote venga corto', async () => {
    const total = 2213
    let pedidos = 0
    const filas = await leerTodo<number>((desde) => {
      pedidos += 1
      return Promise.resolve({ data: lote(Math.min(1000, total - desde), desde), error: null })
    })
    expect(filas).toHaveLength(total)
    // 1000 + 1000 + 213: tres tandas para 2.213 filas.
    expect(pedidos).toBe(3)
  })

  it('un total exacto de 1000 pide una página más, y esa viene vacía', async () => {
    let pedidos = 0
    const filas = await leerTodo<number>((desde) => {
      pedidos += 1
      return Promise.resolve({ data: desde < 1000 ? lote(1000, 0) : [], error: null })
    })
    expect(filas).toHaveLength(1000)
    expect(pedidos).toBe(2)
  })

  it('una página con error corta todo: no devuelve filas a medias', async () => {
    await expect(
      leerTodo<number>(() => Promise.resolve({ data: [1], error: { message: 'boom' } }))
    ).rejects.toThrow('boom')
  })

  it('una consulta sin filas termina en el primer pedido', async () => {
    let pedidos = 0
    const filas = await leerTodo<number>(() => {
      pedidos += 1
      return Promise.resolve({ data: [], error: null })
    })
    expect(filas).toEqual([])
    expect(pedidos).toBe(1)
  })
})

describe('excluidos · «hay 5, pero sólo 3 cobran»', () => {
  const nomina = new Map([
    [
      's1',
      [
        gente({ name: 'Ana', dni: 1 }),
        gente({ name: 'Beto', dni: 2 }),
        gente({ name: 'Caro', dni: 3 }),
        gente({ name: 'Dana', dni: 4 }),
        gente({ name: 'Ema', dni: 5 })
      ]
    ]
  ])

  it('el excluido se lista marcado, pero no cuenta en el conteo ni en el gasto', () => {
    const cfg = cargo({
      monto: 100,
      excluidos: [
        { nacionalidad: 'V', dni: 4 },
        { nacionalidad: 'V', dni: 5 }
      ]
    })
    const lista = ocupantesDeCargo(cfg, nomina)
    // Los cinco aparecen (para poder reincorporar), pero dos marcados.
    expect(lista).toHaveLength(5)
    expect(lista.filter((o) => o.excluido).map((o) => o.dni)).toEqual([4, 5])
    // El conteo y el gasto son de los que COBRAN: 3 × 100.
    expect(gastoDeCargo(cfg, nomina)).toEqual({ ocupantes: 3, gasto: 300 })
  })

  it('la generación no le arma fila a un excluido', () => {
    const cfg = cargo({ excluidos: [{ nacionalidad: 'V', dni: 2 }] })
    const filas = filasDeGeneracion([cfg], nomina, '2026-11')
    expect(filas.map((f) => f.dni)).toEqual([1, 3, 4, 5])
  })

  it('sin excluidos sigue contando a todos', () => {
    expect(gastoDeCargo(cargo(), nomina)).toEqual({ ocupantes: 5, gasto: 500 })
  })
})

describe('periodoDe · el período que le corresponde a una fecha', () => {
  it('el mensual sale del mes de la fecha, en dos dígitos', () => {
    expect(periodoDe(new Date(2026, 10, 15), 'MENSUAL')).toBe('2026-11')
    expect(periodoDe(new Date(2026, 0, 1), 'MENSUAL')).toBe('2026-01')
  })

  it('el trimestral agrupa de a tres meses, con enero en T1', () => {
    expect(periodoDe(new Date(2026, 0, 10), 'TRIMESTRAL')).toBe('2026-T1')
    expect(periodoDe(new Date(2026, 2, 31), 'TRIMESTRAL')).toBe('2026-T1')
    expect(periodoDe(new Date(2026, 3, 1), 'TRIMESTRAL')).toBe('2026-T2')
    expect(periodoDe(new Date(2026, 6, 15), 'TRIMESTRAL')).toBe('2026-T3')
    expect(periodoDe(new Date(2026, 11, 31), 'TRIMESTRAL')).toBe('2026-T4')
  })

  it('trimestreDe devuelve el número de trimestre del mes', () => {
    expect(trimestreDe(0)).toBe(1)
    expect(trimestreDe(5)).toBe(2)
    expect(trimestreDe(8)).toBe(3)
    expect(trimestreDe(11)).toBe(4)
  })
})

describe('periodosRecientes · el selector de la pantalla de pagos', () => {
  it('el mensual arranca en el mes en curso y baja de a uno', () => {
    const periodos = periodosRecientes('MENSUAL', new Date(2026, 10, 15), 4)
    expect(periodos).toEqual(['2026-11', '2026-10', '2026-09', '2026-08'])
  })

  it('el mensual cruza el cambio de año', () => {
    const periodos = periodosRecientes('MENSUAL', new Date(2026, 0, 2), 3)
    expect(periodos).toEqual(['2026-01', '2025-12', '2025-11'])
  })

  it('el trimestral baja de a tres meses, cruzando el cambio de año', () => {
    const periodos = periodosRecientes('TRIMESTRAL', new Date(2026, 5, 1), 4)
    expect(periodos).toEqual(['2026-T2', '2026-T1', '2025-T4', '2025-T3'])
  })
})

describe('etiquetaPeriodo · cómo se lee un período en pantalla', () => {
  it('el mensual se escribe con el nombre del mes', () => {
    expect(etiquetaPeriodo('2026-11')).toBe('Noviembre 2026')
    expect(etiquetaPeriodo('2026-01')).toBe('Enero 2026')
  })

  it('el trimestral se escribe con su número', () => {
    expect(etiquetaPeriodo('2026-T1')).toBe('1er trimestre 2026')
    expect(etiquetaPeriodo('2026-T2')).toBe('2º trimestre 2026')
    expect(etiquetaPeriodo('2026-T4')).toBe('4º trimestre 2026')
  })

  it('un texto que no es período se devuelve tal cual, sin inventarle mes', () => {
    expect(etiquetaPeriodo('2026-13')).toBe('2026-13')
    expect(etiquetaPeriodo('pepe')).toBe('pepe')
  })
})

describe('filasDeGeneracion · la nómina contra la configuración', () => {
  it('sólo entra el que está ACTIVO con el cargo del bono', () => {
    const filas = filasDeGeneracion(
      [cargo()],
      new Map([
        [
          's1',
          [
            gente({ name: 'Ana', dni: 1, role_name: 'Cajero integral' }),
            gente({ name: 'Beto', dni: 2, role_name: 'Chofer' }),
            gente({ name: 'Caro', dni: 3, role_name: 'Cajero integral', active: false })
          ]
        ]
      ]),
      '2026-11'
    )
    expect(filas.map((f) => f.nombre)).toEqual(['Ana Pérez'])
  })

  it('reconoce el cargo aunque la nómina lo escriba con otra terminación', () => {
    // «Cajero integral» en la configuración y «Cajera Integral» en la nómina:
    // es el mismo puesto (mismo cruce que `trabajadoresParaCargo`).
    const filas = filasDeGeneracion(
      [cargo()],
      new Map([['s1', [gente({ name: 'Dana', dni: 4, role_name: 'Cajera Integral' })]]]),
      '2026-11'
    )
    expect(filas).toHaveLength(1)
  })

  it('un cargo INACTIVO no genera filas', () => {
    const filas = filasDeGeneracion(
      [cargo({ activo: false })],
      new Map([['s1', [gente({ name: 'Ana', dni: 1 })]]]),
      '2026-11'
    )
    expect(filas).toEqual([])
  })

  it('congela monto, umbral, alias y departamento EN LA FILA: un cambio posterior no la mueve', () => {
    const filas = filasDeGeneracion(
      [
        cargo({
          monto: 150,
          nota_minima: 80,
          alias: 'Gerente de mercado (Tienda tipo A)',
          departamento: 'Operaciones'
        })
      ],
      new Map([['s1', [gente({ name: 'Ana', dni: 1, department_name: 'Operaciones' })]]]),
      '2026-T4'
    )
    expect(filas[0]).toMatchObject({
      bono_cargo_id: 'b1',
      periodo: '2026-T4',
      sucursal_id: 's1',
      cargo: 'Cajero integral',
      alias: 'Gerente de mercado (Tienda tipo A)',
      departamento: 'Operaciones',
      monto_base: 150,
      nota_minima: 80
    })
  })

  it('la misma persona no entra dos veces en el mismo período', () => {
    const filas = filasDeGeneracion(
      [cargo()],
      new Map([['s1', [gente({ name: 'Ana', dni: 1 }), gente({ name: 'Ana', dni: 1 })]]]),
      '2026-11'
    )
    expect(filas).toHaveLength(1)
  })

  it('la identidad lleva nacionalidad: el mismo DNI de otro país es otra persona', () => {
    const filas = filasDeGeneracion(
      [cargo()],
      new Map([
        [
          's1',
          [
            gente({ name: 'Ana', dni: 1, nationality: 'V' }),
            gente({ name: 'Ana', dni: 1, nationality: 'E' })
          ]
        ]
      ]),
      '2026-11'
    )
    expect(filas).toHaveLength(2)
    expect(filas.map((f) => f.nacionalidad).sort()).toEqual(['E', 'V'])
  })

  it('una sucursal sin gente de ese cargo no aporta filas', () => {
    const filas = filasDeGeneracion(
      [cargo()],
      new Map([
        ['s1', [gente({ name: 'Ana', dni: 1 })]],
        ['s2', [gente({ name: 'Beto', dni: 2, role_name: 'Chofer' })]]
      ]),
      '2026-11'
    )
    expect(filas.map((f) => f.sucursal_id)).toEqual(['s1'])
  })

  it('sin sucursales no hay filas que armar', () => {
    expect(filasDeGeneracion([cargo()], new Map(), '2026-11')).toEqual([])
  })

  it('el alcance corta la generación: sólo las sucursales marcadas', () => {
    const cfg = cargo({ sucursales: [{ sucursal_id: 's1', monto: null }] })
    const filas = filasDeGeneracion(
      [cfg],
      new Map([
        ['s1', [gente({ name: 'Ana', dni: 1 })]],
        ['s2', [gente({ name: 'Beto', dni: 2 })]]
      ]),
      '2026-11'
    )
    expect(filas.map((f) => f.sucursal_id)).toEqual(['s1'])
  })

  it('cada sucursal del conjunto congela SU monto en la fila generada', () => {
    const cfg = cargo({
      monto: 100,
      sucursales: [
        { sucursal_id: 's1', monto: 150 },
        { sucursal_id: 's2', monto: null }
      ]
    })
    const filas = filasDeGeneracion(
      [cfg],
      new Map([
        ['s1', [gente({ name: 'Ana', dni: 1 })]],
        ['s2', [gente({ name: 'Beto', dni: 2 })]]
      ]),
      '2026-11'
    )
    const montoPorSucursal = Object.fromEntries(filas.map((f) => [f.sucursal_id, f.monto_base]))
    expect(montoPorSucursal).toEqual({ s1: 150, s2: 100 })
  })

  it('aunque DOS configuraciones del mismo cargo se crucen, la persona cobra una sola vez', () => {
    // La app impide que se crucen (sucursalesTomadas), pero los datos ya
    // creados o una carga externa podrían dejarlo: la deduplicación es por
    // CARGO, así que el mismo trabajo no se paga dos veces en un período.
    const a = cargo({ id: 'b1', clave: 'cajerointegral', sucursales: [] })
    const b = cargo({ id: 'b2', clave: 'cajerointegral', sucursales: [] })
    const filas = filasDeGeneracion(
      [a, b],
      new Map([['s1', [gente({ name: 'Ana', dni: 1 })]]]),
      '2026-11'
    )
    expect(filas).toHaveLength(1)
  })
})
