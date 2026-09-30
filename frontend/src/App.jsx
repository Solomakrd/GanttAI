import { useCallback, useEffect, useState } from 'react'
import { createProject, loadProject, loadWorkspace, undoProject } from './api'
import { GanttChart } from './components/GanttChart'
import { ExcelControls } from './components/ExcelControls'
import { PlanChat } from './components/PlanChat'
import './styles.css'

const initialState = { status: 'loading', tasks: [], rejectedIds: [], messages: [], workspaceProjects: [], projectId: null, conversationId: null, version: 0, token: null, error: null }

export default function App() {
  const [state, setState] = useState(initialState)
  const [appBusy, setAppBusy] = useState(false)
  const [excelBusy, setExcelBusy] = useState(false)
  const [chatBusy, setChatBusy] = useState(false)
  const busy = appBusy || excelBusy || chatBusy
  const [imported, setImported] = useState(false)
  const [notice, setNotice] = useState(null)
  const loadPlan = useCallback(() => {
    const controller = new AbortController()
    setState((current) => ({ ...current, status: 'loading', error: null }))
    loadWorkspace(controller.signal)
      .then((project) => setState({ status: 'ready', ...project, error: null }))
      .catch((error) => { if (error.name !== 'AbortError') setState((current) => ({ ...current, status: 'error', error })) })
    return () => controller.abort()
  }, [])

  useEffect(() => loadPlan(), [loadPlan])

  const acceptChatPlan = useCallback((result) => {
    setState((current) => {
      if (result.version !== current.version + 1) {
        setNotice('A newer plan is already active. The stale chat result was ignored; reload before retrying.')
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
      setImported(false)
      setState((current) => ({ status: 'ready', ...project,
        workspaceProjects: [...current.workspaceProjects, { projectId: project.projectId, version: project.version }], error: null }))
    } catch (error) {
      setNotice(error.message)
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
      setImported(false)
      setState((current) => ({ status: 'ready', ...project, workspaceProjects: current.workspaceProjects, error: null }))
    } catch (error) {
      setNotice(error.message)
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
      setState((current) => ({ ...current, ...project, token: current.token,
        workspaceProjects: current.workspaceProjects.map((item) => item.projectId === project.projectId ? { ...item, version: project.version } : item),
        status: 'ready', error: null }))
    } catch (error) {
      setNotice(error.message)
    } finally {
      setAppBusy(false)
    }
  }

  return <main className="app-shell">
    <header className="topbar"><a className="brand" href="/" aria-label="GanttAI home"><span className="brand-mark">G</span><span>Gantt<span className="brand-accent">AI</span></span></a><div className="topbar-actions">{state.workspaceProjects.length > 1 && <select aria-label="Active project" value={state.projectId || ''} disabled={busy} onChange={(event) => switchProject(event.target.value)}>{state.workspaceProjects.map((project, index) => <option key={project.projectId} value={project.projectId}>Project {index + 1}</option>)}</select>}{state.projectId && <button type="button" disabled={busy || state.version <= 1} onClick={undo}>Undo</button>}<button type="button" disabled={busy || state.status === 'loading'} onClick={startNewProject}>New project</button><div className="topbar-meta"><span className="status-dot" />{imported ? 'Imported workspace' : 'Saved workspace'} <span className="avatar">M</span></div></div></header>
    <section className="hero"><div><p className="eyebrow">Project workspace / Q4 launch</p><h1>Make the plan<br /><em>visible.</em></h1><p className="hero-copy">A shared timeline for turning focused work into forward motion. Start with the seeded plan, then shape what comes next.</p></div><div className="hero-note"><span>01</span><p>FIRST LOOK<br /><strong>Five workstreams<br />already in motion</strong></p></div></section>
    <ExcelControls tasks={state.tasks} project={state} disabled={state.status !== 'ready' || busy} onOperation={setExcelBusy} onImport={(result) => {
      setImported(true)
      if (Array.isArray(result)) setState((current) => ({ ...current, tasks: result }))
      else setState((current) => ({ ...current, ...result, status: 'ready', error: null }))
    }} />
    {state.status === 'loading' && <div className="message loading-message" role="status"><span className="spinner" />Loading your plan...</div>}
    {state.status === 'error' && <div className="message error-message" role="alert"><div><strong>We could not load the plan.</strong><span>Check that the API and database are running, then try again.</span></div><button type="button" onClick={loadPlan}>Retry</button></div>}
    {notice && <div className="warning" role="alert">{notice}</div>}
    {state.status === 'ready' && <div className="workspace-grid"><GanttChart tasks={state.tasks} />{state.projectId && <PlanChat project={state} disabled={busy} onOperation={setChatBusy} onPlan={acceptChatPlan} />}{state.rejectedIds?.length > 0 && <div className="warning" role="alert">{state.rejectedIds.length} invalid task record{state.rejectedIds.length > 1 ? 's were' : ' was'} excluded ({state.rejectedIds.join(', ')}).</div>}</div>}
    <footer><span>GANTTAI / PROJECT VIEW</span><span>PLAN API · LIVE</span></footer>
  </main>
}
