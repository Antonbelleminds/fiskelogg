'use client'

import { useEffect, useRef, useState, useCallback } from 'react'

interface ImageCropPositionerProps {
  /** Bild-URL (kan vara blob: från URL.createObjectURL eller vanlig URL) */
  imageSrc: string
  /** Nuvarande position, t.ex. "50% 30%". Default "50% 50%" (centrerad). */
  value?: string | null
  /** Anropas när användaren släpper efter en dragning. */
  onChange: (position: string) => void
}

/**
 * Visar en bild i 4:3-container med object-cover.
 * Användaren kan dra bilden för att justera vilken del som syns.
 * Returnerar object-position som en sträng "X% Y%".
 */
export function ImageCropPositioner({ imageSrc, value, onChange }: ImageCropPositionerProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const [pos, setPos] = useState<{ x: number; y: number }>(() => parsePosition(value))
  const [dragging, setDragging] = useState(false)
  const [imgDims, setImgDims] = useState<{ w: number; h: number } | null>(null)
  const [containerDims, setContainerDims] = useState<{ w: number; h: number } | null>(null)

  // Uppdatera om värdet ändras utifrån
  useEffect(() => {
    setPos(parsePosition(value))
  }, [value])

  // Mät container + bild för att beräkna hur mycket draget ska flytta per pixel
  useEffect(() => {
    function measure() {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect()
        setContainerDims({ w: rect.width, h: rect.height })
      }
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  const onImgLoad = useCallback(() => {
    if (imgRef.current) {
      setImgDims({
        w: imgRef.current.naturalWidth,
        h: imgRef.current.naturalHeight,
      })
    }
  }, [])

  // Bildens "excess" i varje led efter object-cover, dvs hur mycket som ryms utanför
  // containern som kan panoreras fram.
  const excess = (() => {
    if (!imgDims || !containerDims) return { x: 0, y: 0 }
    const containerRatio = containerDims.w / containerDims.h
    const imgRatio = imgDims.w / imgDims.h
    if (imgRatio > containerRatio) {
      // Bilden är bredare än containern — skalas till containerhöjd, överflöd horisontellt
      const scaledW = containerDims.h * imgRatio
      return { x: scaledW - containerDims.w, y: 0 }
    } else {
      // Bilden är smalare (porträtt) — skalas till containerbredd, överflöd vertikalt
      const scaledH = containerDims.w / imgRatio
      return { x: 0, y: scaledH - containerDims.h }
    }
  })()

  const canDrag = excess.x > 0 || excess.y > 0

  // Pointer-hantering
  const dragRef = useRef<{ startX: number; startY: number; startPos: { x: number; y: number } } | null>(null)

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!canDrag) return
    e.preventDefault()
    ;(e.target as Element).setPointerCapture(e.pointerId)
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startPos: pos,
    }
    setDragging(true)
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return
    const { startX, startY, startPos } = dragRef.current
    const dx = e.clientX - startX
    const dy = e.clientY - startY

    // Konvertera pixelförflyttning till procentförändring.
    // object-position: vid 0% visas vänster kant, vid 100% visas höger kant.
    // En drag åt höger (positivt dx) bör visa mer av vänster sida = minska x-procent.
    let newX = startPos.x
    let newY = startPos.y
    if (excess.x > 0) {
      newX = clamp(startPos.x - (dx / excess.x) * 100, 0, 100)
    }
    if (excess.y > 0) {
      newY = clamp(startPos.y - (dy / excess.y) * 100, 0, 100)
    }
    setPos({ x: newX, y: newY })
  }

  function handlePointerUp() {
    if (!dragRef.current) return
    dragRef.current = null
    setDragging(false)
    onChange(formatPosition(pos))
  }

  const positionString = formatPosition(pos)

  return (
    <div className="space-y-2">
      <div
        ref={containerRef}
        className={`relative w-full aspect-[4/3] rounded-2xl overflow-hidden bg-slate-100 select-none ${
          canDrag ? (dragging ? 'cursor-grabbing' : 'cursor-grab') : ''
        }`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <img
          ref={imgRef}
          src={imageSrc}
          alt="Fångst"
          onLoad={onImgLoad}
          draggable={false}
          className="absolute inset-0 w-full h-full object-cover pointer-events-none"
          style={{ objectPosition: positionString }}
        />
        {canDrag && (
          <div className={`absolute top-2 left-1/2 -translate-x-1/2 bg-black/60 text-white text-xs px-2.5 py-1 rounded-full transition-opacity ${dragging ? 'opacity-0' : 'opacity-100'}`}>
            Dra för att justera bilden
          </div>
        )}
      </div>
      {canDrag && (
        <button
          type="button"
          onClick={() => {
            setPos({ x: 50, y: 50 })
            onChange('50% 50%')
          }}
          className="text-xs text-slate-500 hover:text-slate-700 underline"
        >
          Återställ till mitten
        </button>
      )}
    </div>
  )
}

function parsePosition(value: string | null | undefined): { x: number; y: number } {
  if (!value) return { x: 50, y: 50 }
  const match = value.match(/^(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%$/)
  if (!match) return { x: 50, y: 50 }
  return { x: parseFloat(match[1]), y: parseFloat(match[2]) }
}

function formatPosition(pos: { x: number; y: number }): string {
  return `${Math.round(pos.x)}% ${Math.round(pos.y)}%`
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}
