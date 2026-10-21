const R = 19
const C = 2 * Math.PI * R

export function AnilloInactividad({ restante, totalSeg = 30 }: { restante: number; totalSeg?: number }) {
  const seg = Math.ceil(restante * totalSeg)
  return (
    <svg className="anillo" width="44" height="44" viewBox="0 0 44 44" role="timer" aria-label={`Cierre automático en ${seg} segundos`}>
      <circle cx="22" cy="22" r={R} fill="none" stroke="var(--linea)" strokeWidth="3" />
      <circle
        cx="22"
        cy="22"
        r={R}
        fill="none"
        stroke={restante < 0.25 ? '#dc2626' : 'var(--tinta)'}
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={C}
        strokeDashoffset={C * (1 - restante)}
        transform="rotate(-90 22 22)"
      />
      <text x="22" y="26" textAnchor="middle" fontSize="12" fontFamily="var(--mono)" fill="var(--tinta)">
        {seg}
      </text>
    </svg>
  )
}
