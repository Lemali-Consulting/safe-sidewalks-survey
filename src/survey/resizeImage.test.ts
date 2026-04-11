import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { computeResizedDimensions, resizeImageFile } from './resizeImage'

describe('computeResizedDimensions', () => {
  it('returns the original dimensions when both axes are within the cap', () => {
    expect(computeResizedDimensions(800, 600, 1600)).toEqual({ width: 800, height: 600 })
  })

  it('scales a landscape image so the long edge equals the cap', () => {
    expect(computeResizedDimensions(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 })
  })

  it('scales a portrait image so the long edge equals the cap', () => {
    expect(computeResizedDimensions(3000, 4000, 1600)).toEqual({ width: 1200, height: 1600 })
  })

  it('rounds to whole pixels', () => {
    const { width, height } = computeResizedDimensions(4001, 3001, 1600)
    expect(Number.isInteger(width)).toBe(true)
    expect(Number.isInteger(height)).toBe(true)
  })

  it('leaves square images square', () => {
    expect(computeResizedDimensions(3000, 3000, 1600)).toEqual({ width: 1600, height: 1600 })
  })
})

describe('resizeImageFile', () => {
  const originalCreateImageBitmap = globalThis.createImageBitmap
  const originalToBlob = HTMLCanvasElement.prototype.toBlob
  const originalGetContext = HTMLCanvasElement.prototype.getContext
  let drawSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    globalThis.createImageBitmap = vi.fn(async () => ({
      width: 4000,
      height: 3000,
      close: () => {},
    })) as unknown as typeof createImageBitmap

    drawSpy = vi.fn()
    HTMLCanvasElement.prototype.getContext = function (kind: string) {
      if (kind === '2d') {
        return { drawImage: drawSpy } as unknown as CanvasRenderingContext2D
      }
      return null
    } as typeof HTMLCanvasElement.prototype.getContext

    HTMLCanvasElement.prototype.toBlob = function (
      cb: BlobCallback,
      type?: string,
    ): void {
      cb(new Blob(['resized-bytes'], { type: type ?? 'image/jpeg' }))
    }
  })

  afterEach(() => {
    globalThis.createImageBitmap = originalCreateImageBitmap
    HTMLCanvasElement.prototype.toBlob = originalToBlob
    HTMLCanvasElement.prototype.getContext = originalGetContext
  })

  it('returns a JPEG File with a .jpg name and the long edge capped at maxDimension', async () => {
    const input = new File([new Uint8Array([1, 2, 3])], 'IMG_1234.HEIC', {
      type: 'image/heic',
    })

    const out = await resizeImageFile(input, { maxDimension: 1600, quality: 0.8 })

    expect(out).toBeInstanceOf(File)
    expect(out.type).toBe('image/jpeg')
    expect(out.name).toMatch(/\.jpg$/i)
    expect(out.name).toContain('IMG_1234')

    // drawImage(source, 0, 0, width, height) — 4000x3000 → 1600x1200
    const call = drawSpy.mock.calls[0]
    expect(call[3]).toBe(1600)
    expect(call[4]).toBe(1200)
  })

  it('does not upscale images already within the cap', async () => {
    ;(globalThis.createImageBitmap as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      width: 1024,
      height: 768,
      close: () => {},
    })

    await resizeImageFile(
      new File([new Uint8Array([1])], 'small.png', { type: 'image/png' }),
      { maxDimension: 1600, quality: 0.8 },
    )

    const call = drawSpy.mock.calls[0]
    expect(call[3]).toBe(1024)
    expect(call[4]).toBe(768)
  })
})
