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

  it('submits with Enter and keeps Shift+Enter for new lines', () => {
    vi.stubGlobal('WebSocket', FakeSocket)
    render(<PlanChat project={project} onPlan={vi.fn()} />)
    const socket = FakeSocket.instances[0]
    act(() => socket.emit('message', { data: JSON.stringify({ type: 'connected', version: 1 }) }))
    const composer = screen.getByLabelText('Request a plan change')

    fireEvent.change(composer, { target: { value: 'First line\nSecond line' } })
    expect(fireEvent.keyDown(composer, { key: 'Enter', shiftKey: true })).toBe(true)
    expect(fireEvent.keyDown(composer, { key: 'Enter', isComposing: true })).toBe(true)
    expect(socket.send).toHaveBeenCalledTimes(0)
    expect(composer).toHaveValue('First line\nSecond line')

    expect(fireEvent.keyDown(composer, { key: 'Enter' })).toBe(false)
    expect(JSON.parse(socket.send.mock.calls[0][0])).toEqual({ type: 'message', content: 'First line\nSecond line', expected_version: 1 })
    expect(composer).toHaveValue('')
  })

  it('keeps the plan on malformed, failed, and cancelled responses and offers retry', () => {
    vi.stubGlobal('WebSocket', FakeSocket)
    const onPlan = vi.fn()
    render(<PlanChat project={project} onPlan={onPlan} />)
    const socket = FakeSocket.instances[0]
    act(() => socket.emit('message', { data: JSON.stringify({ type: 'connected', version: 1 }) }))
    act(() => socket.emit('message', { data: JSON.stringify({ type: 'status', code: 'planning' }) }))
    act(() => socket.emit('message', { data: JSON.stringify({ type: 'clarification', message: 'Which task should move?' }) }))
    expect(screen.getByText('Which task should move?')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    act(() => socket.emit('message', { data: JSON.stringify({ type: 'error', code: 'processing', message: 'Meaningful server error.' }) }))
    expect(screen.getByRole('alert')).toHaveTextContent('Meaningful server error.')
    act(() => socket.emit('message', { data: JSON.stringify({ type: 'complete', version: 2, plan: { tasks: [{ id: 'bad' }] }, message: 'bad' }) }))
    expect(screen.getByRole('alert')).toHaveTextContent('invalid response')
    act(() => socket.emit('message', { data: JSON.stringify({ type: 'cancelled', message: 'Request cancelled. The plan was not changed.' }) }))
    expect(screen.getByRole('alert')).toHaveTextContent('not changed')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    expect(onPlan).not.toHaveBeenCalled()
  })

  it('localizes every known tool lifecycle and count without exposing protocol values', () => {
    vi.stubGlobal('WebSocket', FakeSocket)
    render(<PlanChat project={project} onPlan={vi.fn()} />)
    const socket = FakeSocket.instances[0]
    act(() => socket.emit('message', { data: JSON.stringify({ type: 'connected', version: 1 }) }))
    for (const [tool, label] of Object.entries({ read_plan: 'Reading the plan', add_task: 'Adding a task', update_task: 'Updating a task', set_dependencies: 'Updating dependencies', delete_tasks: 'Deleting tasks' })) {
      act(() => socket.emit('message', { data: JSON.stringify({ type: 'tool', tool, status: 'running' }) }))
      expect(screen.getByRole('status')).toHaveTextContent(label)
      expect(screen.getByRole('status')).not.toHaveTextContent(tool)
    }
    act(() => socket.emit('message', { data: JSON.stringify({ type: 'tool', tool: 'update_task', status: 'complete', task_count: 1 }) }))
    expect(screen.getByRole('status')).toHaveTextContent('Validated 1 task.')
    act(() => socket.emit('message', { data: JSON.stringify({ type: 'tool', tool: 'update_task', status: 'complete', task_count: 12 }) }))
    expect(screen.getByRole('status')).toHaveTextContent('Validated 12 tasks.')
    act(() => socket.emit('message', { data: JSON.stringify({ type: 'tool', tool: 'update_task', status: 'complete', task_count: 500 }) }))
    expect(screen.getByRole('status')).toHaveTextContent('Validated 500 tasks.')
    act(() => socket.emit('message', { data: JSON.stringify({ type: 'tool', tool: 'update_task', status: 'complete', task_count: '12' }) }))
    expect(screen.getByRole('status')).toHaveTextContent('Completed: Updating a task.')
    expect(screen.getByRole('status')).not.toHaveTextContent('12')
    for (const taskCount of [501, Number.MAX_SAFE_INTEGER + 1]) {
      act(() => socket.emit('message', { data: JSON.stringify({ type: 'tool', tool: 'update_task', status: 'complete', task_count: taskCount }) }))
      expect(screen.getByRole('status')).toHaveTextContent('Completed: Updating a task.')
      expect(screen.getByRole('status')).not.toHaveTextContent(String(taskCount))
    }
    act(() => socket.emit('message', { data: JSON.stringify({ type: 'tool', tool: 'update_task', status: 'failed', result: 'provider secret' }) }))
    expect(screen.getByRole('status')).toHaveTextContent('Recovering...')
    expect(screen.getByRole('status')).not.toHaveTextContent('provider secret')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(JSON.parse(socket.send.mock.calls[0][0])).toEqual({ type: 'cancel' })
  })

  it('uses generic localized progress for malformed or unknown events', () => {
    vi.stubGlobal('WebSocket', FakeSocket)
    render(<PlanChat project={project} onPlan={vi.fn()} />)
    const socket = FakeSocket.instances[0]
    act(() => socket.emit('message', { data: JSON.stringify({ type: 'status', code: 'future_backend_code', key: 'raw_key', message: 'raw status' }) }))
    expect(screen.getByRole('status')).toHaveTextContent('Working on your plan...')
    expect(screen.getByRole('status')).not.toHaveTextContent(/future_backend_code|raw_key|raw status/)
    act(() => socket.emit('message', { data: JSON.stringify({ type: 'tool', tool: 'run_shell', status: 'complete', task_count: '12' }) }))
    expect(screen.getByRole('status')).toHaveTextContent('Working on your plan...')
    expect(screen.getByRole('status')).not.toHaveTextContent(/run_shell|12/)
    act(() => socket.emit('message', { data: JSON.stringify({ type: 'tool', tool: 'constructor', status: 'running' }) }))
    expect(screen.getByRole('status')).toHaveTextContent('Working on your plan...')
    expect(screen.getByRole('status')).not.toHaveTextContent(/constructor|function|native code/)
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
