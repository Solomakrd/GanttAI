import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import App from './App'

const plan = { tasks: [{ id: 'one', task: 'First task', description: '', assignee: 'Maya', duration: 2, start_date: '2026-10-05', end_date: '2026-10-06', predecessors: [] }, { id: 'two', task: 'Second task', description: '', assignee: 'Leo', duration: 1, start_date: '2026-10-07', end_date: '2026-10-07', predecessors: ['one'] }] }

beforeEach(() => { vi.restoreAllMocks() })
afterEach(() => { cleanup() })

describe('plan view', () => {
  it('shows a loading state and then seeded tasks with a dependency', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => plan })
    render(<App />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading')
    expect((await screen.findAllByText('First task')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Second task').length).toBeGreaterThan(0)
    expect(screen.getByLabelText('Task dependencies')).toBeInTheDocument()
  })

  it('shows a retryable API error', async () => {
    const fetch = vi.spyOn(global, 'fetch').mockRejectedValue(new Error('offline'))
    render(<App />)
    expect(await screen.findByRole('alert')).toHaveTextContent('could not load')
    fetch.mockResolvedValue({ ok: true, json: async () => plan })
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect((await screen.findAllByText('First task')).length).toBeGreaterThan(0)
  })

  it('keeps an empty plan usable', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ tasks: [] }) })
    render(<App />)
    expect(await screen.findByText('No tasks in this plan')).toBeInTheDocument()
  })

  it('rejects malformed records and keeps valid records', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ tasks: [plan.tasks[0], { id: 'bad', task: '', duration: -1, start_date: 'bad', end_date: 'bad', predecessors: [] }, { id: 'bad-date', task: 'Bad date', assignee: 'A', duration: 1, start_date: '2026-02-30', end_date: '2026-03-01', predecessors: [] }] }) })
    render(<App />)
    expect(await screen.findByText(/invalid task record/)).toHaveTextContent('bad, bad-date')
    expect(screen.getAllByText('First task').length).toBeGreaterThan(0)
  })

  it('provides timeline controls on a narrow layout', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => plan })
    const { container } = render(<App />)
    await waitFor(() => expect(screen.getAllByText('First task').length).toBeGreaterThan(0))
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fit plan' })).toBeInTheDocument()
    expect(container.querySelector('.timeline-scroll')).toBeInTheDocument()
  })
})
