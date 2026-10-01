import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TaskDetailsModal } from './components/TaskDetailsModal'

const tasks = [
  { id: 'one', task: 'Research', description: 'Study users', assignee: 'Maya', duration: 2, start_date: '2026-10-05', end_date: '2026-10-06', predecessors: [] },
  { id: 'two', task: 'Prototype', description: 'Build it', assignee: 'Leo', duration: 3, start_date: '2026-10-07', end_date: '2026-10-09', predecessors: ['one'] },
]

afterEach(cleanup)

describe('task details modal', () => {
  it('shows all details, named predecessors, and derives the end date', () => {
    render(<TaskDetailsModal task={tasks[1]} tasks={tasks} onClose={vi.fn()} onSave={vi.fn()} />)
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Edit task')
    expect(screen.getByLabelText('Task name')).toHaveValue('Prototype')
    expect(screen.getByLabelText('Description')).toHaveValue('Build it')
    expect(screen.getByLabelText('Assignee')).toHaveValue('Leo')
    expect(screen.getByLabelText('Research')).toBeChecked()
    expect(screen.queryByLabelText('Prototype')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Duration (days)'), { target: { value: '5' } })
    expect(screen.getByLabelText('End date')).toHaveValue('2026-10-11')
  })

  it.each(['cancel', 'escape', 'backdrop'])('closes without saving via %s', async (method) => {
    const onClose = vi.fn()
    const onSave = vi.fn()
    render(<TaskDetailsModal task={tasks[1]} tasks={tasks} onClose={onClose} onSave={onSave} />)
    if (method === 'cancel') fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    if (method === 'escape') fireEvent.keyDown(document, { key: 'Escape' })
    if (method === 'backdrop') fireEvent.mouseDown(screen.getByRole('dialog').parentElement)
    expect(onClose).toHaveBeenCalledOnce()
    expect(onSave).not.toHaveBeenCalled()
  })

  it('validates locally, preserves input after a server error, and submits IDs', async () => {
    const user = userEvent.setup()
    const serverError = Object.assign(new Error('The plan changed while the task was being saved.'), {
      serverProvided: true, serverMessage: 'The plan changed while the task was being saved.',
    })
    const onSave = vi.fn().mockRejectedValue(serverError)
    render(<TaskDetailsModal task={tasks[1]} tasks={tasks} onClose={vi.fn()} onSave={onSave} />)
    await user.clear(screen.getByLabelText('Task name'))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Task name is required')
    expect(onSave).not.toHaveBeenCalled()
    await user.type(screen.getByLabelText('Task name'), 'Working prototype')
    await user.click(screen.getByLabelText('Research'))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('plan changed')
    expect(screen.getByLabelText('Task name')).toHaveValue('Working prototype')
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ task: 'Working prototype', predecessors: [] }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled())
  })

  it('uses the localized fallback for an untagged save exception', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('internal parser detail'))
    render(<TaskDetailsModal task={tasks[0]} tasks={tasks} onClose={vi.fn()} onSave={onSave} />)
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('The task could not be saved')
    expect(alert).not.toHaveTextContent('internal parser detail')
  })
})
