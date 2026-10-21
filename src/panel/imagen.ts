// Reduce la foto antes de mandarla (como la app vieja): ≤ 800 px, JPEG 0.6; si sigue pesada, 70 % y 0.5.
// Devuelve el base64 sin el prefijo data:.
export function reducirImagen(archivo: File): Promise<string> {
  return new Promise((resolver, rechazar) => {
    const url = URL.createObjectURL(archivo)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      let w = img.width
      let h = img.height
      if (w > 800) [w, h] = [800, Math.round((h * 800) / w)]
      if (h > 800) [w, h] = [Math.round((w * 800) / h), 800]
      const canvas = document.createElement('canvas')
      const dibujar = (ancho: number, alto: number, calidad: number) => {
        canvas.width = ancho
        canvas.height = alto
        const ctx = canvas.getContext('2d')!
        ctx.fillStyle = '#fff'
        ctx.fillRect(0, 0, ancho, alto)
        ctx.drawImage(img, 0, 0, ancho, alto)
        return canvas.toDataURL('image/jpeg', calidad)
      }
      let datos = dibujar(w, h, 0.6)
      if (datos.length > 500_000) datos = dibujar(Math.round(w * 0.7), Math.round(h * 0.7), 0.5)
      resolver(datos.split(',')[1])
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      rechazar(new Error('No se pudo leer la imagen.'))
    }
    img.src = url
  })
}
