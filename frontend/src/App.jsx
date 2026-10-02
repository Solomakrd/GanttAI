import { useCallback, useEffect, useRef, useState } from 'react'
import { createProject, loadProject, loadWorkspace, undoProject, updateProjectTask } from './api'
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
    setAppBusy(true)
    setNotice(null)
    try {
      const project = await createProject()
      setSelectedTaskId(null)
      setImported(false)
      setState((current) => ({ status: 'ready', ...project,
        workspaceProjects: project.workspaceReset ? [{ projectId: project.projectId, version: project.version }] : [...current.workspaceProjects, { projectId: project.projectId, version: project.version }], error: null }))
    } catch (error) {
      setNotice(errorDescriptor(error, 'operationFailed'))
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
      const result = await updateProjectTask(project, selectedTaskId, values)
      if (state.projectId !== project.projectId || state.version !== project.version || result.version !== project.version + 1) {
        const error = new Error(t('staleTask'))
        error.translationKey = 'staleTask'
        throw error
      }
      setState((current) => ({ ...current, ...result, token: current.token,
        workspaceProjects: current.workspaceProjects.map((item) => item.projectId === result.projectId ? { ...item, version: result.version } : item),
        status: 'ready', error: null }))
      setSelectedTaskId(null)
    } finally {
      setAppBusy(false)
    }
  }

  const selectedTask = state.tasks.find((task) => task.id === selectedTaskId)
  const activeProjectIndex = Math.max(0, state.workspaceProjects.findIndex((project) => project.projectId === state.projectId))
  const projectLabel = t('project', { number: activeProjectIndex + 1 })
  const loadError = errorDescriptor(state.error, 'loadFailedHelp')

  useEffect(() => {
    if (selectedTaskId && !selectedTask) setSelectedTaskId(null)
  }, [selectedTaskId, selectedTask])

  return <main className="app-shell">
    <header className="topbar">
      <a className="brand" href="/" aria-label={t('home')}><span className="brand-mark" aria-hidden="true" /><span className="brand-name">GanttAI</span></a>
      <div className="project-switcher">
        <label htmlFor="active-project">{t('activeProject')}</label>
        <select id="active-project" aria-label={t('activeProject')} value={state.projectId || ''} disabled={busy || !state.projectId} onChange={(event) => switchProject(event.target.value)}>{state.workspaceProjects.map((project, index) => <option key={project.projectId} value={project.projectId}>{t('project', { number: index + 1 })}</option>)}</select>
      </div>
      <div className="topbar-actions">
        <label className="language-control"><span>{t('language')}</span><select aria-label={t('language')} value={locale} onChange={(event) => setLocale(event.target.value)}><option value="ru">RU</option><option value="en">EN</option></select></label>
        {state.projectId && <button type="button" className="icon-action" disabled={busy || state.version <= 1} onClick={undo} aria-label={t('undo')}>↶<span>{t('undo')}</span></button>}
        <button type="button" aria-label={t('newProject')} disabled={busy || state.status === 'loading'} onClick={startNewProject}><span aria-hidden="true">＋</span><span>{t('newProject')}</span></button>
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
        {state.status === 'ready' && <GanttChart tasks={state.tasks} disabled={busy} onSelectTask={state.projectId ? setSelectedTaskId : undefined} widths={effectiveWidths} taskTableMax={taskTableMax} mobile={mobile} onWidthChange={setWidth} onWidthReset={resetWidth} />}
      </section>
      {!mobile && <ResizeHandle className="workspace-resize" label={t('planAssistantBoundary')} value={effectiveWidths.assistant} min={WIDTH_LIMITS.assistant[0]} max={assistantMax} direction={-1} onChange={(value) => setWidth('assistant', value)} onReset={() => resetWidth('assistant')} />}
      <div id="assistant-panel" className="assistant-surface" role="tabpanel" aria-labelledby="assistant-tab">{state.status === 'ready' && state.projectId ? <PlanChat project={state} disabled={busy} onOperation={setChatBusy} onPlan={acceptChatPlan} /> : <div className="assistant-placeholder"><span className="spinner" />{t('preparingAssistant')}</div>}</div>
    </div>
    {(notice || state.rejectedIds?.length > 0) && <div className="notice-stack">
      {notice && <div className="app-notice" role="alert">{notice.key ? t(notice.key, notice.values) : notice.message}</div>}
      {state.rejectedIds?.length > 0 && <div className="app-notice" role="alert">{t('rejectedTasks', { count: state.rejectedIds.length, ids: state.rejectedIds.join(', ') })}</div>}
    </div>}
    {selectedTask && <TaskDetailsModal task={selectedTask} tasks={state.tasks} disabled={busy} onClose={() => setSelectedTaskId(null)} onSave={saveTask} />}
  </main>
}
