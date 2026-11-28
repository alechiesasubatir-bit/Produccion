import { useCambio } from './useCambio'

type Variante = { clase: string; texto: string; enCurso: boolean }

const VARIANTES: Record<string, Variante> = {
  fabricando: { clase: 'fabricando', texto: 'Fabricando', enCurso: true },
  envasando: { clase: 'envasando', texto: 'Envasando', enCurso: true },
  activo: { clase: 'envasando', texto: 'Envasando', enCurso: true },
  fraccionado: { clase: 'fraccionado', texto: 'Fraccionado', enCurso: true },
  en_control: { clase: 'control', texto: 'En control', enCurso: false },
  pausada: { clase: 'pausado', texto: 'Pausado', enCurso: false },
  pausado: { clase: 'pausado', texto: 'Pausado', enCurso: false },
  env_pausado: { clase: 'pausado', texto: 'Pausado', enCurso: false },
  cola: { clase: 'cola', texto: 'En cola', enCurso: false },
  cola_env: { clase: 'cola', texto: 'En cola', enCurso: false },
  finalizada: { clase: 'terminada', texto: 'Terminada', enCurso: false },
  finalizado: { clase: 'terminada', texto: 'Terminada', enCurso: false },
  libre: { clase: 'libre', texto: 'Libre', enCurso: false },
}

function humanizar(estado: string): string {
  const texto = estado.replace(/_/g, ' ')
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}

// `clave` (entidad-id de la orden): recuerda el estado aunque la tarjeta cambie de columna y se vuelva a montar.
export function Chip({ estado, clave }: { estado: string; clave?: string }) {
  const v = VARIANTES[estado] ?? { clase: 'cola', texto: humanizar(estado), enCurso: false }
  // al cambiar de estado en vivo el chip se vuelve a montar con `salto` (en la primera carga no salta)
  const cambios = useCambio(estado, clave)
  const clases = ['chip', `chip-${v.clase}`, v.enCurso ? 'en-curso' : '', cambios > 0 ? 'salto' : ''].filter(Boolean).join(' ')
  return (
    <span key={cambios} className={clases} data-estado={estado}>
      {v.clase === 'libre' ? null : <i aria-hidden="true" />}
      {v.texto}
    </span>
  )
}
