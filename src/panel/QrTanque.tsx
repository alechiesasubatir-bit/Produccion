import QRCode from 'qrcode'
import { useEffect, useState } from 'react'

// URL que abre la tablet con las tareas de ese tanque primero.
export function urlPlanta(codigo: string): string {
  return `${location.origin}${import.meta.env.BASE_URL}planta?tanque=${encodeURIComponent(codigo)}`
}

export function QrTanque({ codigo }: { codigo: string }) {
  const url = urlPlanta(codigo)
  const [svg, setSvg] = useState<string | null>(null)

  useEffect(() => {
    let vigente = true
    QRCode.toString(url, { type: 'svg', margin: 1 }).then((s) => vigente && setSvg(s))
    return () => {
      vigente = false
    }
  }, [url])

  return (
    <figure className="qr-tanque">
      {/* SVG generado localmente por la librería qrcode a partir de nuestra propia URL */}
      <div className="qr" dangerouslySetInnerHTML={svg ? { __html: svg } : undefined} aria-label={`QR del tanque ${codigo}`} role="img" />
      <figcaption>
        <strong className="mono">{codigo}</strong>
        <span className="qr-url mono">{url}</span>
      </figcaption>
      <button type="button" className="boton boton-sec no-imprimir" onClick={() => window.print()}>
        Imprimir
      </button>
    </figure>
  )
}
