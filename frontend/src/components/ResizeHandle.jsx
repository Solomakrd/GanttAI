import { useEffect, useRef, useState } from 'react'

const STEP = 8
const LARGE_STEP = 24

export function ResizeHandle({ label, value, min, max, onChange, onReset, direction = 1, className = '' }) {
  const drag = useRef(null)
  const onChangeRef = useRef(onChange)
  const [dragging, setDragging] = useState(false)
  onChangeRef.current = onChange

  useEffect(() => {
    if (!dragging) return undefined
    const move = (event) => {
      const next = drag.current.value + (event.clientX - drag.current.x) * direction
      onChangeRef.current(Math.round(next))
    }
    const stop = () => {
      drag.current = null
      setDragging(false)
      document.body.classList.remove('is-resizing')
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
      document.body.classList.remove('is-resizing')
    }
  }, [direction, dragging])

  const keyDown = (event) => {
    const step = event.shiftKey ? LARGE_STEP : STEP
    let next
    if (event.key === 'ArrowLeft') next = value - step * direction
    else if (event.key === 'ArrowRight') next = value + step * direction
    else if (event.key === 'Home') next = direction === 1 ? min : max
    else if (event.key === 'End') next = direction === 1 ? max : min
    else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onReset()
      return
    }
    else return
    event.preventDefault()
    onChange(next)
  }

  return <div
    className={`resize-handle ${className}${dragging ? ' dragging' : ''}`}
    role="separator"
    aria-label={label}
    aria-orientation="vertical"
    aria-valuemin={min}
    aria-valuemax={max}
    aria-valuenow={value}
    tabIndex="0"
    title="Drag or use arrow keys to resize. Double-click, Enter, or Space to reset."
    onKeyDown={keyDown}
    onDoubleClick={onReset}
    onPointerDown={(event) => {
      if (event.button !== 0) return
      event.preventDefault()
      drag.current = { x: event.clientX, value }
      setDragging(true)
      document.body.classList.add('is-resizing')
    }}
  />
}
