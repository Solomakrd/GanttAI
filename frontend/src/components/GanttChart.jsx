import { useMemo, useRef, useState } from 'react'

const DAY = 24 * 60 * 60 * 1000
const PX_PER_DAY = 68
const ROW_HEIGHT = 66
const LABEL_WIDTH = 224

function asDay(value) {
  return new Date(`${value.slice(0, 10)}T00:00:00Z`).getTime()
}

function formatDay(day) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(day))
}

export function GanttChart({ tasks }) {
  const scrollRef = useRef(null)
  const [zoom, setZoom] = useState(1)
  const { firstDay, lastDay, days, positions, dependencies } = useMemo(() => {
    if (!tasks.length) return { firstDay: 0, lastDay: 0, days: [], positions: new Map(), dependencies: [] }
    const first = Math.min(...tasks.map((task) => asDay(task.start_date)))
    const last = Math.max(...tasks.map((task) => asDay(task.end_date)))
    const daysInPlan = Math.round((last - first) / DAY) + 1
    const positionsById = new Map(tasks.map((task, index) => [task.id, {
      x: ((asDay(task.start_date) - first) / DAY) * PX_PER_DAY,
      width: ((asDay(task.end_date) - asDay(task.start_date)) / DAY + 1) * PX_PER_DAY,
      y: index * ROW_HEIGHT,
    }]))
    const links = tasks.flatMap((task) => task.predecessors.flatMap((predecessor) => {
      const from = positionsById.get(predecessor)
      const to = positionsById.get(task.id)
      return from && to ? [{ from, to, key: `${predecessor}-${task.id}` }] : []
    }))
    return {
      firstDay: first,
      lastDay: last,
      days: Array.from({ length: daysInPlan }, (_, index) => first + index * DAY),
      positions: positionsById,
      dependencies: links,
    }
  }, [tasks])

  if (!tasks.length) {
    return <div className="empty-chart"><span className="empty-mark">+</span><strong>No tasks in this plan</strong><span>Add tasks through the plan API to populate the timeline.</span></div>
  }

  const chartWidth = days.length * PX_PER_DAY
  const chartHeight = tasks.length * ROW_HEIGHT
  const fitPlan = () => {
    if (scrollRef.current) scrollRef.current.scrollTo({ left: 0, behavior: 'smooth' })
    setZoom(1)
  }

  return <section className="chart-card" aria-label="Interactive Gantt chart">
    <div className="chart-toolbar">
      <div><span className="eyebrow">Timeline</span><h2>Delivery plan</h2></div>
      <div className="chart-controls">
        <button type="button" onClick={() => setZoom((value) => Math.max(0.75, value - 0.25))} aria-label="Zoom out">−</button>
        <span>{Math.round(zoom * 100)}%</span>
        <button type="button" onClick={() => setZoom((value) => Math.min(1.75, value + 0.25))} aria-label="Zoom in">+</button>
        <button type="button" className="fit-button" onClick={fitPlan}>Fit plan</button>
      </div>
    </div>
    <div className="timeline-scroll" ref={scrollRef}>
      <div className="timeline" style={{ '--chart-width': `${chartWidth * zoom}px`, minWidth: `${LABEL_WIDTH + chartWidth * zoom}px` }}>
        <div className="timeline-header">
          <div className="task-heading">Tasks <span>{tasks.length}</span></div>
          <div className="date-strip" style={{ width: chartWidth * zoom }}>
            {days.map((day) => <div className="date-cell" key={day} style={{ width: PX_PER_DAY * zoom }}>{formatDay(day)}</div>)}
          </div>
        </div>
        <div className="timeline-body">
          <div className="task-list">
            {tasks.map((task, index) => <div className="task-row" key={task.id} style={{ height: ROW_HEIGHT }}>
              <div className="task-name"><strong>{task.task}</strong><span>{task.assignee} · {task.duration}d</span></div>
              <div className="row-background" />
            </div>)}
          </div>
          <div className="plot" style={{ width: chartWidth * zoom, height: chartHeight }}>
            <div className="grid-lines">{days.map((day) => <i key={day} style={{ left: (day - firstDay) / DAY * PX_PER_DAY * zoom }} />)}</div>
            <svg className="connectors" width={chartWidth * zoom} height={chartHeight} aria-label="Task dependencies">
              <defs><marker id="arrow" markerWidth="7" markerHeight="7" refX="5" refY="3" orient="auto"><path d="M0,0 L0,6 L6,3 z" fill="#e17b52" /></marker></defs>
              {dependencies.map(({ from, to, key }) => {
                const startX = (from.x + from.width) * zoom
                const endX = to.x * zoom
                const startY = from.y + ROW_HEIGHT / 2
                const endY = to.y + ROW_HEIGHT / 2
                const bend = Math.max(startX + 16, endX - 14)
                return <path key={key} d={`M ${startX} ${startY} H ${bend} V ${endY} H ${endX - 4}`} markerEnd="url(#arrow)" />
              })}
            </svg>
            {tasks.map((task) => { const position = positions.get(task.id); return <div className="task-bar" key={task.id} style={{ left: position.x * zoom, top: position.y + 18, width: position.width * zoom - 8 }} title={`${task.task}, assigned to ${task.assignee}`}><span>{task.task}</span></div> })}
          </div>
        </div>
      </div>
    </div>
    <div className="chart-footer"><span><i className="legend-swatch" />Task duration</span><span><i className="legend-line" />Predecessor</span><span className="date-range">{formatDay(firstDay)} – {formatDay(lastDay)}</span></div>
  </section>
}
