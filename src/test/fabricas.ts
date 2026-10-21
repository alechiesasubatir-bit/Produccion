// Fábricas de filas para tests (no se usan en producción).
import type { FilaHistorial } from '../domain/historial'

let n = 0
export function filaH(over: Partial<FilaHistorial> = {}): FilaHistorial {
  n += 1
  return {
    entidad: 'fabricacion',
    id: `h${n}`,
    estado: 'finalizada',
    producto: 'Lavandina',
    color: '#0284c7',
    tanque_codigo: 'T-01',
    presentacion: null,
    cantidad: null,
    litros: 1000,
    litros_equiv: null,
    lote: null,
    descripcion: null,
    operaria_1: 'E1',
    operaria_1_nombre: 'Laura Paz',
    operaria_2: null,
    operaria_2_nombre: null,
    inicio: '2026-10-21T10:00:00Z',
    fin: '2026-10-21T11:00:00Z',
    created_at: '2026-10-21T09:00:00Z',
    min_brutos: 60,
    min_pausa: 0,
    min_efectivos: 60,
    dia: '2026-10-21',
    ...over,
  }
}
