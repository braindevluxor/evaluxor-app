import { beforeEach, describe, expect, it, vi } from 'vitest'
import { iniciarConfigTotp } from './mfa'

/**
 * `iniciarConfigTotp`: el alta del TOTP «EvaLuxor».
 *
 * POR QUÉ EXISTE ESTE TEST
 * ------------------------
 * El alta llamaba `enroll` a ciegas: con un factor «EvaLuxor» ya presente
 * —el QR abandonado de un intento anterior o la verificación ya activa—
 * Supabase contesta *"A factor with the friendly name ... already exists"*
 * y la pantalla se quedaba sin poder configurar nada. Ahora se mira la
 * lista antes de inscribir:
 *
 *  - sin factor → enroll de una;
 *  - SIN VERIFICAR → se borra el abandonado (su secreto no se recupera) y
 *    se inscribe uno nuevo;
 *  - VERIFICADA → no hay nada que hacer: se limpia la caché de estado y se
 *    avisa.
 */
const mfa = vi.hoisted(() => ({
  listFactors: vi.fn(),
  enroll: vi.fn(),
  unenroll: vi.fn(),
  limpiarMfaCache: vi.fn()
}))

vi.mock('./supabase', () => ({
  supabase: {
    auth: {
      mfa: {
        listFactors: mfa.listFactors,
        enroll: mfa.enroll,
        unenroll: mfa.unenroll
      }
    }
  }
}))
vi.mock('./mfaEstado', () => ({ limpiarMfaCache: mfa.limpiarMfaCache }))

const ENROLLO = {
  data: {
    id: 'f-nuevo',
    totp: {
      qr_code: 'data:text/plain;base64,QUJD',
      secret: 'SECRETO123',
      uri: 'otpauth://totp/EvaLuxor?secret=SECRETO123'
    }
  },
  error: null
}

const sinFactores = { data: { all: [], totp: [] }, error: null }

beforeEach(() => {
  mfa.listFactors.mockReset()
  mfa.enroll.mockReset()
  mfa.unenroll.mockReset()
  mfa.limpiarMfaCache.mockReset()
  mfa.enroll.mockResolvedValue(ENROLLO)
})

describe('iniciarConfigTotp · el factor EvaLuxor', () => {
  it('sin factor previo inscribe de una y devuelve el QR', async () => {
    mfa.listFactors.mockResolvedValue(sinFactores)

    const r = await iniciarConfigTotp()

    expect(mfa.unenroll).not.toHaveBeenCalled()
    expect(mfa.enroll).toHaveBeenCalledWith({ factorType: 'totp', friendlyName: 'EvaLuxor' })
    expect(r).toEqual({
      factorId: 'f-nuevo',
      secret: 'SECRETO123',
      qr: 'data:text/plain;base64,QUJD',
      uri: 'otpauth://totp/EvaLuxor?secret=SECRETO123'
    })
  })

  it('con un intento ABANDONADO (sin verificar) lo borra y vuelve a inscribir', async () => {
    mfa.listFactors.mockResolvedValue({
      data: { all: [{ id: 'f-viejo', factor_type: 'totp', friendly_name: 'EvaLuxor', status: 'unverified', created_at: 'x' }], totp: [] },
      error: null
    })
    mfa.unenroll.mockResolvedValue({ error: null })

    await iniciarConfigTotp()

    // El viejo se borra (su secreto no se recupera) y el nuevo entra.
    expect(mfa.unenroll).toHaveBeenCalledWith({ factorId: 'f-viejo' })
    expect(mfa.enroll).toHaveBeenCalledTimes(1)
  })

  it('con la verificación ya ACTIVA no vuelve a inscribir: sólo avisa', async () => {
    mfa.listFactors.mockResolvedValue({
      data: { all: [{ id: 'f-ok', factor_type: 'totp', friendly_name: 'EvaLuxor', status: 'verified', created_at: 'x' }], totp: [] },
      error: null
    })

    await expect(iniciarConfigTotp()).rejects.toThrow('ya está activa en esta cuenta')
    expect(mfa.enroll).not.toHaveBeenCalled()
    expect(mfa.unenroll).not.toHaveBeenCalled()
    // La caché de estado decía lo contrario: se limpia al descubrirlo.
    expect(mfa.limpiarMfaCache).toHaveBeenCalledTimes(1)
  })

  it('si listar falla, el error se explica con el mensaje de TOTP', async () => {
    mfa.listFactors.mockResolvedValue({ data: null, error: { message: 'MFA TOTP not enabled for this user' } })

    await expect(iniciarConfigTotp()).rejects.toThrow(/no tiene habilitado el TOTP/)
    expect(mfa.enroll).not.toHaveBeenCalled()
  })
})
