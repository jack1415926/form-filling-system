import { useEffect, useId, useRef, useState } from 'react'
import { Badge, Button } from 'antd'

type Position = { x: number; y: number }
const clamp = ({ x, y }: Position): Position => ({
  x: Math.max(8, Math.min(x, window.innerWidth - 64)),
  y: Math.max(8, Math.min(y, window.innerHeight - 64)),
})

export default function FeedbackLauncher({ reviewAvailable, reviewCount, systemCount = 0, onSystem, onReview }: {
  reviewAvailable: boolean; reviewCount: number; systemCount?: number; onSystem: () => void; onReview: () => void
}) {
  const [position, setPosition] = useState<Position | null>(null), [open, setOpen] = useState(false)
  const hintId = useId(), menuHeight = reviewAvailable ? 94 : 128
  const drag = useRef<{ id: number; startX: number; startY: number; origin: Position; moved: boolean } | null>(null)
  const container = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const resize = () => setPosition(current => current && clamp(current))
    const outside = (event: PointerEvent) => { if (!container.current?.contains(event.target as Node)) setOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    window.addEventListener('resize', resize)
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => {
      window.removeEventListener('resize', resize)
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [])
  return <div ref={container} className="feedback-launcher" style={position ? { left: position.x, top: position.y } : { right: 32, bottom: 32 }}>
    {open && <div className="feedback-launcher-menu" style={position ? {
      position: 'fixed', left: Math.max(8, Math.min(position.x, window.innerWidth - 208)), right: 'auto',
      top: Math.max(8, Math.min(position.y >= menuHeight + 16 ? position.y - menuHeight - 8 : position.y + 64, window.innerHeight - menuHeight - 8)), bottom: 'auto',
    } : undefined}>
      <Button aria-label="打开系统反馈" onClick={() => { setOpen(false); onSystem() }}>系统反馈<Badge count={systemCount} style={{ marginLeft: 8 }} /></Button>
      <Button aria-label="打开审核意见" disabled={!reviewAvailable} aria-describedby={!reviewAvailable ? hintId : undefined}
        onClick={() => { setOpen(false); onReview() }}>审核意见<Badge count={reviewAvailable ? reviewCount : 0} style={{ marginLeft: 8 }} /></Button>
      {!reviewAvailable && <p id={hintId} className="feedback-launcher-hint">请先打开已提交的申请</p>}
    </div>}
    <Badge count={!open ? (reviewAvailable ? reviewCount : 0) + systemCount : 0}><button type="button" className="feedback-launcher-button" aria-label="打开意见与反馈" aria-expanded={open}
      title="点击打开意见与反馈；按住拖动可移动" onPointerDown={event => {
        if (event.button !== 0) return
        const rect = event.currentTarget.getBoundingClientRect()
        drag.current = { id: event.pointerId, startX: event.clientX, startY: event.clientY, origin: { x: rect.left, y: rect.top }, moved: false }
        event.currentTarget.setPointerCapture(event.pointerId)
      }} onPointerMove={event => {
        const current = drag.current
        if (!current || current.id !== event.pointerId || !event.currentTarget.hasPointerCapture(event.pointerId)) return
        const dx = event.clientX - current.startX, dy = event.clientY - current.startY
        if (!current.moved && Math.hypot(dx, dy) < 5) return
        current.moved = true; setOpen(false)
        setPosition(clamp({ x: current.origin.x + dx, y: current.origin.y + dy }))
      }} onPointerUp={event => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
      }} onPointerCancel={() => { drag.current = null; setOpen(false) }}
      onClick={event => {
        if (event.detail && drag.current?.moved) { drag.current = null; return }
        drag.current = null; setOpen(current => !current)
      }}>意见<br />与反馈</button></Badge>
  </div>
}
