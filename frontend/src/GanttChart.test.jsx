import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { GanttChart } from './components/GanttChart'


afterEach(() => { cleanup(); vi.useRealTimers() })


it('centers the local-day marker inside the plan, keeps it aligned through zoom, and hides it outside', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 9, 5, 12))
  const props = {
    tasks: [{ id: 'one', task: 'First', description: '', assignee: 'Maya', duration: 2,
      start_date: '2026-10-05', end_date: '2026-10-06', predecessors: [] }],
    widths: { taskTable: 340, taskName: 220 }, taskTableMax: 600, onWidthChange: vi.fn(), onWidthReset: vi.fn(),
  }
  const { container, rerender } = render(<GanttChart {...props} />)
  expect(container.querySelector('.today-line')).toHaveStyle({ left: '26px' })
  fireEvent.click(container.querySelector('[aria-label="Zoom in"]'))
  expect(container.querySelector('.today-line')).toHaveStyle({ left: '32.5px' })

  rerender(<GanttChart {...props} tasks={[{ ...props.tasks[0], start_date: '2026-10-06', end_date: '2026-10-07' }]} />)
  expect(container.querySelector('.today-line')).not.toBeInTheDocument()
  vi.setSystemTime(new Date(2026, 9, 7, 9))
  fireEvent(window, new Event('focus'))
  expect(container.querySelector('.today-line')).toHaveStyle({ left: '97.5px' })
  expect(container.querySelector('.today-line')).toHaveClass('final-day')
})
