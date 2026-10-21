// Datos insertables de cada orden (columnas con grant de insert para el panel, migración 005).
export type NuevaFabricacion = {
  tanque_id: string
  producto_id: string
  litros: number
  lote: string
  operaria_id: string | null
}
export type NuevoEnvasado = {
  fabricacion_id: string
  presentacion_id: string
  cantidad: number
  etiquetado: string
  operaria_1: string | null
  operaria_2: string | null
}
export type NuevoFraccionado = {
  tipo: string
  descripcion: string
  producto_id: string | null
  presentacion_id: string | null
  cantidad: number
  lote: string
  etiquetado: string
  operaria_id: string | null
}

type Errores<T> = Partial<Record<keyof T, string>>

const ENTERO = 'Tiene que ser un número entero mayor a 0.'
const entero = (n: number) => Number.isInteger(n) && n > 0

const litros = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))

export function validarFabricacion(
  d: NuevaFabricacion,
  ctx: { capacidad: number | null; tanqueLibre: boolean },
): Errores<NuevaFabricacion> {
  const e: Errores<NuevaFabricacion> = {}
  if (!d.tanque_id) e.tanque_id = 'Elegí un tanque.'
  else if (!ctx.tanqueLibre) e.tanque_id = 'Ese tanque no está libre.'
  if (!d.producto_id) e.producto_id = 'Elegí un producto.'
  if (!(d.litros > 0)) e.litros = 'Tiene que ser mayor a 0.'
  else if (ctx.capacidad !== null && d.litros > ctx.capacidad) e.litros = `Máximo ${litros(ctx.capacidad)} L.`
  return e
}

export function validarEnvasado(
  d: NuevoEnvasado,
  ctx: { litrosRestantes: number | null; litrosEquiv: number | null },
): { errores: Errores<NuevoEnvasado>; advertencia: string | null } {
  const e: Errores<NuevoEnvasado> = {}
  if (!d.fabricacion_id) e.fabricacion_id = 'Elegí el tanque a envasar.'
  if (!d.presentacion_id) e.presentacion_id = 'Elegí una presentación.'
  if (!entero(d.cantidad)) e.cantidad = ENTERO
  if (d.operaria_2 && d.operaria_2 === d.operaria_1) e.operaria_2 = 'Elegí otra operaria.'

  let advertencia: string | null = null
  if (entero(d.cantidad) && ctx.litrosRestantes !== null && ctx.litrosEquiv !== null) {
    const usa = d.cantidad * ctx.litrosEquiv
    if (usa > ctx.litrosRestantes) {
      advertencia = `Quedan ${litros(ctx.litrosRestantes)} L en el tanque y esta orden usa ${litros(usa)} L.`
    }
  }
  return { errores: e, advertencia }
}

export function validarFraccionado(d: NuevoFraccionado): Errores<NuevoFraccionado> {
  const e: Errores<NuevoFraccionado> = {}
  if (!d.tipo.trim()) e.tipo = 'Indicá el tipo.'
  if (!entero(d.cantidad)) e.cantidad = ENTERO
  return e
}
