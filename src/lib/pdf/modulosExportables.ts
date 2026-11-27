import { useEffect, useState } from 'react'
import { modulosRespondidos } from '../data/indicadores'

/**
 * Los módulos a ofrecer en el selector de qué va al PDF, para la evaluación que
 * se está por exportar.
 *
 * Va en un hook y no en el componente porque hay tres pantallas que lo necesitan
 * y solo dos lo piden al servidor: el detalle ya tiene la lista en memoria. La
 * consulta se hace al *abrir* el selector, no antes: cargar los módulos de
 * todas las evaluaciones del listado para que quizá no se descargue ninguna sería
 * tirar pedidos.
 *
 * `evaluacionId` en `null` (o vacío) = closed. Cambia de id, o se cierra y se
 * reabre, la lista se vuelve a pedir: si no, marcar un módulo en una evaluación
 * y abrir otra mostraría los módulos de la primera.
 */
export function useModulosExportables(evaluacionId: string | null): {
  modulos: { id: string; nombre: string }[]
  cargando: boolean
} {
  const [modulos, setModulos] = useState<{ id: string; nombre: string }[]>([])
  const [cargando, setCargando] = useState(false)

  useEffect(() => {
    if (!evaluacionId) {
      setModulos([])
      return
    }
    let vigente = true
    setCargando(true)
    void (async () => {
      try {
        const datos = await modulosRespondidos(evaluacionId)
        if (vigente) setModulos(datos.map((modulo) => ({ id: modulo.id, nombre: modulo.nombre })))
      } catch {
        // Si la consulta falla se deja la lista vacía y el selector avisa. No
        // pasa nada por descargar el informe entero: es lo de siempre.
        if (vigente) setModulos([])
      } finally {
        if (vigente) setCargando(false)
      }
    })()
    return () => {
      vigente = false
    }
  }, [evaluacionId])

  return { modulos, cargando }
}