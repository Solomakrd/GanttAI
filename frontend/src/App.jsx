import { useCallback, useEffect, useRef, useState } from 'react'
import { createProject, createProjectTask, deleteProject, loadProject, loadWorkspace, renameProject, undoProject, updateProjectTask } from './api'
import { GanttChart } from './components/GanttChart'
import { ExcelControls } from './components/ExcelControls'
import { PlanChat } from './components/PlanChat'
import { ResizeHandle } from './components/ResizeHandle'
import { TaskDetailsModal } from './components/TaskDetailsModal'
import { errorDescriptor, useI18n } from './i18n'
import './styles.css'

const initialState = { status: 'loading', tasks: [], rejectedIds: [], messages: [], workspaceProjects: [], projectId: null, conversationId: null, version: 0, token: null, error: null }
const WIDTHS_KEY = 'ganttai.columnWidths.v1'
const WIDTH_LIMITS = { assistant: [280, 600], taskTable: [260, 600], taskName: [140, 500] }
const MIN_TIMELINE_WIDTH = 180

function ProjectDialog({ mode, name, pending, error, onName, onClose, onSubmit }) {
  const { t } = useI18n()
  const dialog = useRef(null)
  const first = useRef(null)
  const returnFocus = useRef(document.activeElement)
  const closeRef = useRef(onClose)
  const pendingRef = useRef(pending)
  closeRef.current = onClose
  pendingRef.current = pending

  useEffect(() => {
    first.current?.focus()
    const keydown = (event) => {
      if (event.key === 'Escape' && !pendingRef.current) closeRef.current()
      if (event.key !== 'Tab' || !dialog.current) return
      const controls = [...dialog.current.querySelectorAll('button:not(:disabled), input:not(:disabled)')]
      if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus() }
      else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus() }
    }
    document.addEventListener('keydown', keydown)
    const previous = returnFocus.current
    return () => { document.removeEventListener('keydown', keydown); if (previous?.isConnected) previous.focus() }
  }, [])

  const deleting = mode === 'delete'
  const title = deleting ? t('deleteProject') : t(mode === 'rename' ? 'renameProject' : 'newProject')
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !pending) onClose() }}>
    <section ref={dialog} className="project-modal" role={deleting ? 'alertdialog' : 'dialog'} aria-modal="true" aria-labelledby="project-modal-title" aria-describedby={deleting ? 'project-delete-warning' : undefined} aria-busy={pending}>
      <div className="modal-heading"><div><span className="eyebrow">{t('planningWorkspace')}</span><h2 id="project-modal-title">{title}</h2></div><button type="button" className="modal-close" aria-label={t('closeProjectDialog')} disabled={pending} onClick={onClose}>&times;</button></div>
      <form onSubmit={(event) => { event.preventDefault(); onSubmit() }}>
        {deleting ? <p id="project-delete-warning">{t('deleteProjectWarning', { name })}</p> : <label>{t('projectName')}<input ref={first} value={name} disabled={pending} onChange={(event) => onName(event.target.value)} /></label>}
        {error && <p className="modal-error" role="alert">{error.key ? t(error.key, error.values) : error.message}</p>}
        <div className="modal-actions"><button ref={deleting ? first : undefined} type="button" disabled={pending} onClick={onClose}>{t('cancel')}</button><button className={deleting ? 'danger-button' : ''} type="submit" disabled={pending}>{t(pending ? 'saving' : deleting ? 'deletePermanently' : mode === 'rename' ? 'saveChanges' : 'createProject')}</button></div>
      </form>
    </section>
  </div>
}

function clamp(value, [min, max]) {
  return Math.min(max, Math.max(min, value))
}

function defaultWidths(viewport) {
  if (viewport <= 520) return { assistant: 340, taskTable: 210, taskName: 140 }
  if (viewport <= 820) return { assistant: 340, taskTable: 290, taskName: 180 }
  if (viewport <= 1100) return { assistant: 340, taskTable: 310, taskName: 200 }
  return { assistant: 380, taskTable: 340, taskName: 220 }
}

function desktopWidthLimits(viewport, assistant) {
  const assistantMax = Math.max(WIDTH_LIMITS.assistant[0], Math.min(WIDTH_LIMITS.assistant[1], viewport - 480))
  const effectiveAssistant = clamp(assistant, [WIDTH_LIMITS.assistant[0], assistantMax])
  const taskTableMax = Math.max(WIDTH_LIMITS.taskTable[0], Math.min(WIDTH_LIMITS.taskTable[1], viewport - effectiveAssistant - MIN_TIMELINE_WIDTH))
  return { assistantMax, effectiveAssistant, taskTableMax }
}

function loadWidths(viewport) {
  const defaults = defaultWidths(viewport)
  try {
    const stored = JSON.parse(localStorage.getItem(WIDTHS_KEY))
    if (stored?.version !== 1) return defaults
    const values = stored.widths
    if (!values || Object.keys(defaults).some((key) => !Number.isFinite(values[key]))) return defaults
    const { effectiveAssistant, taskTableMax } = desktopWidthLimits(viewport, values.assistant)
    const taskTable = clamp(values.taskTable, [WIDTH_LIMITS.taskTable[0], taskTableMax])
    return {
      assistant: effectiveAssistant,
      taskTable,
      taskName: clamp(values.taskName, [WIDTH_LIMITS.taskName[0], Math.min(WIDTH_LIMITS.taskName[1], taskTable - 100)]),
    }
  } catch {
    return defaults
  }
}

export default function App() {
  const { locale, setLocale, t } = useI18n()
  const [viewport, setViewport] = useState(() => window.innerWidth)
  const [widths, setWidths] = useState(() => loadWidths(window.innerWidth))
  const persistWidths = useRef(false)
  const [state, setState] = useState(initialState)
  const [appBusy, setAppBusy] = useState(false)
  const [excelBusy, setExcelBusy] = useState(false)
  const [chatBusy, setChatBusy] = useState(false)
  const busy = appBusy || excelBusy || chatBusy
  const [imported, setImported] = useState(false)
  const [notice, setNotice] = useState(null)
  const [selectedTaskId, setSelectedTaskId] = useState(null)
  const [creatingTask, setCreatingTask] = useState(false)
  const [projectDialog, setProjectDialog] = useState(null)
  const [projectName, setProjectName] = useState('')
  const [projectError, setProjectError] = useState(null)
  const [mobileSurface, setMobileSurface] = useState('plan')
  const loadPlan = useCallback(() => {
    const controller = new AbortController()
    setState((current) => ({ ...current, status: 'loading', error: null }))
    loadWorkspace(controller.signal)
      .then((project) => setState({ status: 'ready', ...project, error: null }))
      .catch((error) => { if (error.name !== 'AbortError') setState((current) => ({ ...current, status: 'error', error })) })
    return () => controller.abort()
  }, [])

  useEffect(() => loadPlan(), [loadPlan])

  useEffect(() => {
    const resize = () => setViewport(window.innerWidth)
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])

  useEffect(() => {
    if (persistWidths.current) localStorage.setItem(WIDTHS_KEY, JSON.stringify({ version: 1, widths }))
  }, [widths])

  const mobile = viewport <= 820
  const responsiveDefaults = defaultWidths(viewport)
  const { assistantMax, effectiveAssistant, taskTableMax } = desktopWidthLimits(viewport, widths.assistant)
  const desktopTaskTable = clamp(widths.taskTable, [WIDTH_LIMITS.taskTable[0], taskTableMax])
  const effectiveWidths = mobile ? responsiveDefaults : {
    ...widths,
    assistant: effectiveAssistant,
    taskTable: desktopTaskTable,
    taskName: clamp(widths.taskName, [WIDTH_LIMITS.taskName[0], Math.min(WIDTH_LIMITS.taskName[1], desktopTaskTable - 100)]),
  }
  const setWidth = useCallback((name, value) => {
    persistWidths.current = true
    setWidths((current) => {
      const currentLimits = desktopWidthLimits(viewport, current.assistant)
      const currentTaskTable = clamp(current.taskTable, [WIDTH_LIMITS.taskTable[0], currentLimits.taskTableMax])
      if (name === 'taskTable') {
        const taskTable = clamp(value, [WIDTH_LIMITS.taskTable[0], currentLimits.taskTableMax])
        return { ...current, taskTable, taskName: clamp(current.taskName, [WIDTH_LIMITS.taskName[0], Math.min(WIDTH_LIMITS.taskName[1], taskTable - 100)]) }
      }
      if (name === 'assistant') {
        const nextLimits = desktopWidthLimits(viewport, value)
        const taskTable = clamp(currentTaskTable, [WIDTH_LIMITS.taskTable[0], nextLimits.taskTableMax])
        return { ...current, assistant: nextLimits.effectiveAssistant, taskTable, taskName: clamp(current.taskName, [WIDTH_LIMITS.taskName[0], Math.min(WIDTH_LIMITS.taskName[1], taskTable - 100)]) }
      }
      const limits = name === 'taskName' ? [WIDTH_LIMITS.taskName[0], Math.min(WIDTH_LIMITS.taskName[1], currentTaskTable - 100)] : [WIDTH_LIMITS.assistant[0], assistantMax]
      return { ...current, taskTable: currentTaskTable, [name]: clamp(value, limits) }
    })
  }, [assistantMax, viewport])
  const resetWidth = useCallback((name) => setWidth(name, defaultWidths(viewport)[name]), [setWidth, viewport])

  const acceptChatPlan = useCallback((result) => {
    setSelectedTaskId(null)
    setState((current) => {
      if (result.version !== current.version + 1) {
        setNotice({ key: 'staleChat' })
        return current
      }
      return { ...current, tasks: result.tasks, version: result.version }
    })
  }, [])

  const startNewProject = async () => {
    if (busy) return
    const name = projectName.trim()
    if (!name) { setProjectError({ key: 'projectNameRequired' }); return }
    setAppBusy(true)
    setNotice(null)
    setProjectError(null)
    try {
      const project = await createProject(name)
      setSelectedTaskId(null)
      setCreatingTask(false)
      setImported(false)
      setState((current) => ({ status: 'ready', ...project,
        workspaceProjects: project.workspaceReset ? [{ projectId: project.projectId, projectName: project.projectName, version: project.version }] : [...current.workspaceProjects, { projectId: project.projectId, projectName: project.projectName, version: project.version }], error: null }))
      setProjectDialog(null)
    } catch (error) {
      setProjectError(errorDescriptor(error, 'operationFailed'))
    } finally {
      setAppBusy(false)
    }
  }

  const saveProjectName = async () => {
    if (busy) return
    const name = projectName.trim()
    if (!name) { setProjectError({ key: 'projectNameRequired' }); return }
    setAppBusy(true)
    setProjectError(null)
    try {
      const project = await renameProject(state, name)
      setState((current) => ({ ...current, ...project, token: current.token,
        workspaceProjects: current.workspaceProjects.map((item) => item.projectId === project.projectId ? { ...item, projectName: project.projectName } : item) }))
      setProjectDialog(null)
    } catch (error) {
      setProjectError(errorDescriptor(error, 'operationFailed'))
    } finally {
      setAppBusy(false)
    }
  }

  const removeProject = async () => {
    if (busy) return
    setAppBusy(true)
    setProjectError(null)
    try {
      const project = await deleteProject(state)
      setSelectedTaskId(null)
      setCreatingTask(false)
      setImported(false)
      setState({ status: 'ready', ...project, error: null })
      setProjectDialog(null)
    } catch (error) {
      setProjectError(errorDescriptor(error, 'operationFailed'))
    } finally {
      setAppBusy(false)
    }
  }

  const switchProject = async (projectId) => {
    if (busy || projectId === state.projectId) return
    setAppBusy(true)
    setNotice(null)
    try {
      const project = await loadProject(projectId, state.token)
      setSelectedTaskId(null)
      setCreatingTask(false)
      setImported(false)
      setState((current) => ({ status: 'ready', ...project, workspaceProjects: current.workspaceProjects, error: null }))
    } catch (error) {
      setNotice(errorDescriptor(error, 'operationFailed'))
    } finally {
      setAppBusy(false)
    }
  }

  const undo = async () => {
    if (busy || !state.projectId) return
    setAppBusy(true)
    setNotice(null)
    try {
      const project = await undoProject(state)
      setSelectedTaskId(null)
      setState((current) => ({ ...current, ...project, token: current.token,
        workspaceProjects: current.workspaceProjects.map((item) => item.projectId === project.projectId ? { ...item, version: project.version } : item),
        status: 'ready', error: null }))
    } catch (error) {
      setNotice(errorDescriptor(error, 'operationFailed'))
    } finally {
      setAppBusy(false)
    }
  }

  const saveTask = async (values) => {
    const project = state
    setAppBusy(true)
    try {
      const result = selectedTaskId
        ? await updateProjectTask(project, selectedTaskId, values)
        : await createProjectTask(project, values)
      if (state.projectId !== project.projectId || state.version !== project.version || result.version !== project.version + 1) {
        const error = new Error(t('staleTask'))
        error.translationKey = 'staleTask'
        throw error
      }
      setState((current) => ({ ...current, ...result, token: current.token,
        workspaceProjects: current.workspaceProjects.map((item) => item.projectId === result.projectId ? { ...item, version: result.version } : item),
        status: 'ready', error: null }))
      setSelectedTaskId(null)
      setCreatingTask(false)
    } finally {
      setAppBusy(false)
    }
  }

  const selectedTask = state.tasks.find((task) => task.id === selectedTaskId)
  const activeProjectIndex = Math.max(0, state.workspaceProjects.findIndex((project) => project.projectId === state.projectId))
  const projectLabel = state.projectName || t('project', { number: activeProjectIndex + 1 })
  const loadError = errorDescriptor(state.error, 'loadFailedHelp')

  useEffect(() => {
    if (selectedTaskId && !selectedTask) setSelectedTaskId(null)
  }, [selectedTaskId, selectedTask])

  return <main className="app-shell">
    <header className="topbar">
      <a className="brand" href="/" aria-label={t('home')}><img className="brand-logo" src="/ganttai-logo.png" alt="" /></a>
      <div className="project-switcher">
        <label htmlFor="active-project">{t('activeProject')}</label>
        <div><select id="active-project" aria-label={t('activeProject')} value={state.projectId || ''} disabled={busy || !state.projectId} onChange={(event) => switchProject(event.target.value)}>{state.workspaceProjects.map((project, index) => <option key={project.projectId} value={project.projectId}>{project.projectName || t('project', { number: index + 1 })}</option>)}</select>
        <button type="button" aria-label={t('renameProject')} disabled={busy || !state.projectId} onClick={() => { setProjectName(state.projectName); setProjectError(null); setProjectDialog('rename') }}>✎</button></div>
      </div>
      <div className="topbar-actions">
        <label className="language-control"><span>{t('language')}</span><select aria-label={t('language')} value={locale} onChange={(event) => setLocale(event.target.value)}><option value="ru">RU</option><option value="en">EN</option></select></label>
        <button type="button" className="icon-action" aria-label={t('newProject')} disabled={busy || state.status === 'loading'} onClick={() => { setProjectName(''); setProjectError(null); setProjectDialog('create') }}><span aria-hidden="true">＋</span></button>
        <button type="button" className="icon-action danger-action" aria-label={t('deleteProject')} disabled={busy || !state.projectId} onClick={() => { setProjectName(state.projectName); setProjectError(null); setProjectDialog('delete') }}><svg className="button-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5" /></svg></button>
        <ExcelControls tasks={state.tasks} project={state} disabled={state.status !== 'ready' || busy} onOperation={setExcelBusy} onImport={(result) => {
          setImported(true)
          setSelectedTaskId(null)
          if (Array.isArray(result)) setState((current) => ({ ...current, tasks: result }))
          else setState((current) => ({ ...current, ...result, token: current.token, workspaceProjects: current.workspaceProjects.map((item) => item.projectId === result.projectId ? { ...item, version: result.version } : item), status: 'ready', error: null }))
        }} />
        <div className="workspace-state"><span className="status-dot" />{t(imported ? 'importedWorkspace' : 'savedWorkspace')}<span className="avatar" aria-hidden="true">GA</span></div>
      </div>
    </header>
    <nav className="mobile-tabs" aria-label={t('workspaceSurfaces')} role="tablist">
      <button id="plan-tab" type="button" role="tab" aria-controls="plan-panel" aria-selected={mobileSurface === 'plan'} tabIndex={mobileSurface === 'plan' ? 0 : -1} onClick={() => setMobileSurface('plan')}>{t('plan')}</button>
      <button id="assistant-tab" type="button" role="tab" aria-controls="assistant-panel" aria-selected={mobileSurface === 'ai'} tabIndex={mobileSurface === 'ai' ? 0 : -1} onClick={() => setMobileSurface('ai')}>{t('aiAssistant')}</button>
    </nav>
    <div className={`workspace-frame mobile-${mobileSurface}`} style={!mobile ? { '--assistant': `${effectiveWidths.assistant}px` } : undefined}>
      <section id="plan-panel" className="plan-surface" role="tabpanel" aria-labelledby="plan-tab">
        <div className="workspace-heading"><div><span className="eyebrow">{t('planningWorkspace')}</span><h1>{projectLabel}</h1><p>{t('taskVersion', { count: state.tasks.length, version: state.version })}</p></div><span className="save-state"><i />{t(imported ? 'importSaved' : 'workspaceSaved')}</span></div>
        {state.status === 'loading' && <div className="message loading-message" role="status"><span className="spinner" />{t('loadingPlan')}</div>}
        {state.status === 'error' && <div className="message error-message" role="alert"><div><strong>{t('loadFailed')}</strong><span>{loadError.key ? t(loadError.key, loadError.values) : loadError.message}</span></div><button type="button" onClick={loadPlan}>{t('retry')}</button></div>}
        {state.status === 'ready' && <GanttChart tasks={state.tasks} disabled={busy} onSelectTask={state.projectId ? setSelectedTaskId : undefined} onAddTask={state.projectId ? () => { setSelectedTaskId(null); setCreatingTask(true) } : undefined} onUndo={state.projectId ? undo : undefined} canUndo={state.version > 1} widths={effectiveWidths} taskTableMax={taskTableMax} mobile={mobile} onWidthChange={setWidth} onWidthReset={resetWidth} />}
      </section>
      {!mobile && <ResizeHandle className="workspace-resize" label={t('planAssistantBoundary')} value={effectiveWidths.assistant} min={WIDTH_LIMITS.assistant[0]} max={assistantMax} direction={-1} onChange={(value) => setWidth('assistant', value)} onReset={() => resetWidth('assistant')} />}
      <div id="assistant-panel" className="assistant-surface" role="tabpanel" aria-labelledby="assistant-tab">{state.status === 'ready' && state.projectId ? <PlanChat project={state} disabled={busy} onOperation={setChatBusy} onPlan={acceptChatPlan} /> : <div className="assistant-placeholder"><span className="spinner" />{t('preparingAssistant')}</div>}</div>
    </div>
    {(notice || state.rejectedIds?.length > 0) && <div className="notice-stack">
      {notice && <div className="app-notice" role="alert">{notice.key ? t(notice.key, notice.values) : notice.message}</div>}
      {state.rejectedIds?.length > 0 && <div className="app-notice" role="alert">{t('rejectedTasks', { count: state.rejectedIds.length, ids: state.rejectedIds.join(', ') })}</div>}
    </div>}
    {(selectedTask || creatingTask) && <TaskDetailsModal task={selectedTask || null} tasks={state.tasks} disabled={busy} onClose={() => { setSelectedTaskId(null); setCreatingTask(false) }} onSave={saveTask} />}
    {projectDialog && <ProjectDialog mode={projectDialog} name={projectName} pending={appBusy} error={projectError} onName={setProjectName} onClose={() => setProjectDialog(null)} onSubmit={projectDialog === 'create' ? startNewProject : projectDialog === 'rename' ? saveProjectName : removeProject} />}
  </main>
}
