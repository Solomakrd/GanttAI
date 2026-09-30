import { useCallback, useEffect, useState } from 'react'
import { fetchPlan } from './api'
import { GanttChart } from './components/GanttChart'
import './styles.css'

export default function App() {
  const [state, setState] = useState({ status: 'loading', tasks: [], rejectedIds: [], error: null })
  const loadPlan = useCallback(() => {
    const controller = new AbortController()
    setState((current) => ({ ...current, status: 'loading', error: null }))
    fetchPlan(controller.signal)
      .then(({ tasks, rejectedIds }) => setState({ status: 'ready', tasks, rejectedIds, error: null }))
      .catch((error) => { if (error.name !== 'AbortError') setState({ status: 'error', tasks: [], rejectedIds: [], error }) })
    return () => controller.abort()
  }, [])

  useEffect(() => loadPlan(), [loadPlan])

  return <main className="app-shell">
    <header className="topbar"><a className="brand" href="/" aria-label="GanttAI home"><span className="brand-mark">G</span><span>Gantt<span className="brand-accent">AI</span></span></a><div className="topbar-meta"><span className="status-dot" />Seeded workspace <span className="avatar">M</span></div></header>
    <section className="hero"><div><p className="eyebrow">Project workspace / Q4 launch</p><h1>Make the plan<br /><em>visible.</em></h1><p className="hero-copy">A shared timeline for turning focused work into forward motion. Start with the seeded plan, then shape what comes next.</p></div><div className="hero-note"><span>01</span><p>FIRST LOOK<br /><strong>Five workstreams<br />already in motion</strong></p></div></section>
    {state.status === 'loading' && <div className="message loading-message" role="status"><span className="spinner" />Loading your plan…</div>}
    {state.status === 'error' && <div className="message error-message" role="alert"><div><strong>We could not load the plan.</strong><span>Check that the API is running, then try again.</span></div><button type="button" onClick={loadPlan}>Retry</button></div>}
    {state.status === 'ready' && <><GanttChart tasks={state.tasks} />{state.rejectedIds.length > 0 && <div className="warning" role="alert">{state.rejectedIds.length} invalid task record{state.rejectedIds.length > 1 ? 's were' : ' was'} excluded ({state.rejectedIds.join(', ')}).</div>}</>}
    <footer><span>GANTTAI / PROJECT VIEW</span><span>PLAN API · LIVE</span></footer>
  </main>
}
