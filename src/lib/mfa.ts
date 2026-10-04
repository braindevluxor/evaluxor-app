import { supabase } from './supabase'

export interface FactorTotp {
  id: string
  friendlyName: string | null
  createdAt: string
}

export async function factorsTotpActivos(): Promise<FactorTotp[]> {
  const { data, error } = await supabase.auth.mfa.listFactors()
  if (error) return []
  const all = data?.all ?? []
  return all
    .filter((f) => f.factor_type === 'totp' && f.status === 'verified')
    .map((f) => ({ id: f.id, friendlyName: f.friendly_name ?? null, createdAt: f.created_at }))
}

export async function iniciarConfigTotp(): Promise<{ factorId: string; secret: string; qr: string; uri: string }> {
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'EvaLuxor' })
  if (error) throw new Error(mensajeTotp(error.message))
  const qr = data.totp.qr_code.startsWith('data:')
    ? data.totp.qr_code
    : `data:image/svg+xml;charset=utf-8,${encodeURIComponent(data.totp.qr_code)}`
  return { factorId: data.id, secret: data.totp.secret, qr, uri: data.totp.uri }
}

export async function confirmarConfigTotp(factorId: string, code: string): Promise<void> {
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code })
  if (error) {
    throw new Error('El código no es válido. Verifica que esté sincronizado o vuelve a escanear el QR.')
  }
}

export async function desactivarTotp(code: string): Promise<void> {
  const activos = await factorsTotpActivos()
  const factor = activos[0]
  if (!factor) throw new Error('No hay verificación en dos pasos activa.')
  const { error: verr } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code })
  if (verr) throw new Error('El código no es válido o expiró.')
  const { error } = await supabase.auth.mfa.unenroll({ factorId: factor.id })
  if (error) throw new Error(mensajeTotp(error.message))
}

function mensajeTotp(msg: string): string {
  const m = (msg || '').toLowerCase()
  if (
    m.includes('not enabled') ||
    m.includes('invalid jwt') ||
    m.includes('apikey') ||
    m.includes('not found') ||
    m.includes('88 character')
  ) {
    return 'Tu proyecto de Supabase aún no tiene habilitado el TOTP. Usa la Anon Key nueva (sb_publishable_...) y verifica que MFA TOTP esté activo.'
  }
  if (m.includes('aal')) return 'Vuelve a iniciar sesión para cambiar esta opción de seguridad.'
  return msg
}