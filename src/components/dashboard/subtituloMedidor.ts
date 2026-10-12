import type { MedidorModulo } from '../../lib/data/indicadores'

/**
 * El rótulo debajo del reloj de cumplimiento: qué entró al promedio.
 *
 * Vive en su propio archivo y no en `MedidorModulo.tsx` porque no es un
 * componente, y mezclarlos rompe el fast refresh.
 *
 * Existe como función y no como texto inline porque lo escriben dos pantallas
 * —el dashboard y el del módulo— y se habían quedado con dos ternarios casi
 * iguales y textos distintos para la misma pieza.
 *
 * No puede decir "sucursales" si lo que midió el módulo fue un departamento,
 * así que los dos se enumeran por separado.
 *
 * `sinUnidades` es el texto de cuando no entró nada, que sí cambia: en el
 * dashboard el módulo puede estar simplemente sin sucursales configuradas, y
 * en el del módulo lo que no hay es nada en el rango.
 */
export function subtituloMedidor(
  m: Pick<MedidorModulo, 'sucursales' | 'departamentos' | 'sinDatos'>,
  sinUnidades = 'Sin sucursales activas'
): string {
  const partes: string[] = []
  if (m.sucursales) partes.push(`${m.sucursales} de ${m.sucursales + m.sinDatos} sucursales`)
  else if (m.sinDatos) partes.push(`${m.sinDatos} sucursales sin evaluación`)
  if (m.departamentos) partes.push(m.departamentos === 1 ? '1 departamento' : `${m.departamentos} departamentos`)
  return partes.length ? partes.join(' · ') : sinUnidades
}
