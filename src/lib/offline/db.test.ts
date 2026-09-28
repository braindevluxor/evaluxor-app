import { describe, it, expect } from 'vitest'
import { respuestasConInstancia, type DraftEval } from './db'
import { claveRespuesta } from '../pasos'

describe('respuestasConInstancia', () => {
  it('excluye respuestas fusionadas de otros evaluadores (por: otros) y conserva claves por registro', () => {
    const draft: DraftEval = {
      sucursal_id: 's1',
      evaluador_id: 'e1',
      fecha: '2026-09-27',
      comentario_general: '',
      puntuacion: null,
      respuestas: {
        [claveRespuesta('itemA')]: { valor: { selected: ['x'] } },
        [claveRespuesta('itemB', 'ins1')]: { valor: { selected: ['y'] }, por: 'yo' },
        [claveRespuesta('itemC', 'ins1')]: { valor: { selected: ['z'] }, por: 'otros' }
      },
      instancias: {},
      updated_at: 0
    }
    expect(respuestasConInstancia(draft)).toEqual([
      { item_id: 'itemA', instancia_id: null, valor: { selected: ['x'] } },
      { item_id: 'itemB', instancia_id: 'ins1', valor: { selected: ['y'] } }
    ])
  })
})