import { useEffect, useRef, useState } from 'react'
import { connectPlanChat } from '../api'

export function PlanChat({ project, disabled, onPlan, onOperation }) {
  const [messages, setMessages] = useState(project.messages || [])
  const [draft, setDraft] = useState('')
  const [connection, setConnection] = useState('connecting')
  const [operation, setOperation] = useState(null)
  const [error, setError] = useState(null)
  const [retry, setRetry] = useState(0)
  const [lastRequest, setLastRequest] = useState('')
  const socket = useRef(null)
  const version = useRef(project.version)
  version.current = project.version

  useEffect(() => {
    setMessages(project.messages || [])
  }, [project.projectId, project.messages])

  useEffect(() => {
    if (!project.projectId || !project.token || typeof WebSocket === 'undefined') return undefined
    setConnection('connecting')
    const current = connectPlanChat(project, (event) => {
      if (event.type === 'connected') setConnection('connected')
      if (event.type === 'disconnected') {
        setConnection('disconnected')
        setOperation(null)
        onOperation?.(false)
        setError('Chat disconnected. Reconnect and retry.')
      }
      if (event.type === 'status') setOperation(event.message)
      if (event.type === 'tool') setOperation(`${event.tool}: ${event.status}${event.result ? ` - ${event.result}` : ''}`)
      if (event.type === 'complete') {
        if (event.version !== version.current + 1) {
          setOperation(null)
          onOperation?.(false)
          setError('A newer plan is already active. The stale chat result was ignored; reload before retrying.')
          return
        }
        setMessages((items) => [...items, { role: 'assistant', content: event.message }])
        setOperation(null)
        onOperation?.(false)
        onPlan({ tasks: event.tasks, version: event.version })
      }
      if (event.type === 'clarification') {
        setMessages((items) => [...items, { role: 'assistant', content: event.message }])
        setOperation(null)
        onOperation?.(false)
      }
      if (event.type === 'cancelled') {
        setOperation(null)
        onOperation?.(false)
        setError(event.message)
      }
      if (event.type === 'error') {
        setOperation(null)
        onOperation?.(false)
        setError(event.message)
      }
    })
    socket.current = current
    return () => { current.close(); socket.current = null }
  }, [project.projectId, project.token, onPlan, onOperation, retry])

  const send = (event) => {
    event.preventDefault()
    const content = draft.trim()
    if (!content || disabled || operation || connection !== 'connected') return
    setMessages((items) => [...items, { role: 'user', content }])
    setDraft('')
    setLastRequest(content)
    setError(null)
    setOperation('Starting request...')
    onOperation?.(true)
    socket.current.send(JSON.stringify({ type: 'message', content, expected_version: project.version }))
  }

  return <aside className="plan-chat" aria-label="Plan assistant">
    <div className="chat-heading"><div><span className="eyebrow">MCP agent</span><h2>Edit the plan</h2></div><span className={`connection ${connection}`}>{connection}</span></div>
    <div className="transcript" aria-live="polite">
      {messages.filter((message) => message.role !== 'system').map((message, index) => <article className={`chat-message ${message.role}`} key={message.id || `${message.role}-${index}`}><strong>{message.role === 'user' ? 'You' : 'Assistant'}</strong><p>{message.content}</p></article>)}
      {!messages.some((message) => message.role !== 'system') && <p className="chat-empty">Ask for bulk changes, such as moving a milestone, reassigning work, or changing dependencies.</p>}
    </div>
    {operation && <div className="chat-operation" role="status"><span className="spinner" />{operation}<button type="button" onClick={() => socket.current?.send(JSON.stringify({ type: 'cancel' }))}>Cancel</button></div>}
    {error && <div className="chat-error" role="alert">{error} <button type="button" onClick={() => { setError(null); setDraft(lastRequest); if (connection === 'disconnected') setRetry((value) => value + 1) }}>Retry</button></div>}
    <form className="chat-composer" onSubmit={send}><label htmlFor="plan-request">Request a plan change</label><textarea id="plan-request" rows="3" value={draft} disabled={disabled || Boolean(operation) || connection !== 'connected'} onChange={(event) => setDraft(event.target.value)} placeholder="Move QA after launch prep and assign it to Maya" /><button type="submit" disabled={!draft.trim() || disabled || Boolean(operation) || connection !== 'connected'}>Send request</button></form>
  </aside>
}
