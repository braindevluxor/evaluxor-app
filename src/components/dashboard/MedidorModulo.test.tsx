import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MedidorModulo } from './MedidorModulo'

describe('MedidorModulo', () => {
  it('muestra valor, nombre, subtítulo y aro de progreso con gradiente', () => {
    const html = renderToStaticMarkup(<MedidorModulo nombre="Caja" valor={72.4} sub="3 de 5 sucursales" />)
    expect(html).toContain('72.4%')
    expect(html).toContain('Caja')
    expect(html).toContain('3 de 5 sucursales')
    // Pista de fondo + progreso con gradiente y puntas redondeadas.
    expect(html).toContain('<linearGradient')
    expect(html).toContain('stroke-linecap="round"')
    expect(html).toContain('aria-label="Caja: 72.4%"')
    // Animación: el aro usa pathLength normalizado y, en SSR (sin window),
    // queda en su estado final: dibujado hasta el valor (100 − 72.4 = 27.6).
    expect(html).toContain('pathLength="100"')
    expect(html).toContain('stroke-dasharray="100"')
    expect(html).toContain('stroke-dashoffset="27.6"')
    expect(html).toContain('transition:')
  })

  it('colorea el anillo según la etapa alcanzada', () => {
    const rojo = renderToStaticMarkup(<MedidorModulo nombre="A" valor={45} />)
    expect(rojo).toContain('#dc2626')
    const verde = renderToStaticMarkup(<MedidorModulo nombre="B" valor={92.5} />)
    expect(verde).toContain('92.5%')
    expect(verde).toContain('#16a34a')
    expect(verde).toContain('stroke-dashoffset="7.5"') // 100 − 92.5
  })

  it('con valor 0 solo dibuja la pista de fondo', () => {
    const html = renderToStaticMarkup(<MedidorModulo nombre="Caja" valor={0} />)
    expect(html).toContain('0%')
    expect(html).not.toContain('pathLength')
  })

  it('sin datos no dibuja progreso y muestra el guion', () => {
    const html = renderToStaticMarkup(<MedidorModulo nombre="Caja" valor={null} />)
    expect(html).toContain('—')
    expect(html).not.toContain('<linearGradient')
    expect(html).toContain('aria-label="Caja: sin datos"')
  })
})