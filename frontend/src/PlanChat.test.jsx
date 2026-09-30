import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PlanChat } from './components/PlanChat'

const task = { id: 'a', task: 'A', description: '', assignee: 'Maya', duration: 1, start_date: '2026-10-01', end_date: '2026-10-01', predecessors: [] }

class FakeSocket {
  static instances = []
  constructor(url) { this.url = url; this.listeners = {}; FakeSocket.instances.push(this) }
  addEventListener(name, callback) { this.listeners[name] = callback }
  emit(name, payload) { this.listeners[name]?.(payload) }
  send = vi.fn()
  close = vi.fn()
}

const project = { projectId: 'project-1', token: 'secret-token', version: 1, messages: [], tasks: [task] }

afterEach(() => { cleanup(); vi.unstubAllGlobals(); FakeSocket.instances = [] })

describe('plan chat', () => {
  it('sends the current version and applies only a validated complete plan', async () => {
    vi.stubGlobal('WebSocket', FakeSocket)
    const onPlan = vi.fn()
    render(<PlanChat project={project} onPlan={onPlan} />)
    const socket = FakeSocket.instances[0]
    expect(socket.url).not.toContain('secret-token')
    act(() => socket.emit('open', {}))
    expect(JSON.parse(socket.send.mock.calls[0][0])).toEqual({ type: 'auth', token: 'secret-token' })
    act(() => socket.emit('message', { data: JSON.stringify({ type: 'connected', version: 1 }) }))
    fireEvent.change(screen.getByLabelText('Request a plan change'), { target: { value: 'Reassign A' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }))
    expect(JSON.parse(socket.send.mock.calls[1][0])).toEqual({ type: 'message', content: 'Reassign A', expected_version: 1 })
    const changed = { ...task, assignee: 'Priya' }
    act(() => socket.emit('message', { data: JSON.stringify({ type: 'complete', version: 2, plan: { tasks: [changed] }, message: 'Reassigned A.' }) }))
    await waitFor(() => expect(onPlan).toHaveBeenCalledWith({ tasks: [changed], version: 2 }))
    expect(screen.getByText('Reassigned A.')).toBeInTheDocument()
  })

  it('keeps the plan on malformed, failed, and cancelled responses and offers retry', () => {
    vi.stubGlobal('WebSocket', FakeSocket)
    const onPlan = vi.fn()
    render(<PlanChat project={project} onPlan={onPlan} />)
    const socket = FakeSocket.instances[0]
    act(() => socket.emit('message', { data: JSON.stringify({ type: 'connected', version: 1 }) }))
    act(() => socket.emit('message', { data: JSON.stringify({ type: 'complete', version: 2, plan: { tasks: [{ id: 'bad' }] }, message: 'bad' }) }))
    expect(screen.getByRole('alert')).toHaveTextContent('invalid response')
    act(() => socket.emit('message', { data: JSON.stringify({ type: 'cancelled', message: 'Request cancelled. The plan was not changed.' }) }))
    expect(screen.getByRole('alert')).toHaveTextContent('not changed')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    expect(onPlan).not.toHaveBeenCalled()
  })

  it('shows safe tool lifecycle and cancellation control', () => {
    vi.stubGlobal('WebSocket', FakeSocket)
    render(<PlanChat project={project} onPlan={vi.fn()} />)
    const socket = FakeSocket.instances[0]
    act(() => socket.emit('message', { data: JSON.stringify({ type: 'connected', version: 1 }) }))
    act(() => socket.emit('message', { data: JSON.stringify({ type: 'tool', tool: 'update_task', status: 'running' }) }))
    expect(screen.getByRole('status')).toHaveTextContent('update_task: running')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(JSON.parse(socket.send.mock.calls[0][0])).toEqual({ type: 'cancel' })
  })

  it('reconnects when retry is selected after a network close', () => {
    vi.stubGlobal('WebSocket', FakeSocket)
    render(<PlanChat project={project} onPlan={vi.fn()} />)
    act(() => FakeSocket.instances[0].emit('close', {}))
    expect(screen.getByRole('alert')).toHaveTextContent('disconnected')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(FakeSocket.instances).toHaveLength(2)
  })
})
