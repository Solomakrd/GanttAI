import { useMemo, useRef, useState } from 'react'
import { ResizeHandle } from './ResizeHandle'
import { useI18n } from '../i18n'

const DAY = 24 * 60 * 60 * 1000
const PX_PER_DAY = 52
const ROW_HEIGHT = 48
const BAR_X_INSET = 5
const BAR_TOP = 12
const BAR_HEIGHT = 24
const BAR_MIN_WIDTH = 24
const CONNECTOR_CURVE = 20
const COLORS = ['#2376d8', '#9d77ee', '#29a96b', '#e17b52', '#0c204d']

function asDay(value) {
  return new Date(`${value.slice(0, 10)}T00:00:00Z`).getTime()
}

function initials(name) {
  return name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || '—'
}

function barGeometry(position, zoom) {
  return {
    left: position.x * zoom + BAR_X_INSET,
    top: position.y + BAR_TOP,
    width: Math.max(BAR_MIN_WIDTH, position.width * zoom - BAR_X_INSET * 2),
  }
}

export function GanttChart({ tasks, onSelectTask, disabled = false, widths, taskTableMax, mobile = false, onWidthChange, onWidthReset }) {
  const { t, formatDate } = useI18n()
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
      color: COLORS[index % COLORS.length],
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
    return <section className="chart-card empty-chart" aria-label={t('interactiveChart')}><span className="empty-mark">+</span><strong>{t('noTasks')}</strong><span>{t('noTasksHelp')}</span></section>
  }

  const chartWidth = days.length * PX_PER_DAY
  const chartHeight = tasks.length * ROW_HEIGHT
  const fitPlan = () => {
    if (scrollRef.current) scrollRef.current.scrollTo({ left: 0, behavior: 'smooth' })
    setZoom(1)
  }

  const monthSegments = days.reduce((segments, day) => {
    const label = formatDate(day, { month: 'long', year: 'numeric' })
    const previous = segments.at(-1)
    if (previous?.label === label) previous.count += 1
    else segments.push({ label, count: 1 })
    return segments
  }, [])

  return <section className="chart-card" aria-label={t('interactiveChart')}>
    <div className="chart-toolbar">
       <div><span className="eyebrow">{t('timeline')}</span><h2>{t('deliveryPlan')}</h2></div>
      <div className="chart-controls">
        <button type="button" onClick={() => setZoom((value) => Math.max(0.75, value - 0.25))} aria-label={t('zoomOut')}>−</button>
        <span>{Math.round(zoom * 100)}%</span>
        <button type="button" onClick={() => setZoom((value) => Math.min(1.75, value + 0.25))} aria-label={t('zoomIn')}>+</button>
        <button type="button" className="fit-button" onClick={fitPlan}>{t('fitPlan')}</button>
      </div>
    </div>
     <div className="timeline-scroll" ref={scrollRef}>
       <div className="timeline" style={{ minWidth: `${widths.taskTable + chartWidth * zoom}px`, '--task-column': `${widths.taskTable}px`, '--task-name-column': `${widths.taskName}px` }}>
          <div className="task-table">
             <div className="task-heading"><span>{t('task')}</span><span>{t('ownerLength')}</span></div>
           {tasks.map((task, index) => <div className="task-row" key={task.id} style={{ height: ROW_HEIGHT, '--task-color': COLORS[index % COLORS.length] }}>
              {onSelectTask ? <button type="button" className="task-name task-trigger" disabled={disabled} onClick={() => onSelectTask(task.id)} aria-label={t('editDetails', { task: task.task })}><i /><strong>{task.task}</strong><span className="task-meta"><b>{initials(task.assignee)}</b>{t('durationShort', { count: task.duration })}</span></button> : <div className="task-name"><i /><strong>{task.task}</strong><span className="task-meta"><b>{initials(task.assignee)}</b>{t('durationShort', { count: task.duration })}</span></div>}
            </div>)}
             {!mobile && <ResizeHandle className="task-owner-resize" label={t('taskOwnerBoundary')} value={widths.taskName} min={140} max={Math.min(500, widths.taskTable - 100)} onChange={(value) => onWidthChange('taskName', value)} onReset={() => onWidthReset('taskName')} />}
              {!mobile && <ResizeHandle className="task-timeline-resize" label={t('taskTimelineBoundary')} value={widths.taskTable} min={260} max={taskTableMax} onChange={(value) => onWidthChange('taskTable', value)} onReset={() => onWidthReset('taskTable')} />}
          </div>
         <div className="timeline-pane" style={{ width: chartWidth * zoom }}>
           <div className="timeline-header">
             <div className="month-strip">{monthSegments.map((segment) => <span key={segment.label} style={{ width: segment.count * PX_PER_DAY * zoom }}>{segment.label}</span>)}</div>
              <div className="date-strip">{days.map((day) => { const date = new Date(day); const weekend = date.getUTCDay() === 0 || date.getUTCDay() === 6; return <div className={`date-cell${weekend ? ' weekend' : ''}`} key={day} style={{ width: PX_PER_DAY * zoom }}><strong>{formatDate(day, { day: 'numeric' })}</strong><span>{formatDate(day, { weekday: 'short' }).slice(0, 2)}</span></div> })}</div>
           </div>
           <div className="plot" style={{ width: chartWidth * zoom, height: chartHeight }}>
              <div className="grid-lines">{days.map((day) => { const weekend = [0, 6].includes(new Date(day).getUTCDay()); return <i className={weekend ? 'weekend' : ''} key={day} style={{ left: (day - firstDay) / DAY * PX_PER_DAY * zoom, width: PX_PER_DAY * zoom }} /> })}</div>
              <svg className="connectors" width={chartWidth * zoom} height={chartHeight} aria-label={t('taskDependencies')}>
                {dependencies.map(({ from, to, key }) => {
                  const fromBar = barGeometry(from, zoom)
                  const toBar = barGeometry(to, zoom)
                 const startX = fromBar.left + fromBar.width
                 const endX = toBar.left
                  const startY = fromBar.top + BAR_HEIGHT / 2
                  const endY = toBar.top + BAR_HEIGHT / 2
                  const curve = Math.max(CONNECTOR_CURVE, (endX - startX) / 2 + 8)
                  const path = `M ${startX} ${startY} C ${startX + curve} ${startY}, ${endX - curve} ${endY}, ${endX} ${endY}`
                  return <g className="dependency" key={key} aria-hidden="true">
                    <path className="dependency-target" d={path} style={{ stroke: to.color }} />
                    <path className="dependency-source" d={path} style={{ stroke: from.color }} strokeDasharray="6 6" strokeLinecap="butt" />
                  </g>
                })}
              </svg>
               {tasks.map((task, index) => { const position = positions.get(task.id); const style = { ...barGeometry(position, zoom), '--bar-color': COLORS[index % COLORS.length] }; return onSelectTask ? <button type="button" className="task-bar task-trigger" disabled={disabled} onClick={() => onSelectTask(task.id)} key={task.id} style={style} aria-label={t('editBar', { task: task.task })}><span>{task.task}</span></button> : <div className="task-bar" key={task.id} style={style} title={t('assignedTo', { task: task.task, assignee: task.assignee })}><span>{task.task}</span></div> })}
           </div>
         </div>
      </div>
    </div>
    <div className="chart-footer"><span><i className="legend-swatch" />{t('taskDuration')}</span><span><i className="legend-line" />{t('predecessor')}</span><span className="date-range">{formatDate(firstDay, { month: 'short', day: 'numeric', year: 'numeric' })} – {formatDate(lastDay, { month: 'short', day: 'numeric', year: 'numeric' })}</span></div>
  </section>
}
