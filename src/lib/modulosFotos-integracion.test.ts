import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { bloqueSql } from './supabaseSql'

function fuente(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

const pagina = fuente('../pages/config/Items.tsx')
const tipos = fuente('./types.ts')
const datos = fuente('./data/catalog.ts')
const renderer = fuente('../components/ItemRenderer.tsx')

/**
 * Fotos referenciales de los puntos de un CHECKLIST: el cableado.
 *
 * Las reglas del bucket (público, escritura del Líder) tienen sus propios
 * tests (`modulosFotos-sql.test.ts`) y el pintado en la evaluación vive en
 * `ItemRenderer.test.tsx`; éste mira lo que ninguno de los dos ve: que la
 * foto se ofrezca SÓLO donde el usuario la pidió (Config → Ítems, ítem
 * CHECKLIST), que suba al bucket esperado y que la opción la lleve en su
 * jsonb hasta el guardado.
 */
describe('fotos referenciales · la config las adjunta en el CHECKLIST', () => {
  it('el editor de opciones ofrece la foto, y sólo en la rama del CHECKLIST', () => {
    // El campo vive en el tipo del punto (opcional, jsonb sin SQL nuevo)…
    expect(tipos).toContain('foto?: string | null')
    // …y se pasa en la ÚNICA rama CHECKLIST del editor…
    expect(pagina).toContain('conPuntos conRango conFoto')
    expect(pagina).toContain('Adjuntar foto')
    // …no en la lista por trabajador ni en la checklist por unidad.
    expect(pagina).not.toContain('conPuntos puntosBloqueados={autoPuntaje} conFoto')
    expect(pagina).not.toMatch(/responsables=\{responsables\} conFoto/)
  })

  it('sube a `modulos-fotos`, convertido a WebP y con nombre único', () => {
    expect(datos).toContain("const BUCKET_FOTOS_ITEM = 'modulos-fotos'")
    expect(datos).toContain('export async function subirFotoReferencial')
    expect(datos).toContain('export async function quitarFotoReferencial')
    expect(datos).toContain('convertirImagenAWebP')
    expect(datos).toContain('items/${crypto.randomUUID()}.webp')
    expect(datos).toContain('getPublicUrl')
    // Reemplazar o quitar borra el archivo anterior (la URL de otra foto
    // externa se ignora: sólo se toca lo de ESTE bucket).
    expect(datos).toContain(".split('?')[0]")
  })

  it('el guardado del CHECKLIST lleva la foto sin listarla a mano', () => {
    // La rama del CHECKLIST guarda la opción con spread (`{ ...o, … }`):
    // `foto` viaja sola hasta el jsonb de `items`.
    expect(pagina).toContain('? { ...o, responsable: undefined, responsables: rs }')
  })
})

describe('fotos referenciales · la evaluación las pinta', () => {
  it('el punto con foto muestra la referencia y la abre en el VISOR', () => {
    // El toque lanza `ModalImagen` (el visor con zoom del repo): no se abre
    // en una pestaña nueva.
    expect(renderer).toContain('ModalImagen')
    expect(renderer).toContain('aria-label={`Ampliar foto referencial: ${o.etiqueta}`}')
    expect(renderer).toContain('cursor-zoom-in')
    expect(renderer).not.toContain('target="_blank"')
    // En Config → Ítems, la miniatura usa el mismo visor.
    expect(pagina).toContain('ModalImagen')
    expect(pagina).not.toContain('target="_blank"')
  })
})

describe('fotos referenciales · el bucket', () => {
  it('el bloque existe en el schema, con su bucket público y su cerradura', () => {
    const sql = bloqueSql('modulos-fotos.sql')
    expect(sql).toContain("values ('modulos-fotos', 'modulos-fotos', true)")
    // Escribe sólo el Líder (la misma cerradura que Config → Ítems)…
    expect(sql).toContain("bucket_id = 'modulos-fotos' and public.es_lider()")
    // …y la lectura es pública: la evaluación pinta la URL directo.
    expect(sql).toContain('for select to public')
  })
})
