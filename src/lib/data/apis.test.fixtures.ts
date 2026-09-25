import type { Vehiculo } from './vehicles'
import type { ResultadoScan } from './precios'
import type { ColaboradorAPI } from './colaboradores'

export const vehiculoDePrueba: Vehiculo = {
  id: 3,
  placa: 'AA579AC',
  marca: 'renault',
  modelo: 'clio',
  color: '#FFFFFF',
  anio: null,
  capacidad: 5,
  status: 'MAINTENANCE',
  statusDisplay: 'En Mantenimiento',
  fleetType: 'EJECUTIVA',
  fleetTypeDisplay: 'Ejecutiva',
  kilometraje: 10000000,
  motivoInactividad: 'motor dañao',
  activo: true
}

export const vehiculoCrudo = {
  id: 3,
  identifier: 'AA579AC',
  brand: 'renault',
  model: 'clio',
  color: '#FFFFFF',
  year: null,
  capacity: 5,
  status: 'MAINTENANCE',
  status_display: 'En Mantenimiento',
  fleet_type: 'EJECUTIVA',
  fleet_type_display: 'Ejecutiva',
  current_mileage: 10000000,
  inactive_reason: 'motor dañao',
  is_active: true
}

export const productoDePrueba: ResultadoScan = {
  nombre: 'Aceite 1L',
  mensaje: null,
  soh: 42,
  lastSync: '2025-01-10T14:30:00Z',
  finalBase: 12990.5
}

export const colaboradorDePrueba: ColaboradorAPI = {
  nationality: 'UY',
  dni: 4231309,
  name: 'Juan',
  lastname: 'Pérez',
  role_name: 'Cajero',
  branch_name: 'Tienda Centro',
  active: true
}

export const colaboradoresDePrueba: ColaboradorAPI[] = [
  colaboradorDePrueba,
  {
    nationality: 'UY',
    dni: 5550011,
    name: 'Ana',
    lastname: 'López',
    role_name: 'Supervisora',
    branch_name: 'Tienda Centro',
    active: false
  }
]