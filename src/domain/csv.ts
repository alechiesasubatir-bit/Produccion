// CSV para Excel en español: BOM UTF-8, separador ";" y decimales con coma.
export type ColumnaCSV<T> = { titulo: string; valor: (f: T) => string | number | null | undefined }

function celda(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return ''
  const s = typeof v === 'number' ? String(v).replace('.', ',') : v
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function aCSV<T>(columnas: ColumnaCSV<T>[], filas: T[]): string {
  const lineas = [columnas.map((c) => celda(c.titulo)).join(';'), ...filas.map((f) => columnas.map((c) => celda(c.valor(f))).join(';'))]
  return '﻿' + lineas.join('\r\n')
}

export function descargarCSV(nombre: string, contenido: string): void {
  const url = URL.createObjectURL(new Blob([contenido], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = nombre
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
