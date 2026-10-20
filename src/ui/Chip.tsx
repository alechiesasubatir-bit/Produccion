type Variante = { clase: string; texto: string; enCurso: boolean }

const VARIANTES: Record<string, Variante> = {
  fabricando: { clase: 'fabricando', texto: 'Fabricando', enCurso: true },
  envasando: { clase: 'envasando', texto: 'Envasando', enCurso: true },
  activo: { clase: 'envasando', texto: 'Envasando', enCurso: true },
  fraccionado: { clase: 'fraccionado', texto: 'Fraccionado', enCurso: true },
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

export function Chip({ estado }: { estado: string }) {
  const v = VARIANTES[estado] ?? { clase: 'cola', texto: humanizar(estado), enCurso: false }
  const clases = ['chip', `chip-${v.clase}`, v.enCurso ? 'en-curso' : ''].filter(Boolean).join(' ')
  return (
    <span className={clases} data-estado={estado}>
      {v.clase === 'libre' ? null : <i aria-hidden="true" />}
      {v.texto}
    </span>
  )
}
