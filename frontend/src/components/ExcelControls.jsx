import { useEffect, useRef, useState } from 'react'
import { exportPlan, importPlan } from '../api'

export function ExcelControls({ tasks, disabled, onImport }) {
  const [file, setFile] = useState(null)
  const [startDate, setStartDate] = useState('')
  const [operation, setOperation] = useState(null)
  const [feedback, setFeedback] = useState(null)
  const activeRequest = useRef(null)
  const fileInput = useRef(null)

  useEffect(() => () => activeRequest.current?.abort(), [])

  const clearSelection = () => {
    setFile(null)
    setStartDate('')
    if (fileInput.current) fileInput.current.value = ''
  }

  const run = async (kind) => {
    if (disabled || activeRequest.current || (kind === 'import' && (!file || !startDate))) return
    const controller = new AbortController()
    activeRequest.current = controller
    setOperation(kind)
    setFeedback(null)
    try {
      if (kind === 'import') {
        const imported = await importPlan(file, startDate, controller.signal)
        if (controller.signal.aborted) return
        onImport(imported)
        clearSelection()
        setFeedback({ message: `Imported ${imported.length} tasks. This plan stays in this tab until reload.` })
      } else {
        await exportPlan(tasks, controller.signal)
        if (controller.signal.aborted) return
        setFeedback({ message: 'Workbook download started.' })
      }
    } catch (error) {
      if (!controller.signal.aborted) setFeedback({ error: true, message: error.message || 'Workbook operation failed. Please retry.' })
    } finally {
      activeRequest.current = null
      if (!controller.signal.aborted) setOperation(null)
    }
  }

  const busy = disabled || Boolean(operation)
  return <section className="excel-controls" aria-label="Excel exchange" aria-busy={Boolean(operation)}>
    <div className="excel-heading"><h2>Excel exchange</h2><button type="button" disabled={busy} onClick={() => run('export')}>{operation === 'export' ? 'Exporting…' : 'Export Excel'}</button></div>
    <label htmlFor="excel-file">Import workbook (.xlsx)</label>
    <input ref={fileInput} id="excel-file" type="file" accept=".xlsx" disabled={busy} aria-describedby="excel-help" onChange={(event) => {
      const selected = event.target.files?.[0]
      event.target.value = '' // Permit the same file to be selected again after correction.
      if (!selected) return
      setFeedback(null)
      setStartDate('')
      if (!selected.name.toLowerCase().endsWith('.xlsx') || selected.size > 2 * 1024 * 1024) {
        setFile(null)
        setFeedback({ error: true, message: 'Choose an .xlsx workbook no larger than 2 MiB.' })
      } else setFile(selected)
    }} />
    <p id="excel-help">Use the first worksheet with задача, описание, исполнитель, длительность, предшественники. Import replaces the displayed plan only after validation; reload restores the seed.</p>
    {file && <form onSubmit={(event) => { event.preventDefault(); run('import') }}>
      <p className="selected-file">Selected: <strong>{file.name}</strong></p>
      <label htmlFor="project-start">Project start date</label>
      <input id="project-start" type="date" required min="0001-01-01" max="9999-12-31" value={startDate} disabled={busy} aria-describedby="date-help" onChange={(event) => setStartDate(event.target.value)} />
      <p id="date-help">Choose a date for tasks without dates. All calendar days count, including weekends and holidays. Supplied start_date and end_date values are validated and preserved, not rescheduled using this choice.</p>
      <div className="excel-actions"><button type="submit" disabled={busy || !startDate}>{operation === 'import' ? 'Importing…' : 'Import plan'}</button><button type="button" disabled={busy} onClick={() => { clearSelection(); setFeedback(null) }}>Cancel</button></div>
    </form>}
    {operation && <p role="status">{operation === 'import' ? 'Validating workbook…' : 'Preparing workbook…'}</p>}
    {feedback && <p className={feedback.error ? 'excel-error' : 'excel-success'} role={feedback.error ? 'alert' : 'status'}>{feedback.message}</p>}
  </section>
}
