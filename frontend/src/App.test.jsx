import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'

const plan = { tasks: [{ id: 'one', task: 'First task', description: '', assignee: 'Maya', duration: 2, start_date: '2026-10-05', end_date: '2026-10-06', predecessors: [] }, { id: 'two', task: 'Second task', description: '', assignee: 'Leo', duration: 1, start_date: '2026-10-07', end_date: '2026-10-07', predecessors: ['one'] }] }

function openImport() {
  fireEvent.click(screen.getByRole('button', { name: 'Import' }))
}

beforeEach(() => { vi.restoreAllMocks(); localStorage.clear() })
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

  it('keeps a broad, many-task plan aligned and editable', async () => {
    const tasks = Array.from({ length: 24 }, (_, index) => {
      const start = new Date(Date.UTC(2026, 0, 1 + index))
      const end = new Date(Date.UTC(2026, 0, 1 + index))
      return { id: `task-${index}`, task: `Task ${index + 1}`, description: '', assignee: `Owner ${index + 1}`, duration: 1, start_date: start.toISOString().slice(0, 10), end_date: end.toISOString().slice(0, 10), predecessors: [] }
    })
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ project_id: 'wide-plan', conversation_id: 'c1', workspace_token: 'token', version: 1, plan: { tasks }, messages: [] }) })
    const { container } = render(<App />)
    await screen.findAllByText('Task 24')
    expect(container.querySelectorAll('.task-table .task-row')).toHaveLength(24)
    expect(container.querySelectorAll('.plot .task-bar')).toHaveLength(24)
    expect(container.querySelector('.task-table')).toBeInTheDocument()
    expect(parseInt(container.querySelector('.timeline').style.minWidth, 10)).toBeGreaterThan(1500)
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Edit Task 24 details' }))
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Edit task')
  })

  it('switches mobile surfaces without losing the assistant draft', async () => {
    class Socket {
      static instance
      constructor() { this.listeners = {}; Socket.instance = this }
      addEventListener(name, callback) { this.listeners[name] = callback }
      send() {}
      close() {}
      emit(payload) { this.listeners.message({ data: JSON.stringify(payload) }) }
    }
    vi.stubGlobal('WebSocket', Socket)
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({
      project_id: 'p1', conversation_id: 'c1', workspace_token: 'token', version: 1, plan, messages: [],
    }) })
    const { container } = render(<App />)
    await screen.findAllByText('First task')
    act(() => Socket.instance.emit({ type: 'connected', version: 1 }))
    fireEvent.click(screen.getByRole('tab', { name: 'AI assistant' }))
    expect(screen.getByRole('tablist', { name: 'Workspace surfaces' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'AI assistant' })).toHaveAttribute('aria-controls', 'assistant-panel')
    expect(screen.getByRole('tabpanel', { name: 'AI assistant' })).toHaveAttribute('id', 'assistant-panel')
    fireEvent.change(screen.getByLabelText('Request a plan change'), { target: { value: 'Keep this draft' } })
    fireEvent.click(screen.getByRole('tab', { name: 'Plan' }))
    fireEvent.click(screen.getByRole('tab', { name: 'AI assistant' }))
    expect(screen.getByLabelText('Request a plan change')).toHaveValue('Keep this draft')
    expect(container.querySelector('.workspace-frame')).toHaveClass('mobile-ai')
  })

  it('stacks an operation error with rejected-record feedback', async () => {
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => ({ tasks: [plan.tasks[0], { id: 'bad', task: '', duration: -1, start_date: 'bad', end_date: 'bad', predecessors: [] }] }) })
      .mockRejectedValueOnce(new Error('offline'))
    const { container } = render(<App />)
    await screen.findByText(/invalid task record/)
    fireEvent.click(screen.getByRole('button', { name: 'New project' }))
    await screen.findByText(/Cannot reach the Plan API/)
    expect(container.querySelector('.notice-stack').querySelectorAll('[role="alert"]')).toHaveLength(2)
  })

  it('replaces the chart after upload, exports the displayed plan, and restores the seed on remount', async () => {
    const imported = { tasks: [
      { ...plan.tasks[0], id: 'new-one', task: 'Imported root' },
      { ...plan.tasks[1], id: 'new-two', task: 'Imported successor', predecessors: ['new-one'] },
    ] }
    const fetch = vi.spyOn(global, 'fetch').mockResolvedValueOnce({ ok: true, json: async () => plan }).mockResolvedValueOnce({ ok: true, json: async () => imported }).mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ ok: true, json: async () => plan })
    const { unmount } = render(<App />)
    await screen.findAllByText('First task')
    openImport()
    fireEvent.change(screen.getByLabelText('Import workbook (.xlsx)'), { target: { files: [new File(['xlsx'], 'tasks.xlsx')] } })
    fireEvent.change(screen.getByLabelText('Project start date'), { target: { value: '2026-10-02' } })
    fireEvent.click(screen.getByRole('button', { name: 'Import plan' }))
    expect((await screen.findAllByText('Imported root')).length).toBeGreaterThan(0)
    expect(screen.queryByText('First task')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Task dependencies').querySelectorAll('path[marker-end]')).toHaveLength(1)
    expect(screen.getByText('Imported workspace')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Export Excel' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Cannot reach the Plan API')
    expect(JSON.parse(fetch.mock.calls[2][1].body)).toEqual(imported)
    expect(screen.getAllByText('Imported root').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Export Excel' })).toBeEnabled()
    unmount()
    render(<App />)
    expect((await screen.findAllByText('First task')).length).toBeGreaterThan(0)
    expect(screen.queryByText('Imported root')).not.toBeInTheDocument()
  })

  it.each(['validation', 'network'])('preserves the current chart when import has a %s failure', async (kind) => {
    const fetch = vi.spyOn(global, 'fetch').mockResolvedValueOnce({ ok: true, json: async () => plan })
    if (kind === 'validation') fetch.mockResolvedValueOnce({ ok: false, status: 422, json: async () => ({ detail: { message: "Duplicate task name 'A'; conflicting rows 2 and 3.", row: 3, sheet: 'Tasks', column: 'задача' } }) })
    else fetch.mockRejectedValueOnce(new Error('offline'))
    render(<App />)
    await screen.findAllByText('First task')
    openImport()
    fireEvent.change(screen.getByLabelText('Import workbook (.xlsx)'), { target: { files: [new File(['xlsx'], 'tasks.xlsx')] } })
    fireEvent.change(screen.getByLabelText('Project start date'), { target: { value: '2026-10-02' } })
    fireEvent.click(screen.getByRole('button', { name: 'Import plan' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(kind === 'validation' ? 'conflicting rows 2 and 3' : 'Cannot reach')
    expect(screen.getAllByText('First task').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Second task').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Import plan' })).toBeEnabled()
  })

  it('updates the chart from a versioned chat result and rejects a stale result', async () => {
    class Socket {
      static instance
      constructor() { this.listeners = {}; Socket.instance = this }
      addEventListener(name, callback) { this.listeners[name] = callback }
      send() {}
      close() {}
      emit(payload) { this.listeners.message({ data: JSON.stringify(payload) }) }
    }
    vi.stubGlobal('WebSocket', Socket)
    localStorage.clear()
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({
      project_id: 'p1', conversation_id: 'c1', workspace_token: 'token', version: 1, plan, messages: [],
    }) })
    render(<App />)
    await screen.findAllByText('First task')
    const updated = { ...plan.tasks[0], task: 'Updated by chat' }
    act(() => Socket.instance.emit({ type: 'complete', version: 2, plan: { tasks: [updated, plan.tasks[1]] }, message: 'Updated.' }))
    expect((await screen.findAllByText('Updated by chat')).length).toBeGreaterThan(0)
    act(() => Socket.instance.emit({ type: 'complete', version: 4, plan: { tasks: [{ ...updated, task: 'Stale result' }, plan.tasks[1]] }, message: 'Stale.' }))
    expect(screen.getByRole('alert')).toHaveTextContent('stale chat result was ignored')
    expect(screen.queryByText('Stale result')).not.toBeInTheDocument()
  })

  it('keeps one workspace token while creating and restoring multiple projects', async () => {
    class Socket {
      constructor() { this.listeners = {} }
      addEventListener(name, callback) { this.listeners[name] = callback }
      send() {}
      close() {}
    }
    vi.stubGlobal('WebSocket', Socket)
    const first = { project_id: 'p1', conversation_id: 'c1', workspace_token: 'workspace-token', version: 1, plan, messages: [] }
    const secondPlan = { tasks: [{ ...plan.tasks[0], id: 'other', task: 'Other project' }] }
    const second = { project_id: 'p2', conversation_id: 'c2', workspace_token: 'workspace-token', version: 1, plan: secondPlan, messages: [] }
    const fetch = vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => first })
      .mockResolvedValueOnce({ ok: true, json: async () => second })
      .mockResolvedValueOnce({ ok: true, json: async () => first })

    render(<App />)
    await screen.findAllByText('First task')
    fireEvent.click(screen.getByRole('button', { name: 'New project' }))
    expect((await screen.findAllByText('Other project')).length).toBeGreaterThan(0)
    expect(fetch.mock.calls[1][1].headers).toEqual({ 'X-Workspace-Token': 'workspace-token' })
    expect(localStorage.getItem('ganttai.workspaceToken')).toBe('workspace-token')

    fireEvent.change(screen.getByLabelText('Active project'), { target: { value: 'p1' } })
    expect((await screen.findAllByText('First task')).length).toBeGreaterThan(0)
    expect(fetch.mock.calls[2][0]).toContain('/api/projects/p1')
  })

  it('preserves workspace identity and project choices after undo', async () => {
    class Socket {
      constructor() { this.listeners = {} }
      addEventListener(name, callback) { this.listeners[name] = callback }
      send() {}
      close() {}
    }
    vi.stubGlobal('WebSocket', Socket)
    localStorage.setItem('ganttai.workspaceToken', 'workspace-token')
    const active = { project_id: 'p1', conversation_id: 'c1', version: 2, plan, messages: [] }
    const undone = { ...active, version: 3 }
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => ({ active_project: active, projects: [
        { project_id: 'p1', version: 2, created_at: '2026-09-30' },
        { project_id: 'p2', version: 1, created_at: '2026-09-30' },
      ] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => undone })

    render(<App />)
    await screen.findAllByText('First task')
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(screen.getByLabelText('Active project')).toHaveValue('p1'))
    expect(screen.getAllByRole('option')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled()
  })

  it('does not unlock an Excel import when chat disconnects', async () => {
    class Socket {
      static instance
      constructor() { this.listeners = {}; Socket.instance = this }
      addEventListener(name, callback) { this.listeners[name] = callback }
      send() {}
      close() {}
      disconnect() { this.listeners.close() }
    }
    vi.stubGlobal('WebSocket', Socket)
    let finishImport
    const pendingImport = new Promise((resolve) => { finishImport = resolve })
    const project = { project_id: 'p1', conversation_id: 'c1', workspace_token: 'token', version: 1, plan, messages: [] }
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => project })
      .mockReturnValueOnce(pendingImport)

    render(<App />)
    await screen.findAllByText('First task')
    openImport()
    fireEvent.change(screen.getByLabelText('Import workbook (.xlsx)'), { target: { files: [new File(['xlsx'], 'tasks.xlsx')] } })
    fireEvent.change(screen.getByLabelText('Project start date'), { target: { value: '2026-10-02' } })
    fireEvent.click(screen.getByRole('button', { name: 'Import plan' }))
    expect(screen.getByRole('button', { name: 'New project' })).toBeDisabled()
    act(() => Socket.instance.disconnect())
    expect(screen.getByRole('button', { name: 'New project' })).toBeDisabled()

    finishImport({ ok: true, json: async () => ({ ...project, version: 2 }) })
    await waitFor(() => expect(screen.getByRole('button', { name: 'New project' })).toBeEnabled())
  })

  it('opens from labels and bars, saves one complete edit, and restores focus', async () => {
    const user = userEvent.setup()
    class Socket { constructor() { this.listeners = {} } addEventListener(name, callback) { this.listeners[name] = callback } send() {} close() {} }
    vi.stubGlobal('WebSocket', Socket)
    const project = { project_id: 'p1', conversation_id: 'c1', workspace_token: 'token', version: 1, plan, messages: [] }
    const changed = { ...plan.tasks[1], task: 'Updated task', description: 'More detail', assignee: 'Priya' }
    const fetch = vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => project })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ...project, version: 2, plan: { tasks: [plan.tasks[0], changed] } }) })
    render(<App />)
    const label = await screen.findByRole('button', { name: 'Edit Second task details' })
    label.focus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByLabelText('First task')).toBeChecked()
    fireEvent.change(screen.getByLabelText('Task name'), { target: { value: 'Updated task' } })
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'More detail' } })
    fireEvent.change(screen.getByLabelText('Assignee'), { target: { value: 'Priya' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect((await screen.findAllByText('Updated task')).length).toBeGreaterThan(0)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(fetch.mock.calls[1][0]).toContain('/api/projects/p1/tasks/two')
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual(expect.objectContaining({ expected_version: 1, predecessors: ['one'] }))
    expect(document.activeElement).toHaveAccessibleName('Edit Updated task details')
    fireEvent.click(screen.getByRole('button', { name: 'Edit Updated task timeline bar' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('keeps the chart and modal input after a version conflict', async () => {
    class Socket { constructor() { this.listeners = {} } addEventListener(name, callback) { this.listeners[name] = callback } send() {} close() {} }
    vi.stubGlobal('WebSocket', Socket)
    const project = { project_id: 'p1', conversation_id: 'c1', workspace_token: 'token', version: 1, plan, messages: [] }
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => project })
      .mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ detail: 'The plan changed while the task was being saved.' }) })
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit First task details' }))
    fireEvent.change(screen.getByLabelText('Task name'), { target: { value: 'Unsaved name' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('plan changed')
    expect(screen.getByLabelText('Task name')).toHaveValue('Unsaved name')
    expect(screen.getAllByText('First task').length).toBeGreaterThan(0)
  })

  it('closes a stale selection when chat replaces the plan', async () => {
    class Socket {
      static instance
      constructor() { this.listeners = {}; Socket.instance = this }
      addEventListener(name, callback) { this.listeners[name] = callback }
      send() {}
      close() {}
      emit(payload) { this.listeners.message({ data: JSON.stringify(payload) }) }
    }
    vi.stubGlobal('WebSocket', Socket)
    const project = { project_id: 'p1', conversation_id: 'c1', workspace_token: 'token', version: 1, plan, messages: [] }
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => project })
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit First task details' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    act(() => Socket.instance.emit({ type: 'complete', version: 2, plan: { tasks: [{ ...plan.tasks[1], predecessors: [] }] }, message: 'Removed first task.' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Edit First task details' })).not.toBeInTheDocument()
  })
})
