import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ConciliacionPublica, VistaConciliacion } from './ConciliacionPublica'
import type { ConciliacionPublica as Paquete } from '../../lib/data/compartir'
import type { Item, Modulo } from '../../lib/types'

function fuente(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

const ITEM: Item = {
  id: 'it-1',
  modulo_id: 'm-1',
  tipo: 'CONCILIACION',
  texto: 'Conciliación de stock por SKU',
  opciones: null,
  orden: 1,
  requerido: true,
  activo: true,
  contra_dato: 'SOH',
  created_at: '2026-10-12T10:00:00Z'
}

const MODULO: Modulo = {
  id: 'm-1',
  nombre: 'Inventario',
  descripcion: '',
  orden: 1,
  activo: true,
  created_at: '2026-10-12T10:00:00Z'
}

/** Uno que cuadra, uno que falta y uno que sobra: los tres estados de una góndola. */
function paquete(): Paquete {
  return {
    evaluacion: {
      id: 'ev-1',
      sucursal_id: 's-1',
      departamento_id: null,
      fecha: '2026-10-12',
      estado: 'ACTIVA',
      puntuacion: 80,
      comentario_general: null,
      cerrada_en: null,
      sucursal: { id: 's-1', nombre: 'Sucursal Norte' },
      departamento: null
    },
    respuestas: [
      {
        evaluacion_id: 'ev-1',
        item_id: 'it-1',
        instancia_id: null,
        respondido_por: null,
        valor: {
          productos: [
            { sku: '7591002000011', nombre: 'Aceite 1L', teorica: 10, fisica: 10, departamento: 'LIMPIEZA' },
            { sku: '7891000000001', nombre: 'Detergente', teorica: 5, fisica: 3, departamento: 'LIMPIEZA' },
            { sku: '7891000000002', nombre: 'Shampoo', teorica: 2, fisica: 5, departamento: 'BELLEZA' }
          ]
        }
      }
    ],
    items: [ITEM],
    modulos: [MODULO]
  } as unknown as Paquete
}

function pintarVista(d: Paquete = paquete()): string {
  return renderToStaticMarkup(<VistaConciliacion datos={d} ultimo={null} falla={null} />)
}

function pintarRuta(ruta: string): string {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[ruta]}>
      <Routes>
        <Route path="/compartir/:token" element={<ConciliacionPublica />} />
      </Routes>
    </MemoryRouter>
  )
}

describe('ConciliacionPublica · pantalla de invitado', () => {
  it('se abre sin sesión y sin el menú de la app', () => {
    const html = pintarRuta('/compartir/abc123')
    expect(html).toContain('Modo invitado')
    expect(html).toContain('/completo.webp')
    // Efectos no corren en SSR, así que queda en la lectura inicial: es lo esperado.
    expect(html).toContain('Cargando')
    // Sin sidebar ni barra inferior: es una página suelta, no una pantalla de la app.
    expect(html).not.toContain('<nav')
  })

  it('muestra el encabezado de la evaluación', () => {
    const html = pintarVista()
    expect(html).toContain('Sucursal Norte')
    expect(html).toContain('Conciliación de stock por SKU')
    expect(html).toContain('Inventario')
    expect(html).toContain('En vivo')
    expect(html).toContain('sólo lectura')
  })

  it('da los mismos números que la app interna', () => {
    const html = pintarVista()
    // 3 SKU escaneados, 1 que cuadra: Total conciliación = (1 / 3) × 100.
    // Sale de `totalConciliacion`, la misma función que usa el evaluador.
    expect(html).toContain('33.33%')
    expect(html).toContain('SKU agregados')
    expect(html).toContain('No Match')
    // Las tres lecturas de una góndola, agrupadas por pasillo.
    expect(html).toContain('Match')
    expect(html).toContain('Falta')
    expect(html).toContain('Sobra')
    expect(html).toContain('LIMPIEZA')
    expect(html).toContain('BELLEZA')
    expect(html).toContain('7591002000011')
    expect(html).toContain('7891000000001')
    expect(html).toContain('7891000000002')
  })

  it('pinta la pérdida acumulada con la misma banda de tres tonos', () => {
    // Los tres productos vienen sin precio base: no se puede afirmar plata, así
    // que va en ámbar y no en rojo (que implicaría un monto que no se puede
    // sostener) ni en verde (que diría "todo concilia", que es mentira).
    const html = pintarVista()
    expect(html).toContain('Pérdida acumulada')
    expect(html).toContain('SKU sin precio base')
    expect(html).toContain('Real')
    expect(html).toContain('Absoluta')
    expect(html).toContain('bg-amber-50')
  })

  it('no trae ningún control de edición, creación o borrado', () => {
    const html = pintarVista()
    // Ni siquiera deshabilitados: no existen en la pantalla.
    expect(html).not.toContain('<input')
    expect(html).not.toContain('<select')
    expect(html).not.toContain('<textarea')
    for (const prohibido of [
      'Guardar',
      'Eliminar',
      'Agregar',
      'Reportar incidencia',
      'Editar productos',
      'Descargar PDF',
      'Sincronizar'
    ]) {
      expect(html, `no debe aparecer "${prohibido}"`).not.toContain(prohibido)
    }
  })

  it('las fotos, las incidencias y el resto de la evaluación quedan fuera', () => {
    const html = pintarVista()
    // La única imagen de la pantalla es la marca.
    const imgs = [...html.matchAll(/<img[^>]*src="([^"]+)"/g)].map((m) => m[1])
    expect(imgs).toEqual(['/completo.webp'])

    const codigo = fuente('./ConciliacionPublica.tsx')
    // El bucket de evidencia es privado y firmar URLs para `anon` sería abrirlo
    // entero a cambio de un link: no se firma nada desde acá.
    expect(codigo).not.toMatch(/Fotogaleria/)
    expect(codigo).not.toMatch(/createSignedUrl/)
    expect(codigo).not.toMatch(/supabase\./)
    expect(codigo).not.toMatch(/useIncidencias/)
  })

  it('los números salen de las mismas funciones que usa la app interna', () => {
    const codigo = fuente('./ConciliacionPublica.tsx')
    // El editor de conciliación y el detalle de evaluación son las dos pantallas
    // internas que calculan esto. Si la pública llamara a otras funciones (o
    // reimplementara la cuenta), las dos podrían dar dos verdades distintas.
    const internas = [
      fuente('../../components/ItemRenderer.tsx'),
      fuente('../../pages/EvaluacionDetalle.tsx')
    ].join('\n')
    for (const fn of [
      'esMatchConciliacion',
      'totalConciliacion',
      'agruparPorDepartamento',
      'resumenPerdidaConciliacion',
      'productosParaConciliar',
      'esSinHablador',
      'formatearMontoPerdida',
      'formatearPrecioBase'
    ]) {
      expect(codigo, `la pantalla pública usa ${fn}`).toContain(fn)
      expect(internas, `la app interna usa ${fn}`).toContain(fn)
    }
    // Y no hay un cálculo paralelo del Total de conciliación.
    expect(codigo).not.toMatch(/ps\.length\s*\*\s*100/)
  })

  it('el refresco es polling, no Realtime', () => {
    const codigo = fuente('./ConciliacionPublica.tsx')
    // `postgres_changes` exige políticas `to anon` sobre la tabla de
    // respuestas, que es exactamente la apertura que no queremos hacer: el
    // único agujero del enlace sigue siendo una función.
    expect(codigo).toContain('window.setInterval')
    expect(codigo).not.toMatch(/\.channel\(|onPostgresChanges/)
  })
})
