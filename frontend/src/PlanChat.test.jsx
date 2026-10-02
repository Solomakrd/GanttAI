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

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); FakeSocket.instances = [] })

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
    const sent = JSON.parse(socket.send.mock.calls[1][0])
    expect(sent).toEqual({ type: 'message', request_id: expect.any(String), content: 'Reassign A', expected_version: 1 })
    const changed = { ...task, assignee: 'Priya' }
    act(() => socket.emit('message', { data: JSON.stringify({ type: 'complete', request_id: sent.request_id, version: 2, plan: { tasks: [changed] }, message: 'Reassigned A.' }) }))
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
    expect(JSON.parse(socket.send.mock.calls[0][0])).toEqual({ type: 'message', request_id: expect.any(String), content: 'First line\nSecond line', expected_version: 1 })
    expect(composer).toHaveValue('')
  })

  it('keeps the plan on malformed, failed, and cancelled responses and offers retry', () => {
    vi.stubGlobal('WebSocket', FakeSocket)
    const onPlan = vi.fn()
    render(<PlanChat project={project} onPlan={onPlan} />)
    const socket = FakeSocket.instances[0]
    act(() => socket.emit('message', { data: JSON.stringify({ type: 'connected', version: 1 }) }))
    fireEvent.change(screen.getByLabelText('Request a plan change'), { target: { value: 'Move it' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }))
    let requestId = JSON.parse(socket.send.mock.calls[0][0]).request_id
    act(() => socket.emit('message', { data: JSON.stringify({ type: 'status', request_id: requestId, code: 'planning' }) }))
    act(() => socket.emit('message', { data: JSON.stringify({ type: 'clarification', request_id: requestId, version: 1, message: 'Which task should move?' }) }))
    expect(screen.getByText('Which task should move?')).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Request a plan change'), { target: { value: 'Try again' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }))
    requestId = JSON.parse(socket.send.mock.calls[1][0]).request_id
    act(() => socket.emit('message', { data: JSON.stringify({ type: 'error', request_id: requestId, code: 'processing', message: 'Meaningful server error.' }) }))
    expect(screen.getByRole('alert')).toHaveTextContent('Meaningful server error.')
    fireEvent.change(screen.getByLabelText('Request a plan change'), { target: { value: 'Malformed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }))
    requestId = JSON.parse(socket.send.mock.calls[2][0]).request_id
    act(() => socket.emit('message', { data: JSON.stringify({ type: 'complete', request_id: requestId, version: 2, plan: { tasks: [{ id: 'bad' }] }, message: 'bad' }) }))
    expect(screen.getByRole('alert')).toHaveTextContent('invalid response')
    fireEvent.change(screen.getByLabelText('Request a plan change'), { target: { value: 'Cancel this' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }))
    requestId = JSON.parse(socket.send.mock.calls[3][0]).request_id
    act(() => socket.emit('message', { data: JSON.stringify({ type: 'cancelled', request_id: requestId, message: 'Request cancelled. The plan was not changed.' }) }))
    expect(screen.getByRole('alert')).toHaveTextContent('not changed')
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    expect(onPlan).not.toHaveBeenCalled()
  })

  it('retries a terminal request error with the same ID, one bubble, and a fresh busy lifecycle', () => {
    vi.stubGlobal('WebSocket', FakeSocket)
    const onOperation = vi.fn()
    render(<PlanChat project={project} onPlan={vi.fn()} onOperation={onOperation} />)
    const socket = FakeSocket.instances[0]
    act(() => socket.emit('message', { data: JSON.stringify({ type: 'connected', version: 1 }) }))
    fireEvent.change(screen.getByLabelText('Request a plan change'), { target: { value: 'Reassign A' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }))
    const request = JSON.parse(socket.send.mock.calls[0][0])

    act(() => socket.emit('message', { data: JSON.stringify({ type: 'error', request_id: request.request_id, code: 'processing', message: 'Provider failed.' }) }))
    expect(onOperation.mock.calls.map(([busy]) => busy)).toEqual([true, false])
    expect(screen.getAllByText('Reassign A')).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(JSON.parse(socket.send.mock.calls[1][0])).toEqual(request)
    expect(screen.getAllByText('Reassign A')).toHaveLength(1)
    expect(onOperation.mock.calls.map(([busy]) => busy)).toEqual([true, false, true])
    expect(screen.getByLabelText('Request a plan change')).toBeDisabled()

    act(() => socket.emit('message', { data: JSON.stringify({ type: 'clarification', request_id: request.request_id, version: 1, message: 'Which task?' }) }))
    expect(onOperation.mock.calls.map(([busy]) => busy)).toEqual([true, false, true, false])
    expect(screen.getByLabelText('Request a plan change')).toBeEnabled()
  })

  it('preserves a same-ID terminal retry across disconnect and reconnect', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', FakeSocket)
    const onOperation = vi.fn()
    render(<PlanChat project={project} onPlan={vi.fn()} onOperation={onOperation} />)
    const first = FakeSocket.instances[0]
    act(() => first.emit('message', { data: JSON.stringify({ type: 'connected', version: 1 }) }))
    fireEvent.change(screen.getByLabelText('Request a plan change'), { target: { value: 'Reassign A' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }))
    const request = JSON.parse(first.send.mock.calls[0][0])
    act(() => first.emit('message', { data: JSON.stringify({ type: 'error', request_id: request.request_id, code: 'processing', message: 'Provider failed.' }) }))

    act(() => first.emit('error', {}))
    act(() => first.emit('close', { code: 1006 }))
    expect(screen.getByRole('alert')).toHaveTextContent('Provider failed.')
    await act(() => vi.advanceTimersByTimeAsync(1000))
    const reconnected = FakeSocket.instances[1]
    act(() => reconnected.emit('open', {}))
    act(() => reconnected.emit('message', { data: JSON.stringify({ type: 'connected', version: 1 }) }))
    expect(screen.getByRole('alert')).toHaveTextContent('Provider failed.')
    expect(reconnected.send).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(JSON.parse(reconnected.send.mock.calls[1][0])).toEqual(request)
    expect(screen.getAllByText('Reassign A')).toHaveLength(1)
    expect(onOperation.mock.calls.map(([busy]) => busy)).toEqual([true, false, true])
  })

  it('localizes every known tool lifecycle and count without exposing protocol values', () => {
    vi.stubGlobal('WebSocket', FakeSocket)
    render(<PlanChat project={project} onPlan={vi.fn()} />)
    const socket = FakeSocket.instances[0]
    act(() => socket.emit('message', { data: JSON.stringify({ type: 'connected', version: 1 }) }))
    fireEvent.change(screen.getByLabelText('Request a plan change'), { target: { value: 'Change A' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }))
    const requestId = JSON.parse(socket.send.mock.calls[0][0]).request_id
    for (const [tool, label] of Object.entries({ read_plan: 'Reading the plan', add_task: 'Adding a task', update_task: 'Updating a task', set_dependencies: 'Updating dependencies', delete_tasks: 'Deleting tasks' })) {
      act(() => socket.emit('message', { data: JSON.stringify({ type: 'tool', request_id: requestId, tool, status: 'running' }) }))
      expect(screen.getByRole('status')).toHaveTextContent(label)
      expect(screen.getByRole('status')).not.toHaveTextContent(tool)
    }
    act(() => socket.emit('message', { data: JSON.stringify({ type: 'tool', request_id: requestId, tool: 'update_task', status: 'complete', task_count: 1 }) }))
    expect(screen.getByRole('status')).toHaveTextContent('Validated 1 task.')
    act(() => socket.emit('message', { data: JSON.stringify({ type: 'tool', request_id: requestId, tool: 'update_task', status: 'complete', task_count: 12 }) }))
    expect(screen.getByRole('status')).toHaveTextContent('Validated 12 tasks.')
    act(() => socket.emit('message', { data: JSON.stringify({ type: 'tool', request_id: requestId, tool: 'update_task', status: 'complete', task_count: 500 }) }))
    expect(screen.getByRole('status')).toHaveTextContent('Validated 500 tasks.')
    act(() => socket.emit('message', { data: JSON.stringify({ type: 'tool', request_id: requestId, tool: 'update_task', status: 'complete', task_count: '12' }) }))
    expect(screen.getByRole('status')).toHaveTextContent('Completed: Updating a task.')
    expect(screen.getByRole('status')).not.toHaveTextContent('12')
    for (const taskCount of [501, Number.MAX_SAFE_INTEGER + 1]) {
      act(() => socket.emit('message', { data: JSON.stringify({ type: 'tool', request_id: requestId, tool: 'update_task', status: 'complete', task_count: taskCount }) }))
      expect(screen.getByRole('status')).toHaveTextContent('Completed: Updating a task.')
      expect(screen.getByRole('status')).not.toHaveTextContent(String(taskCount))
    }
    act(() => socket.emit('message', { data: JSON.stringify({ type: 'tool', request_id: requestId, tool: 'update_task', status: 'failed', result: 'provider secret' }) }))
    expect(screen.getByRole('status')).toHaveTextContent('Recovering...')
    expect(screen.getByRole('status')).not.toHaveTextContent('provider secret')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(JSON.parse(socket.send.mock.calls[1][0])).toEqual({ type: 'cancel', request_id: requestId })
  })

  it('uses generic localized progress for malformed or unknown events', () => {
    vi.stubGlobal('WebSocket', FakeSocket)
    render(<PlanChat project={project} onPlan={vi.fn()} />)
    const socket = FakeSocket.instances[0]
    act(() => socket.emit('message', { data: JSON.stringify({ type: 'connected', version: 1 }) }))
    fireEvent.change(screen.getByLabelText('Request a plan change'), { target: { value: 'Change A' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }))
    const requestId = JSON.parse(socket.send.mock.calls[0][0]).request_id
    act(() => socket.emit('message', { data: JSON.stringify({ type: 'status', request_id: requestId, code: 'future_backend_code', key: 'raw_key', message: 'raw status' }) }))
    expect(screen.getByRole('status')).toHaveTextContent('Working on your plan...')
    expect(screen.getByRole('status')).not.toHaveTextContent(/future_backend_code|raw_key|raw status/)
    act(() => socket.emit('message', { data: JSON.stringify({ type: 'tool', request_id: requestId, tool: 'run_shell', status: 'complete', task_count: '12' }) }))
    expect(screen.getByRole('status')).toHaveTextContent('Working on your plan...')
    expect(screen.getByRole('status')).not.toHaveTextContent(/run_shell|12/)
    act(() => socket.emit('message', { data: JSON.stringify({ type: 'tool', request_id: requestId, tool: 'constructor', status: 'running' }) }))
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

  it.each([false, true])('manual Retry preserves and replays a pending request when close arrived: %s', async (closed) => {
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', FakeSocket)
    const onOperation = vi.fn()
    render(<PlanChat project={project} onPlan={vi.fn()} onOperation={onOperation} />)
    const first = FakeSocket.instances[0]
    act(() => first.emit('message', { data: JSON.stringify({ type: 'connected', version: 1 }) }))
    fireEvent.change(screen.getByLabelText('Request a plan change'), { target: { value: 'Reassign A' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }))
    const request = JSON.parse(first.send.mock.calls[0][0])
    act(() => first.emit('error', {}))
    if (closed) act(() => first.emit('close', { code: 1006 }))
    expect(screen.getByRole('status')).toHaveTextContent('Starting request...')
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    expect(screen.getByLabelText('Request a plan change')).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(FakeSocket.instances).toHaveLength(2)
    const reconnected = FakeSocket.instances[1]
    act(() => reconnected.emit('message', { data: JSON.stringify({ type: 'connected', version: 1 }) }))

    expect(JSON.parse(reconnected.send.mock.calls[0][0])).toEqual(request)
    expect(screen.getAllByText('Reassign A')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    expect(screen.getByLabelText('Request a plan change')).toBeDisabled()
    expect(onOperation).toHaveBeenLastCalledWith(true)
    await act(() => vi.advanceTimersByTimeAsync(30000))
    expect(FakeSocket.instances).toHaveLength(2)
  })

  it('automatically reconnects and replays the same interrupted request once', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', FakeSocket)
    const onPlan = vi.fn()
    const onOperation = vi.fn()
    render(<PlanChat project={project} onPlan={onPlan} onOperation={onOperation} />)
    const first = FakeSocket.instances[0]
    act(() => first.emit('message', { data: JSON.stringify({ type: 'connected', version: 1 }) }))
    fireEvent.change(screen.getByLabelText('Request a plan change'), { target: { value: 'Reassign A' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }))
    expect(first.send).toHaveBeenCalledOnce()
    const request = JSON.parse(first.send.mock.calls[0][0])
    expect(screen.getAllByText('Reassign A')).toHaveLength(1)

    act(() => first.emit('close', { code: 1006 }))
    expect(onOperation).toHaveBeenLastCalledWith(true)
    await act(() => vi.advanceTimersByTimeAsync(1000))
    const reconnected = FakeSocket.instances[1]
    act(() => reconnected.emit('open', {}))
    act(() => reconnected.emit('message', { data: JSON.stringify({ type: 'connected', version: 2 }) }))

    expect(reconnected.send).toHaveBeenCalledTimes(2)
    expect(JSON.parse(reconnected.send.mock.calls[0][0])).toEqual({ type: 'auth', token: 'secret-token' })
    expect(JSON.parse(reconnected.send.mock.calls[1][0])).toEqual(request)
    expect(screen.getByLabelText('Request a plan change')).toBeDisabled()
    act(() => first.emit('message', { data: JSON.stringify({ type: 'complete', request_id: request.request_id, version: 2, plan: { tasks: [task] }, message: 'stale' }) }))
    expect(onPlan).not.toHaveBeenCalled()
    act(() => reconnected.emit('message', { data: JSON.stringify({ type: 'complete', request_id: request.request_id, version: 2, plan: { tasks: [task] }, message: 'Recovered' }) }))
    expect(onPlan).toHaveBeenCalledOnce()
    expect(onOperation).toHaveBeenLastCalledWith(false)
  })

  it('reconnects after an uncorrelated malformed frame without dropping the pending request', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', FakeSocket)
    const onOperation = vi.fn()
    const onPlan = vi.fn()
    render(<PlanChat project={project} onPlan={onPlan} onOperation={onOperation} />)
    const first = FakeSocket.instances[0]
    act(() => first.emit('message', { data: JSON.stringify({ type: 'connected', version: 1 }) }))
    fireEvent.change(screen.getByLabelText('Request a plan change'), { target: { value: 'Reassign A' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }))
    const request = JSON.parse(first.send.mock.calls[0][0])

    act(() => first.emit('message', { data: '{malformed' }))
    expect(first.close).toHaveBeenCalledOnce()
    expect(onOperation).toHaveBeenLastCalledWith(true)
    expect(screen.getAllByText('Reassign A')).toHaveLength(1)
    act(() => first.emit('close', { code: 1002 }))
    await act(() => vi.advanceTimersByTimeAsync(1000))
    const reconnected = FakeSocket.instances[1]
    act(() => reconnected.emit('open', {}))
    act(() => reconnected.emit('message', { data: JSON.stringify({ type: 'connected', version: 1 }) }))
    expect(JSON.parse(reconnected.send.mock.calls[1][0])).toEqual(request)

    act(() => reconnected.emit('message', { data: JSON.stringify({ type: 'complete', request_id: request.request_id, version: 2, plan: { tasks: [task] }, message: 'Recovered' }) }))
    expect(onPlan).toHaveBeenCalledOnce()
    expect(onOperation).toHaveBeenLastCalledWith(false)
  })

  it('does not replay after terminal authentication failure', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', FakeSocket)
    const onOperation = vi.fn()
    render(<PlanChat project={project} onPlan={vi.fn()} onOperation={onOperation} />)
    const socket = FakeSocket.instances[0]
    act(() => socket.emit('message', { data: JSON.stringify({ type: 'connected', version: 1 }) }))
    fireEvent.change(screen.getByLabelText('Request a plan change'), { target: { value: 'Reassign A' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }))
    act(() => socket.emit('close', { code: 4401 }))
    await act(() => vi.advanceTimersByTimeAsync(30000))
    expect(FakeSocket.instances).toHaveLength(1)
    expect(onOperation).toHaveBeenLastCalledWith(false)
  })

  it('drops an interrupted request on component cleanup', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', FakeSocket)
    const onOperation = vi.fn()
    const view = render(<PlanChat project={project} onPlan={vi.fn()} onOperation={onOperation} />)
    const socket = FakeSocket.instances[0]
    act(() => socket.emit('message', { data: JSON.stringify({ type: 'connected', version: 1 }) }))
    fireEvent.change(screen.getByLabelText('Request a plan change'), { target: { value: 'Reassign A' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }))
    act(() => socket.emit('close', { code: 1006 }))
    view.unmount()
    await act(() => vi.advanceTimersByTimeAsync(30000))
    expect(FakeSocket.instances).toHaveLength(1)
    expect(onOperation).toHaveBeenLastCalledWith(false)
  })

  it('keeps the composer disabled when the server advanced during disconnect', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', FakeSocket)
    render(<PlanChat project={project} onPlan={vi.fn()} />)
    act(() => FakeSocket.instances[0].emit('close', { code: 1006 }))
    await act(() => vi.advanceTimersByTimeAsync(1000))
    act(() => FakeSocket.instances[1].emit('message', { data: JSON.stringify({ type: 'connected', version: 2 }) }))

    expect(screen.getByRole('alert')).toHaveTextContent('newer plan')
    expect(screen.getByLabelText('Request a plan change')).toBeDisabled()
    expect(FakeSocket.instances[1].send).not.toHaveBeenCalled()
  })

  it('backs off failed reconnects and stops after cleanup or rejected auth', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('WebSocket', FakeSocket)
    const view = render(<PlanChat project={project} onPlan={vi.fn()} />)
    act(() => FakeSocket.instances[0].emit('message', { data: JSON.stringify({ type: 'connected', version: 1 }) }))
    fireEvent.change(screen.getByLabelText('Request a plan change'), { target: { value: 'Keep retrying' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }))
    const request = JSON.parse(FakeSocket.instances[0].send.mock.calls[0][0])
    act(() => FakeSocket.instances[0].emit('close', { code: 1006 }))
    await act(() => vi.advanceTimersByTimeAsync(1000))
    act(() => FakeSocket.instances[1].emit('close', { code: 1006 }))
    await act(() => vi.advanceTimersByTimeAsync(1999))
    expect(FakeSocket.instances).toHaveLength(2)
    await act(() => vi.advanceTimersByTimeAsync(1))
    expect(FakeSocket.instances).toHaveLength(3)

    act(() => FakeSocket.instances[2].emit('open', {}))
    act(() => FakeSocket.instances[2].emit('message', { data: JSON.stringify({ type: 'connected', version: 1 }) }))
    expect(JSON.parse(FakeSocket.instances[2].send.mock.calls[1][0])).toEqual(request)
    act(() => FakeSocket.instances[2].emit('close', { code: 4408 }))
    await act(() => vi.advanceTimersByTimeAsync(30000))
    expect(FakeSocket.instances).toHaveLength(3)
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(FakeSocket.instances).toHaveLength(4)
    act(() => FakeSocket.instances[3].emit('close', { code: 1006 }))
    view.unmount()
    await act(() => vi.advanceTimersByTimeAsync(30000))
    expect(FakeSocket.instances).toHaveLength(4)
  })
})
