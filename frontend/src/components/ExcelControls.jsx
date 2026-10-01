import { useEffect, useRef, useState } from 'react'
import { exportPlan, importProjectPlan } from '../api'

export function ExcelControls({ tasks, project, disabled, onImport, onOperation }) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [file, setFile] = useState(null)
  const [startDate, setStartDate] = useState('')
  const [operation, setOperation] = useState(null)
  const [feedback, setFeedback] = useState(null)
  const activeRequest = useRef(null)
  const fileInput = useRef(null)
  const importTrigger = useRef(null)
  const importDialog = useRef(null)
  const modalClose = useRef(null)

  useEffect(() => () => activeRequest.current?.abort(), [])
  useEffect(() => {
    if (dialogOpen) modalClose.current?.focus()
  }, [dialogOpen])
  useEffect(() => {
    if (!dialogOpen) return undefined
    const handleKeydown = (event) => {
      if (event.key === 'Escape' && !operation) closeDialog()
      if (event.key !== 'Tab' || !importDialog.current) return
      const controls = [...importDialog.current.querySelectorAll('button:not(:disabled), input:not(:disabled)')]
      if (!controls.length) return
      const first = controls[0]
      const last = controls[controls.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', handleKeydown)
    return () => document.removeEventListener('keydown', handleKeydown)
  }, [dialogOpen, operation])

  const closeDialog = () => {
    if (operation) return
    setDialogOpen(false)
    setTimeout(() => importTrigger.current?.focus(), 0)
  }

  const clearSelection = () => {
    setFile(null)
    setStartDate('')
    if (fileInput.current) fileInput.current.value = ''
  }

  const run = async (kind) => {
    if (disabled || activeRequest.current || (kind === 'import' && (!file || !startDate))) return
    const controller = new AbortController()
    activeRequest.current = controller
    onOperation?.(true)
    setOperation(kind)
    setFeedback(null)
    try {
      if (kind === 'import') {
        const imported = await importProjectPlan(project, file, startDate, controller.signal)
        if (controller.signal.aborted) return
        onImport(project?.projectId ? imported : imported.tasks)
        clearSelection()
        const count = imported.tasks.length
        setFeedback({ message: `Imported ${count} tasks. The project is saved and available after reload.` })
        setDialogOpen(false)
        setTimeout(() => importTrigger.current?.focus(), 0)
      } else {
        await exportPlan(tasks, controller.signal)
        if (controller.signal.aborted) return
        setFeedback({ message: 'Workbook download started.' })
      }
    } catch (error) {
      if (!controller.signal.aborted) setFeedback({ error: true, message: error.message || 'Workbook operation failed. Please retry.' })
    } finally {
      activeRequest.current = null
      onOperation?.(false)
      if (!controller.signal.aborted) setOperation(null)
    }
  }

  const busy = disabled || Boolean(operation)
  return <div className="excel-controls" aria-label="Excel exchange" aria-busy={Boolean(operation)}>
    <button ref={importTrigger} type="button" aria-label="Import" disabled={busy} onClick={() => { setFeedback(null); setDialogOpen(true) }}><span aria-hidden="true">↑</span><span>Import</span></button>
    <button type="button" className="export-button" aria-label={operation === 'export' ? 'Exporting…' : 'Export Excel'} disabled={busy} onClick={() => run('export')}><span aria-hidden="true">↓</span><span>{operation === 'export' ? 'Exporting…' : 'Export Excel'}</span></button>
    <div className={`modal-backdrop import-backdrop${dialogOpen ? ' open' : ''}`} aria-hidden={!dialogOpen} onMouseDown={(event) => { if (event.target === event.currentTarget) closeDialog() }}>
      <section ref={importDialog} className="import-modal" role="dialog" aria-modal="true" aria-labelledby="import-title">
        <div className="modal-heading"><div><span className="eyebrow">Import data</span><h2 id="import-title">Load a plan from Excel</h2></div><button ref={modalClose} type="button" className="modal-close" aria-label="Close import dialog" aria-disabled={Boolean(operation)} onClick={closeDialog}>&times;</button></div>
        <div className="import-body"><p>Choose the first worksheet in an Excel workbook. The plan changes only after the file passes validation.</p>
    <label className="upload-zone" htmlFor="excel-file"><span className="upload-icon" aria-hidden="true">↑</span><strong>Choose an .xlsx workbook</strong><span>Excel workbook · up to 2 MiB</span></label>
    <input ref={fileInput} id="excel-file" className="file-input" type="file" accept=".xlsx" disabled={busy} aria-label="Import workbook (.xlsx)" aria-describedby="excel-help" onChange={(event) => {
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
    <p id="excel-help" className="schema-note">Expected columns: задача, описание, исполнитель, длительность, предшественники. Import creates a saved plan version only after validation.</p>
    {file && <form onSubmit={(event) => { event.preventDefault(); run('import') }}>
      <p className="selected-file">Selected: <strong>{file.name}</strong></p>
      <label htmlFor="project-start">Project start date</label>
      <input id="project-start" type="date" required min="0001-01-01" max="9999-12-31" value={startDate} disabled={busy} aria-describedby="date-help" onChange={(event) => setStartDate(event.target.value)} />
      <p id="date-help">Choose a date for tasks without dates. All calendar days count, including weekends and holidays. Supplied start_date and end_date values are validated and preserved, not rescheduled using this choice.</p>
      <div className="excel-actions"><button type="button" disabled={busy} onClick={() => { clearSelection(); setFeedback(null) }}>Clear</button><button type="submit" disabled={busy || !startDate}>{operation === 'import' ? 'Importing…' : 'Import plan'}</button></div>
    </form>}
    {operation && <p role="status">{operation === 'import' ? 'Validating workbook…' : 'Preparing workbook…'}</p>}
        </div>
        <div className="modal-actions"><button type="button" disabled={busy} onClick={() => { clearSelection(); setFeedback(null); closeDialog() }}>Cancel</button></div>
      </section>
    </div>
    {feedback && <p className={`excel-feedback ${feedback.error ? 'excel-error' : 'excel-success'}`} role={feedback.error ? 'alert' : 'status'}>{feedback.message}</p>}
  </div>
}
