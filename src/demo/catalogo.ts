// Datos de prueba de la DEMO: tanques, productos y presentaciones como los reales; operarias ficticias.
// Nada de esto se guarda: vive en memoria del navegador.

export type TanqueDemo = { id: string; codigo: string; capacidad_l: number; orden: number }
export type ProductoDemo = { id: string; nombre: string; color: string; tipo: 'liquido' | 'denso' | 'polvo' }
export type PresentacionDemo = { id: string; nombre: string; litros_equiv: number }
export type OperariaDemo = { empleado_id: string; nombre: string; categoria: string; color_avatar: string }

const CAPACIDADES = [2000, 2000, 2000, 950, 950, 1200, 1200, 1950, 3000, 1000, 2000, 3300, 3500, 4070, 5720, 5800]

export const TANQUES: TanqueDemo[] = CAPACIDADES.map((capacidad_l, i) => ({
  id: `dt${i + 1}`,
  codigo: `T-${String(i + 1).padStart(2, '0')}`,
  capacidad_l,
  orden: i + 1,
}))

export const PRODUCTOS: ProductoDemo[] = [
  { id: 'dp1', nombre: 'Suavizante Clasico (Granel)', color: '#38bdf8', tipo: 'liquido' },
  { id: 'dp2', nombre: 'Agua Lavandina (Granel)', color: '#facc15', tipo: 'liquido' },
  { id: 'dp3', nombre: 'Perfume Textil Lavanda (Granel)', color: '#a855f7', tipo: 'liquido' },
  { id: 'dp4', nombre: 'Limpiador Pino Silvestre (Granel)', color: '#22c55e', tipo: 'liquido' },
  { id: 'dp5', nombre: 'Detergente Clasico LESS (Granel)', color: '#f59e0b', tipo: 'liquido' },
  { id: 'dp6', nombre: 'Desengrasante Universal (Granel)', color: '#ea580c', tipo: 'liquido' },
  { id: 'dp7', nombre: 'Alcohol Rectificado 70% Sanitizante (Granel)', color: '#f43f5e', tipo: 'liquido' },
  { id: 'dp8', nombre: 'Suavizante Celeste (Granel)', color: '#0ea5e9', tipo: 'liquido' },
  { id: 'dp9', nombre: 'Limpiador Floral (Granel)', color: '#16a34a', tipo: 'liquido' },
  { id: 'dp10', nombre: 'Jabon Liquido Lavarropas (Granel)', color: '#d97706', tipo: 'liquido' },
  { id: 'dp11', nombre: 'Gel Desengrasante (Granel)', color: '#c2410c', tipo: 'denso' },
  { id: 'dp12', nombre: 'Esencia Hornitos Vainilla (Granel)', color: '#c084fc', tipo: 'liquido' },
]

// Productos que se fraccionan (no salen de un tanque).
export const PRODUCTOS_FRACCIONADO: ProductoDemo[] = [
  { id: 'dp20', nombre: 'Cloro Shock x 900g', color: '#06b6d4', tipo: 'polvo' },
  { id: 'dp21', nombre: 'Pastilla Triple Accion x 1kg', color: '#0891b2', tipo: 'polvo' },
  { id: 'dp22', nombre: 'Percarbonato', color: '#eab308', tipo: 'polvo' },
]

export const PRESENTACIONES: PresentacionDemo[] = [
  { id: 'dr1', nombre: '500mL', litros_equiv: 0.5 },
  { id: 'dr2', nombre: '1L', litros_equiv: 1 },
  { id: 'dr3', nombre: '2L', litros_equiv: 2 },
  { id: 'dr4', nombre: '5L', litros_equiv: 5 },
  { id: 'dr5', nombre: '10L', litros_equiv: 10 },
  { id: 'dr6', nombre: '1kg', litros_equiv: 1 },
]

export const OPERARIAS: OperariaDemo[] = [
  { empleado_id: 'do1', nombre: 'Lucía Méndez', categoria: 'A', color_avatar: '#db2777' },
  { empleado_id: 'do2', nombre: 'Carla Pereira', categoria: 'A', color_avatar: '#0284c7' },
  { empleado_id: 'do3', nombre: 'Andrea Silva', categoria: 'A', color_avatar: '#16a34a' },
  { empleado_id: 'do4', nombre: 'Valeria Núñez', categoria: 'B', color_avatar: '#7c3aed' },
  { empleado_id: 'do5', nombre: 'Sofía Rodríguez', categoria: 'B', color_avatar: '#ea580c' },
  { empleado_id: 'do6', nombre: 'Mariana López', categoria: 'A', color_avatar: '#0d9488' },
  { empleado_id: 'do7', nombre: 'Paula Fernández', categoria: 'B', color_avatar: '#ca8a04' },
  { empleado_id: 'do8', nombre: 'Natalia Acosta', categoria: 'A', color_avatar: '#be123c' },
  { empleado_id: 'do9', nombre: 'Florencia Díaz', categoria: 'B', color_avatar: '#4f46e5' },
  { empleado_id: 'do10', nombre: 'Romina Castro', categoria: 'A', color_avatar: '#65a30d' },
  { empleado_id: 'do11', nombre: 'Camila Sosa', categoria: 'B', color_avatar: '#0891b2' },
  { empleado_id: 'do12', nombre: 'Daniela Ramos', categoria: 'A', color_avatar: '#9333ea' },
  { empleado_id: 'do13', nombre: 'Gabriela Torres', categoria: 'B', color_avatar: '#e11d48' },
  { empleado_id: 'do14', nombre: 'Jimena Vega', categoria: 'A', color_avatar: '#059669' },
]

// Ritmos de la simulación (por minuto simulado).
export const LITROS_FAB_POR_MIN = 20
export const LITROS_ENV_POR_MIN = 35
export const UNIDADES_FRAC_POR_MIN = 6
