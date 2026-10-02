import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'

const plan = { tasks: [{ id: 'one', task: 'First task', description: '', assignee: 'Maya', duration: 2, start_date: '2026-10-05', end_date: '2026-10-06', predecessors: [] }, { id: 'two', task: 'Second task', description: '', assignee: 'Leo', duration: 1, start_date: '2026-10-07', end_date: '2026-10-07', predecessors: ['one'] }] }

function openImport() {
  fireEvent.click(screen.getByRole('button', { name: 'Import' }))
}

function submitNewProject(name = 'New workspace project') {
  fireEvent.click(screen.getByRole('button', { name: 'New project' }))
  fireEvent.change(screen.getByLabelText('Project name'), { target: { value: name } })
  fireEvent.click(screen.getByRole('button', { name: 'Create project' }))
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

  it('shows server-provided workspace load errors inside the localized error shell', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false, status: 422, json: async () => ({ detail: 'Server workspace detail' }),
    })
    render(<App />)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('We could not load the plan.')
    expect(alert).toHaveTextContent('Server workspace detail')
  })

  it('replaces a stale workspace token while loading', async () => {
    localStorage.setItem('ganttai.workspaceToken', 'stale-token')
    const replacement = { project_id: 'p1', project_name: 'Intro', conversation_id: 'c1', workspace_token: 'fresh-token', version: 1, plan, messages: [] }
    const fetch = vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({ detail: 'Workspace not found.' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => replacement })

    render(<App />)

    expect((await screen.findAllByText('First task')).length).toBeGreaterThan(0)
    expect(fetch.mock.calls[0][0]).toContain('/api/workspace')
    expect(fetch.mock.calls[0][1].headers).toEqual({ 'X-Workspace-Token': 'stale-token' })
    expect(fetch.mock.calls[1][0]).toContain('/api/projects')
    expect(fetch.mock.calls[1][1].headers).toBeUndefined()
    expect(localStorage.getItem('ganttai.workspaceToken')).toBe('fresh-token')
  })

  it('keeps an empty plan usable', async () => {
    const fetch = vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ project_id: 'p1', project_name: 'Empty', conversation_id: 'c1', workspace_token: 'token', version: 2, plan: { tasks: [] }, messages: [] }) })
    render(<App />)
    expect(await screen.findByText('No tasks in this plan')).toBeInTheDocument()
    const resetButton = screen.getByRole('button', { name: 'Reset' })
    const undoButton = screen.getByRole('button', { name: 'Undo' })
    expect(resetButton.nextElementSibling).toBe(screen.getByRole('button', { name: 'Add task' }))
    expect(resetButton.nextElementSibling.nextElementSibling).toBe(undoButton)
    expect(undoButton).toBeEnabled()
    fireEvent.click(undoButton)
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
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
    expect(screen.getByRole('button', { name: 'Reset' })).toBeInTheDocument()
    expect(container.querySelector('.timeline-scroll')).toBeInTheDocument()
  })

  it('keeps a broad, many-task plan aligned and editable', async () => {
    const tasks = Array.from({ length: 24 }, (_, index) => {
      const dayOffset = index + (index >= 2 ? 3 : 0)
      const start = new Date(Date.UTC(2026, 0, 1 + dayOffset))
      const end = new Date(Date.UTC(2026, 0, 1 + dayOffset))
      return { id: `task-${index}`, task: `Task ${index + 1}`, description: '', assignee: `Owner ${index + 1}`, duration: 1, start_date: start.toISOString().slice(0, 10), end_date: end.toISOString().slice(0, 10), predecessors: index ? [`task-${index - 1}`] : [] }
    })
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ project_id: 'wide-plan', project_name: 'Wide', conversation_id: 'c1', workspace_token: 'token', version: 1, plan: { tasks }, messages: [] }) })
    const { container } = render(<App />)
    await screen.findAllByText('Task 24')
    expect(container.querySelectorAll('.task-table .task-row')).toHaveLength(24)
    expect(container.querySelectorAll('.plot .task-bar')).toHaveLength(24)
    expect(container.querySelector('.task-table')).toBeInTheDocument()
    const scroll = container.querySelector('.timeline-scroll')
    const dateCell = container.querySelector('.date-cell')
    const secondGridLine = container.querySelectorAll('.grid-lines i')[1]
    const [firstBar, secondBar, thirdBar] = container.querySelectorAll('.task-bar')
    const [firstDependency, secondDependency] = container.querySelectorAll('.dependency')
    const firstDependencyTarget = firstDependency.querySelector('.dependency-target')
    const firstDependencySource = firstDependency.querySelector('.dependency-source')
    const initialGeometry = {
      dayWidth: parseFloat(dateCell.style.width),
      gridLeft: parseFloat(secondGridLine.style.left),
      firstBarRight: parseFloat(firstBar.style.left) + parseFloat(firstBar.style.width),
      barLeft: parseFloat(secondBar.style.left),
      dependency: firstDependencyTarget.getAttribute('d'),
    }
    expect(initialGeometry.gridLeft).toBe(initialGeometry.dayWidth)
    expect(initialGeometry.barLeft).toBe(initialGeometry.dayWidth + 5)
    expect(initialGeometry.dependency).toBe(`M ${initialGeometry.firstBarRight} 24 C ${initialGeometry.firstBarRight + 20} 24, ${initialGeometry.barLeft - 20} 72, ${initialGeometry.barLeft} 72`)
    expect(firstDependencySource.getAttribute('d')).toBe(initialGeometry.dependency)
    expect(firstDependencySource.style.stroke).toBe('rgb(35, 118, 216)')
    expect(firstDependencyTarget.style.stroke).toBe('rgb(157, 119, 238)')
    expect(firstDependencySource).toHaveAttribute('stroke-dasharray', '6 6')
    expect(firstDependencySource).toHaveAttribute('stroke-linecap', 'butt')
    expect(container.querySelector('marker')).not.toBeInTheDocument()
    const secondBarRight = parseFloat(secondBar.style.left) + parseFloat(secondBar.style.width)
    const thirdBarLeft = parseFloat(thirdBar.style.left)
    const wideCurve = (thirdBarLeft - secondBarRight) / 2 + 8
    expect(secondDependency.querySelector('.dependency-target').getAttribute('d')).toBe(`M ${secondBarRight} 72 C ${secondBarRight + wideCurve} 72, ${thirdBarLeft - wideCurve} 120, ${thirdBarLeft} 120`)
    expect(secondBarRight + wideCurve).toBeGreaterThan(thirdBarLeft - wideCurve)
    scroll.scrollLeft = 700
    fireEvent.scroll(scroll)
    const originalWidth = parseInt(container.querySelector('.timeline').style.minWidth, 10)
    expect(originalWidth).toBeGreaterThan(1500)
    fireEvent.keyDown(screen.getByRole('separator', { name: 'Task table and timeline boundary' }), { key: 'ArrowRight', shiftKey: true })
    expect(parseInt(container.querySelector('.timeline').style.minWidth, 10)).toBe(originalWidth + 24)
    expect(scroll.scrollLeft).toBe(700)
    expect(parseFloat(dateCell.style.width)).toBe(initialGeometry.dayWidth)
    expect(parseFloat(secondBar.style.left)).toBe(initialGeometry.barLeft)
    expect(firstDependencyTarget.getAttribute('d')).toBe(initialGeometry.dependency)
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }))
    const zoomedDayWidth = parseFloat(dateCell.style.width)
    expect(scroll.scrollLeft).toBe(700)
    expect(zoomedDayWidth).toBe(39)
    expect(parseFloat(secondGridLine.style.left)).toBe(zoomedDayWidth)
    expect(parseFloat(secondBar.style.left)).toBe(zoomedDayWidth + 5)
    const zoomedFirstBarRight = parseFloat(firstBar.style.left) + parseFloat(firstBar.style.width)
    const zoomedSecondBarLeft = parseFloat(secondBar.style.left)
    expect(firstDependencyTarget.getAttribute('d')).toBe(`M ${zoomedFirstBarRight} 24 C ${zoomedFirstBarRight + 20} 24, ${zoomedSecondBarLeft - 20} 72, ${zoomedSecondBarLeft} 72`)
    expect(parseFloat(container.querySelectorAll('.task-bar')[23].style.top)).toBe(23 * 48 + 12)
    fireEvent.click(screen.getByRole('button', { name: 'Edit Task 24 details' }))
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Edit task')
  })

  it('resizes all desktop boundaries with pointer and keyboard controls', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => plan })
    const { container } = render(<App />)
    await screen.findAllByText('First task')
    const workspace = screen.getByRole('separator', { name: 'Plan and AI assistant boundary' })
    const table = screen.getByRole('separator', { name: 'Task table and timeline boundary' })
    const owner = screen.getByRole('separator', { name: 'Task and owner boundary' })

    fireEvent.keyDown(table, { key: 'ArrowRight', shiftKey: true })
    expect(table).toHaveAttribute('aria-valuenow', '334')
    expect(container.querySelector('.timeline').style.getPropertyValue('--task-column')).toBe('334px')
    fireEvent.pointerDown(owner, { button: 0, clientX: 200 })
    fireEvent.pointerMove(window, { clientX: 240 })
    fireEvent.pointerUp(window)
    expect(owner).toHaveAttribute('aria-valuenow', '234')
    owner.focus()
    fireEvent.keyDown(owner, { key: ' ' })
    expect(owner).toHaveAttribute('aria-valuenow', '200')
    fireEvent.keyDown(workspace, { key: 'ArrowRight' })
    expect(workspace).toHaveAttribute('aria-valuenow', '332')
    expect(document.body).not.toHaveClass('is-resizing')
  })

  it('clamps, resets, and restores versioned column preferences', async () => {
    localStorage.setItem('ganttai.columnWidths.v1', JSON.stringify({ version: 1, widths: { assistant: 999, taskTable: 420, taskName: 999 } }))
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => plan })
    const { unmount } = render(<App />)
    await screen.findAllByText('First task')
    const table = screen.getByRole('separator', { name: 'Task table and timeline boundary' })
    const owner = screen.getByRole('separator', { name: 'Task and owner boundary' })
    expect(table).toHaveAttribute('aria-valuenow', '300')
    expect(table).toHaveAttribute('aria-valuemax', '300')
    expect(owner).toHaveAttribute('aria-valuenow', '200')
    fireEvent.keyDown(table, { key: 'End' })
    expect(table).toHaveAttribute('aria-valuenow', '300')
    table.focus()
    fireEvent.keyDown(table, { key: 'Enter' })
    expect(table).toHaveAttribute('aria-valuenow', '300')
    unmount()
    render(<App />)
    await screen.findAllByText('First task')
    expect(screen.getByRole('separator', { name: 'Task table and timeline boundary' })).toHaveAttribute('aria-valuenow', '300')
  })

  it('reserves timeline space at the desktop breakpoint', async () => {
    const desktopWidth = window.innerWidth
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 821 })
    localStorage.setItem('ganttai.columnWidths.v1', JSON.stringify({ version: 1, widths: { assistant: 600, taskTable: 600, taskName: 500 } }))
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => plan })
    render(<App />)
    await screen.findAllByText('First task')
    const table = screen.getByRole('separator', { name: 'Task table and timeline boundary' })
    expect(table).toHaveAttribute('aria-valuemax', '300')
    expect(table).toHaveAttribute('aria-valuenow', '300')
    expect(screen.getByRole('separator', { name: 'Task and owner boundary' })).toHaveAttribute('aria-valuenow', '200')
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: desktopWidth })
  })

  it('discards malformed column preferences', async () => {
    localStorage.setItem('ganttai.columnWidths.v1', '{bad json')
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => plan })
    render(<App />)
    await screen.findAllByText('First task')
    expect(screen.getByRole('separator', { name: 'Task table and timeline boundary' })).toHaveAttribute('aria-valuenow', '310')
  })

  it('normalizes mobile defaults when the viewport expands to desktop', async () => {
    const desktopWidth = window.innerWidth
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 520 })
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => plan })
    render(<App />)
    await screen.findAllByText('First task')
    expect(screen.queryByRole('separator')).not.toBeInTheDocument()
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 })
    fireEvent(window, new Event('resize'))
    expect(await screen.findByRole('separator', { name: 'Task table and timeline boundary' })).toHaveAttribute('aria-valuenow', '260')
    expect(screen.getByRole('separator', { name: 'Task and owner boundary' })).toHaveAttribute('aria-valuenow', '140')
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: desktopWidth })
  })

  it('switches mobile surfaces without losing the assistant draft', async () => {
    const desktopWidth = window.innerWidth
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 820 })
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
      project_id: 'p1', project_name: 'Intro', conversation_id: 'c1', workspace_token: 'token', version: 1, plan, messages: [],
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
    expect(screen.queryByRole('separator')).not.toBeInTheDocument()
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: desktopWidth })
  })

  it('stacks an operation error with rejected-record feedback', async () => {
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => ({ tasks: [plan.tasks[0], { id: 'bad', task: '', duration: -1, start_date: 'bad', end_date: 'bad', predecessors: [] }] }) })
      .mockRejectedValueOnce(new Error('offline'))
    const { container } = render(<App />)
    await screen.findByText(/invalid task record/)
    submitNewProject()
    await screen.findByText(/Cannot reach the Plan API/)
    expect(screen.getAllByRole('alert')).toHaveLength(2)
    expect(screen.getByLabelText('Project name')).toHaveValue('New workspace project')
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
    expect(screen.getByLabelText('Task dependencies').querySelectorAll('.dependency')).toHaveLength(1)
    expect(screen.getByLabelText('Task dependencies').querySelectorAll('.dependency path')).toHaveLength(2)
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
      project_id: 'p1', project_name: 'Intro', conversation_id: 'c1', workspace_token: 'token', version: 1, plan, messages: [],
    }) })
    render(<App />)
    await screen.findAllByText('First task')
    await waitFor(() => expect(Socket.instance).toBeDefined())
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
    const first = { project_id: 'p1', project_name: 'First', conversation_id: 'c1', workspace_token: 'workspace-token', version: 1, plan, messages: [] }
    const secondPlan = { tasks: [] }
    const second = { project_id: 'p2', project_name: 'Second', conversation_id: 'c2', workspace_token: 'workspace-token', version: 1, plan: secondPlan, messages: [] }
    const fetch = vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => first })
      .mockResolvedValueOnce({ ok: true, json: async () => second })
      .mockResolvedValueOnce({ ok: true, json: async () => first })

    render(<App />)
    await screen.findAllByText('First task')
    submitNewProject('Second')
    expect(await screen.findByRole('heading', { level: 1, name: 'Second' })).toBeInTheDocument()
    expect(screen.getByText('No tasks in this plan')).toBeInTheDocument()
    expect(fetch.mock.calls[1][1].headers).toEqual({ 'Content-Type': 'application/json', 'X-Workspace-Token': 'workspace-token' })
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ name: 'Second' })
    expect(localStorage.getItem('ganttai.workspaceToken')).toBe('workspace-token')

    fireEvent.change(screen.getByLabelText('Active project'), { target: { value: 'p1' } })
    expect((await screen.findAllByText('First task')).length).toBeGreaterThan(0)
    expect(fetch.mock.calls[2][0]).toContain('/api/projects/p1')
  })

  it('preserves a stale workspace and named-project draft when creation returns 404', async () => {
    const first = { project_id: 'p1', project_name: 'First', conversation_id: 'c1', workspace_token: 'stale-token', version: 1, plan, messages: [] }
    const fetch = vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => first })
      .mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({ detail: 'Workspace not found.' }) })

    render(<App />)
    await screen.findAllByText('First task')
    submitNewProject('Second')

    expect(await screen.findByRole('alert')).toHaveTextContent('Workspace not found')
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch.mock.calls[1][1].headers).toEqual({ 'Content-Type': 'application/json', 'X-Workspace-Token': 'stale-token' })
    expect(localStorage.getItem('ganttai.workspaceToken')).toBe('stale-token')
    expect(screen.getByLabelText('Project name')).toHaveValue('Second')
    expect(screen.getByRole('heading', { level: 1, name: 'First' })).toBeInTheDocument()
  })

  it('renames project metadata and preserves the version', async () => {
    const project = { project_id: 'p1', project_name: 'First', conversation_id: 'c1', workspace_token: 'token', version: 2, plan, messages: [] }
    const renamed = { ...project, project_name: 'Delivery' }
    const fetch = vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => project })
      .mockResolvedValueOnce({ ok: true, json: async () => renamed })
    render(<App />)
    await screen.findAllByText('First task')
    fireEvent.click(screen.getByRole('button', { name: 'Rename project' }))
    expect(screen.getByLabelText('Project name')).not.toHaveAttribute('maxlength')
    fireEvent.change(screen.getByLabelText('Project name'), { target: { value: '  Delivery  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Delivery' })).toBeInTheDocument()
    expect(screen.getByText('2 tasks · version 2')).toBeInTheDocument()
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ name: 'Delivery' })
  })

  it('keeps a project rename draft after a request failure', async () => {
    const project = { project_id: 'p1', project_name: 'First', conversation_id: 'c1', workspace_token: 'token', version: 2, plan, messages: [] }
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => project })
      .mockRejectedValueOnce(new Error('offline'))
    render(<App />)
    await screen.findAllByText('First task')
    fireEvent.click(screen.getByRole('button', { name: 'Rename project' }))
    fireEvent.change(screen.getByLabelText('Project name'), { target: { value: 'Unfinished rename' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Cannot reach')
    expect(screen.getByLabelText('Project name')).toHaveValue('Unfinished rename')
    expect(screen.getByRole('heading', { level: 1, name: 'First' })).toBeInTheDocument()
  })

  it('cancels deletion and preserves state when confirmed deletion fails', async () => {
    const project = { project_id: 'p1', project_name: 'First', conversation_id: 'c1', workspace_token: 'token', version: 1, plan, messages: [] }
    const fetch = vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => project })
      .mockRejectedValueOnce(new Error('offline'))
    render(<App />)
    await screen.findAllByText('First task')
    fireEvent.click(screen.getByRole('button', { name: 'Delete project' }))
    const warning = screen.getByText(/tasks, versions, and chat history/)
    expect(screen.getByRole('alertdialog')).toHaveAttribute('aria-describedby', warning.id)
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(fetch).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Delete project' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Cannot reach')
    expect(screen.getAllByText('First task').length).toBeGreaterThan(0)
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  })

  it('deletes the current project and opens the returned replacement', async () => {
    const project = { project_id: 'p1', project_name: 'First', conversation_id: 'c1', workspace_token: 'token', version: 1, plan, messages: [] }
    const replacement = { project_id: 'p2', project_name: 'Ознакомительный проект', conversation_id: 'c2', version: 1, plan, messages: [] }
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => project })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ active_project: replacement, projects: [
        { project_id: 'p2', project_name: 'Ознакомительный проект', version: 1, created_at: '2026-10-02' },
      ] }) })
    render(<App />)
    await screen.findAllByText('First task')
    fireEvent.click(screen.getByRole('button', { name: 'Delete project' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Ознакомительный проект' })).toBeInTheDocument()
    expect(screen.getByLabelText('Active project')).toHaveValue('p2')
  })

  it('creates a manual task as exactly one new project version', async () => {
    const project = { project_id: 'p1', project_name: 'First', conversation_id: 'c1', workspace_token: 'token', version: 1, plan, messages: [] }
    const created = { ...project, version: 2, plan: { tasks: [...plan.tasks, {
      id: 'server-id', task: 'Manual task', description: '', assignee: 'Priya', duration: 1,
      start_date: '2026-10-07', end_date: '2026-10-07', predecessors: ['one'],
    }] } }
    const fetch = vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => project })
      .mockResolvedValueOnce({ ok: true, json: async () => created })
    render(<App />)
    await screen.findAllByText('First task')
    fireEvent.click(screen.getByRole('button', { name: 'Add task' }))
    expect(screen.getByLabelText('Start date')).toHaveValue('2026-10-05')
    fireEvent.change(screen.getByLabelText('Task name'), { target: { value: 'Manual task' } })
    fireEvent.change(screen.getByLabelText('Assignee'), { target: { value: 'Priya' } })
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-10-07' } })
    fireEvent.click(screen.getByLabelText('First task'))
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }))
    expect((await screen.findAllByText('Manual task')).length).toBeGreaterThan(0)
    expect(fetch.mock.calls[1][0]).toContain('/api/projects/p1/tasks')
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual(expect.objectContaining({ expected_version: 1, predecessors: ['one'] }))
    expect(screen.getByText('3 tasks · version 2')).toBeInTheDocument()
  })

  it('keeps a manual task draft and chart after a version conflict', async () => {
    const project = { project_id: 'p1', project_name: 'First', conversation_id: 'c1', workspace_token: 'token', version: 1, plan, messages: [] }
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => project })
      .mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ detail: 'The plan changed while the task was being saved.' }) })
    render(<App />)
    await screen.findAllByText('First task')
    fireEvent.click(screen.getByRole('button', { name: 'Add task' }))
    fireEvent.change(screen.getByLabelText('Task name'), { target: { value: 'Unfinished task' } })
    fireEvent.change(screen.getByLabelText('Assignee'), { target: { value: 'Priya' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create task' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('plan changed')
    expect(screen.getByLabelText('Task name')).toHaveValue('Unfinished task')
    expect(screen.getByText('2 tasks · version 1')).toBeInTheDocument()
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
    const active = { project_id: 'p1', project_name: 'First', conversation_id: 'c1', version: 2, plan, messages: [] }
    const undone = { ...active, version: 3 }
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce({ ok: true, json: async () => ({ active_project: active, projects: [
        { project_id: 'p1', project_name: 'First', version: 2, created_at: '2026-09-30' },
        { project_id: 'p2', project_name: 'Second', version: 1, created_at: '2026-09-30' },
      ] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => undone })

    render(<App />)
    await screen.findAllByText('First task')
    const newProjectButton = screen.getByRole('button', { name: 'New project' })
    const undoButton = screen.getByRole('button', { name: 'Undo' })
    expect(newProjectButton).toHaveTextContent('＋')
    expect(newProjectButton).not.toHaveTextContent('New project')
    expect(undoButton).toHaveTextContent('↶')
    expect(undoButton).not.toHaveTextContent('Undo')
    const resetButton = screen.getByRole('button', { name: 'Reset' })
    expect(undoButton.parentElement).toHaveClass('chart-controls')
    expect(resetButton.nextElementSibling).toBe(screen.getByRole('button', { name: 'Add task' }))
    expect(resetButton.nextElementSibling.nextElementSibling).toBe(undoButton)
    fireEvent.click(undoButton)
    await waitFor(() => expect(screen.getByLabelText('Active project')).toHaveValue('p1'))
    expect(screen.getByLabelText('Active project').querySelectorAll('option')).toHaveLength(2)
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
    const project = { project_id: 'p1', project_name: 'Intro', conversation_id: 'c1', workspace_token: 'token', version: 1, plan, messages: [] }
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
    const project = { project_id: 'p1', project_name: 'Intro', conversation_id: 'c1', workspace_token: 'token', version: 1, plan, messages: [] }
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
    const project = { project_id: 'p1', project_name: 'Intro', conversation_id: 'c1', workspace_token: 'token', version: 1, plan, messages: [] }
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
    const project = { project_id: 'p1', project_name: 'Intro', conversation_id: 'c1', workspace_token: 'token', version: 1, plan, messages: [] }
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => project })
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit First task details' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    act(() => Socket.instance.emit({ type: 'complete', version: 2, plan: { tasks: [{ ...plan.tasks[1], predecessors: [] }] }, message: 'Removed first task.' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Edit First task details' })).not.toBeInTheDocument()
  })
})
