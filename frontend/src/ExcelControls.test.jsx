import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ExcelControls } from './components/ExcelControls'

const task = { id: 'a', task: 'Imported', description: '', assignee: 'A', duration: 1, start_date: '2026-10-02', end_date: '2026-10-02', predecessors: [] }
const file = new File(['workbook'], 'tasks.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })

function selectFile() {
  fireEvent.click(screen.getByRole('button', { name: 'Import' }))
  fireEvent.change(screen.getByLabelText('Import workbook (.xlsx)'), { target: { files: [file] } })
}

function selectDate() {
  fireEvent.change(screen.getByLabelText('Project start date'), { target: { value: '2026-10-02' } })
}

beforeEach(() => vi.restoreAllMocks())
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })

describe('Excel exchange controls', () => {
  it('requires an explicitly chosen calendar date and cancel makes no request', () => {
    const fetch = vi.spyOn(global, 'fetch')
    const onImport = vi.fn()
    render(<ExcelControls tasks={[task]} onImport={onImport} />)
    selectFile()
    expect(screen.getByRole('button', { name: 'Close import dialog' })).toHaveFocus()
    expect(screen.getByLabelText('Project start date')).toHaveAttribute('type', 'date')
    expect(screen.getByLabelText('Project start date')).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Import plan' })).toBeDisabled()
    expect(screen.getByText(/Supplied start_date and end_date/)).toHaveTextContent('preserved, not rescheduled')
    fireEvent.click(screen.getByRole('button', { name: 'Import plan' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByLabelText('Project start date')).not.toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
    expect(onImport).not.toHaveBeenCalled()
  })

  it('disables all exchange actions during upload and submits a multipart file and date once', async () => {
    let resolve
    const fetch = vi.spyOn(global, 'fetch').mockReturnValue(new Promise((done) => { resolve = done }))
    const onImport = vi.fn()
    render(<ExcelControls tasks={[task]} onImport={onImport} />)
    selectFile()
    selectDate()
    fireEvent.click(screen.getByRole('button', { name: 'Import plan' }))
    expect(screen.getByRole('button', { name: 'Export Excel' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    expect(screen.getByLabelText('Project start date')).toBeDisabled()
    expect(screen.getByLabelText('Import workbook (.xlsx)')).toBeDisabled()
    fireEvent.submit(screen.getByRole('button', { name: 'Importing…' }).closest('form'))
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, options] = fetch.mock.calls[0]
    expect(url).toMatch(/\/api\/plan\/import$/)
    expect(options.body.get('file')).toBe(file)
    expect(options.body.get('start_date')).toBe('2026-10-02')
    resolve({ ok: true, json: async () => ({ tasks: [task] }) })
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Imported 1 task'))
    expect(onImport).toHaveBeenCalledWith([task])
    expect(screen.getByRole('button', { name: 'Export Excel' })).toBeEnabled()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Import' })).toHaveFocus())
  })

  it('allows selecting the same workbook after validation failure and after success', async () => {
    const user = userEvent.setup()
    const fetch = vi.spyOn(global, 'fetch').mockResolvedValueOnce({ ok: false, status: 422, json: async () => ({ detail: { sheet: 'Tasks', row: 3, column: 'длительность', message: 'Use a positive duration.' } }) }).mockResolvedValue({ ok: true, json: async () => ({ tasks: [task] }) })
    const onImport = vi.fn()
    render(<ExcelControls tasks={[]} onImport={onImport} />)
    fireEvent.click(screen.getByRole('button', { name: 'Import' }))
    const input = screen.getByLabelText('Import workbook (.xlsx)')
    await user.upload(input, file)
    selectDate()
    await user.click(screen.getByRole('button', { name: 'Import plan' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Sheet “Tasks”, row 3, column длительность: Use a positive duration.')
    expect(onImport).not.toHaveBeenCalled()
    await user.upload(input, file)
    expect(screen.getByLabelText('Project start date')).toHaveValue('')
    selectDate()
    await user.click(screen.getByRole('button', { name: 'Import plan' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Imported 1 task'))
    await user.upload(input, file)
    expect(screen.getByLabelText('Project start date')).toBeInTheDocument()
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('shows a network error and can retry without losing the selected file', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ ok: true, json: async () => ({ tasks: [task] }) })
    render(<ExcelControls tasks={[]} onImport={vi.fn()} />)
    selectFile()
    selectDate()
    fireEvent.click(screen.getByRole('button', { name: 'Import plan' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Check your connection')
    expect(screen.getByRole('button', { name: 'Import plan' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Import plan' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Imported 1 task'))
  })

  it('rejects a partially invalid API response atomically', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ tasks: [task, { id: 'invalid' }] }) })
    const onImport = vi.fn()
    render(<ExcelControls tasks={[task]} onImport={onImport} />)
    selectFile()
    selectDate()
    fireEvent.click(screen.getByRole('button', { name: 'Import plan' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('current plan has been kept')
    expect(onImport).not.toHaveBeenCalled()
  })

  it('downloads a Blob for the displayed tasks and releases the object URL', async () => {
    const blob = new Blob(['xlsx'])
    let resolve
    const fetch = vi.spyOn(global, 'fetch').mockReturnValue(new Promise((done) => { resolve = done }))
    const create = vi.fn(() => 'blob:download')
    const revoke = vi.fn()
    vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL: create, revokeObjectURL: revoke }))
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
      expect(this.download).toBe('gantt-plan.xlsx')
      expect(this.href).toBe('blob:download')
    })
    render(<ExcelControls tasks={[task]} onImport={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Export Excel' }))
    expect(screen.getByLabelText('Import workbook (.xlsx)')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Exporting…' })).toBeDisabled()
    vi.useFakeTimers()
    await act(async () => {
      resolve({ ok: true, blob: async () => blob })
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.getByRole('status')).toHaveTextContent('download started')
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ tasks: [task] })
    expect(create).toHaveBeenCalledWith(blob)
    expect(click).toHaveBeenCalledOnce()
    expect(document.querySelector('a[download]')).toBeNull()
    expect(revoke).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1000)
    expect(revoke).toHaveBeenCalledWith('blob:download')
  })

  it.each([
    { ok: false, status: 422, json: async () => ({ detail: [{ loc: ['body', 'tasks', 0], msg: 'Invalid dates' }] }) },
    { ok: false, status: 503, json: async () => { throw new Error('html page') } },
  ])('makes failed exports retryable and does not replace tasks', async (response) => {
    vi.spyOn(global, 'fetch').mockResolvedValue(response)
    const onImport = vi.fn()
    render(<ExcelControls tasks={[task]} onImport={onImport} />)
    fireEvent.click(screen.getByRole('button', { name: 'Export Excel' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(response.status === 422 ? 'Invalid dates' : '503')
    expect(screen.getByRole('button', { name: 'Export Excel' })).toBeEnabled()
    expect(onImport).not.toHaveBeenCalled()
  })

  it('rejects wrong extensions and oversize files locally', () => {
    const fetch = vi.spyOn(global, 'fetch')
    render(<ExcelControls tasks={[]} onImport={vi.fn()} />)
    const input = screen.getByLabelText('Import workbook (.xlsx)')
    for (const invalid of [new File(['a'], 'tasks.csv'), new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'large.xlsx')]) {
      fireEvent.change(input, { target: { files: [invalid] } })
      expect(screen.getByRole('alert')).toHaveTextContent('no larger than 2 MiB')
      expect(screen.queryByLabelText('Project start date')).not.toBeInTheDocument()
    }
    expect(fetch).not.toHaveBeenCalled()
  })

  it('disables operations while the seed loads', () => {
    render(<ExcelControls tasks={[]} disabled onImport={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Export Excel' })).toBeDisabled()
    expect(screen.getByLabelText('Import workbook (.xlsx)')).toBeDisabled()
  })

  it('aborts an upload on unmount', async () => {
    let signal
    vi.spyOn(global, 'fetch').mockImplementation((url, options) => {
      signal = options.signal
      return new Promise(() => {})
    })
    const { unmount } = render(<ExcelControls tasks={[]} onImport={vi.fn()} />)
    selectFile()
    selectDate()
    fireEvent.click(screen.getByRole('button', { name: 'Import plan' }))
    await waitFor(() => expect(signal).toBeDefined())
    unmount()
    expect(signal.aborted).toBe(true)
  })
})
