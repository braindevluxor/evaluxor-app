import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MedidorCumplimiento, LeyendaEtapas } from './MedidorCumplimiento'

describe('MedidorCumplimiento', () => {
  it('renderiza el arco por etapas, aguja y valor para un puntaje en riesgo', () => {
    const html = renderToStaticMarkup(<MedidorCumplimiento valor={72.4} />)
    expect(html).toContain('72.4%')
    // Las tres etapas del arco están presentes.
    expect(html).toContain('#dc2626') // no cumple
    expect(html).toContain('#d97706') // en riesgo
    expect(html).toContain('#16a34a') // cumple
    // La aguja (polygon) se dibuja solo con valor definido.
    expect(html).toContain('<polygon')
    // Animación: en SSR la aguja queda rotada hasta el valor (72.4 → 60.48°).
    expect(html).toContain('transform:rotate(')
    // Escala con etiquetas.
    expect(html).toContain('>0<')
    expect(html).toContain('>100<')
    expect(html).not.toContain('—')
    expect(html).toContain('aria-label="Cumplimiento global: 72.4%"')
  })

  it('colorea el valor según la etapa alcanzada', () => {
    const ambar = renderToStaticMarkup(<MedidorCumplimiento valor={65} />)
    expect(ambar).toContain('fill="#d97706"')
    const verde = renderToStaticMarkup(<MedidorCumplimiento valor={92.5} />)
    expect(verde).toContain('92.5%')
    const rojo = renderToStaticMarkup(<MedidorCumplimiento valor={45} />)
    expect(rojo).toContain('fill="#dc2626"')
  })

  it('sin datos muestra el valor en guion y sin aguja', () => {
    const html = renderToStaticMarkup(<MedidorCumplimiento valor={null} />)
    expect(html).toContain('—')
    expect(html).toContain('aria-label="Cumplimiento global: sin datos"')
    expect(html).not.toContain('<polygon')
  })

  it('LeyendaEtapas lista las tres etapas', () => {
    const html = renderToStaticMarkup(<LeyendaEtapas />)
    expect(html).toContain('No cumple')
    expect(html).toContain('En riesgo')
    expect(html).toContain('Cumple')
  })
})