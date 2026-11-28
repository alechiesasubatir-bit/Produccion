import type { SecuenciaEtapas } from '../domain/etapas'

// Barra segmentada: hechas en tinta, la actual en naranja con una luz que la recorre, pendientes en gris.
export function Etapas({ etapas }: { etapas: SecuenciaEtapas }) {
  const { nombres, actual, pausada } = etapas
  return (
    <span
      className={pausada ? 'etapas pausada' : 'etapas'}
      role="img"
      aria-label={`Etapa ${actual + 1} de ${nombres.length}: ${nombres[actual]}${pausada ? ' (en pausa)' : ''}`}
    >
      {nombres.map((n, i) => (
        <i key={n} className={i < actual ? 'hecha' : i === actual ? 'actual' : undefined} />
      ))}
    </span>
  )
}
