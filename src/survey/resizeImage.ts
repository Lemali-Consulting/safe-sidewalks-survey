export interface ResizeOptions {
  maxDimension: number
  quality: number
}

export interface Dimensions {
  width: number
  height: number
}

export function computeResizedDimensions(
  width: number,
  height: number,
  maxDimension: number,
): Dimensions {
  const longest = Math.max(width, height)
  if (longest <= maxDimension) return { width, height }
  const scale = maxDimension / longest
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  }
}

export async function resizeImageFile(
  file: File,
  { maxDimension, quality }: ResizeOptions,
): Promise<File> {
  const bitmap = await createImageBitmap(file)
  try {
    const { width, height } = computeResizedDimensions(
      bitmap.width,
      bitmap.height,
      maxDimension,
    )

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height

    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2D canvas context unavailable')
    ctx.drawImage(bitmap, 0, 0, width, height)

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), 'image/jpeg', quality)
    })
    if (!blob) throw new Error('canvas.toBlob returned null')

    const baseName = file.name.replace(/\.[^.]+$/, '')
    return new File([blob], `${baseName}.jpg`, {
      type: 'image/jpeg',
      lastModified: Date.now(),
    })
  } finally {
    bitmap.close?.()
  }
}
