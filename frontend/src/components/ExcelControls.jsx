import { useEffect, useRef, useState } from 'react'
import { exportPlan, importProjectPlan } from '../api'
import { errorDescriptor, useI18n } from '../i18n'

export function ExcelControls({ tasks, project, disabled, onImport, onOperation }) {
  const { t } = useI18n()
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
        setFeedback({ key: 'importedTasks', values: { count } })
        setDialogOpen(false)
        setTimeout(() => importTrigger.current?.focus(), 0)
      } else {
        await exportPlan(tasks, controller.signal)
        if (controller.signal.aborted) return
        setFeedback({ key: 'downloadStarted' })
      }
    } catch (error) {
      if (!controller.signal.aborted) setFeedback({ error: true, ...errorDescriptor(error, 'workbookFailed') })
    } finally {
      activeRequest.current = null
      onOperation?.(false)
      if (!controller.signal.aborted) setOperation(null)
    }
  }

  const busy = disabled || Boolean(operation)
  return <div className="excel-controls" aria-label={t('excelExchange')} aria-busy={Boolean(operation)}>
    <button ref={importTrigger} type="button" aria-label={t('import')} disabled={busy} onClick={() => { setFeedback(null); setDialogOpen(true) }}><span aria-hidden="true">↑</span><span>{t('import')}</span></button>
    <button type="button" className="export-button" aria-label={t(operation === 'export' ? 'exporting' : 'exportExcel')} disabled={busy} onClick={() => run('export')}><span aria-hidden="true">↓</span><span>{t(operation === 'export' ? 'exporting' : 'exportExcel')}</span></button>
    <div className={`modal-backdrop import-backdrop${dialogOpen ? ' open' : ''}`} aria-hidden={!dialogOpen} onMouseDown={(event) => { if (event.target === event.currentTarget) closeDialog() }}>
      <section ref={importDialog} className="import-modal" role="dialog" aria-modal="true" aria-labelledby="import-title">
        <div className="modal-heading"><div><span className="eyebrow">{t('importData')}</span><h2 id="import-title">{t('loadExcel')}</h2></div><button ref={modalClose} type="button" className="modal-close" aria-label={t('closeImport')} aria-disabled={Boolean(operation)} onClick={closeDialog}>&times;</button></div>
        <div className="import-body"><p>{t('importIntro')}</p>
    <label className="upload-zone" htmlFor="excel-file"><span className="upload-icon" aria-hidden="true">↑</span><strong>{t('chooseWorkbook')}</strong><span>{t('workbookLimit')}</span></label>
    <input ref={fileInput} id="excel-file" className="file-input" type="file" accept=".xlsx" disabled={busy} aria-label={t('importWorkbook')} aria-describedby="excel-help" onChange={(event) => {
      const selected = event.target.files?.[0]
      event.target.value = '' // Permit the same file to be selected again after correction.
      if (!selected) return
      setFeedback(null)
      setStartDate('')
      if (!selected.name.toLowerCase().endsWith('.xlsx') || selected.size > 2 * 1024 * 1024) {
        setFile(null)
        setFeedback({ error: true, key: 'invalidWorkbook' })
      } else setFile(selected)
    }} />
    <p id="excel-help" className="schema-note">{t('expectedColumns')}</p>
    {file && <form onSubmit={(event) => { event.preventDefault(); run('import') }}>
      <p className="selected-file">{t('selected')} <strong>{file.name}</strong></p>
      <label htmlFor="project-start">{t('projectStart')}</label>
      <input id="project-start" type="date" required min="0001-01-01" max="9999-12-31" value={startDate} disabled={busy} aria-describedby="date-help" onChange={(event) => setStartDate(event.target.value)} />
      <p id="date-help">{t('dateHelp')}</p>
      <div className="excel-actions"><button type="button" disabled={busy} onClick={() => { clearSelection(); setFeedback(null) }}>{t('clear')}</button><button type="submit" disabled={busy || !startDate}>{t(operation === 'import' ? 'importing' : 'importPlan')}</button></div>
    </form>}
    {operation && <p role="status">{t(operation === 'import' ? 'validatingWorkbook' : 'preparingWorkbook')}</p>}
        </div>
        <div className="modal-actions"><button type="button" disabled={busy} onClick={() => { clearSelection(); setFeedback(null); closeDialog() }}>{t('cancel')}</button></div>
      </section>
    </div>
    {feedback && <p className={`excel-feedback ${feedback.error ? 'excel-error' : 'excel-success'}`} role={feedback.error ? 'alert' : 'status'}>{feedback.key ? t(feedback.key, feedback.values) : feedback.message}</p>}
  </div>
}
