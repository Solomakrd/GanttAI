import { useEffect, useRef, useState } from 'react'
import { connectPlanChat } from '../api'
import { useI18n } from '../i18n'

const toolKeys = {
  read_plan: 'chatToolReadPlan',
  add_task: 'chatToolAddTask',
  update_task: 'chatToolUpdateTask',
  set_dependencies: 'chatToolSetDependencies',
  delete_tasks: 'chatToolDeleteTasks',
}

function operationText(operation, t) {
  if (operation.key === 'startingRequest' && !operation.type) return t(operation.key)
  if (operation.type === 'status' && operation.code === 'planning') return t('chatPlanning')
  const toolKey = operation.type === 'tool' && Object.hasOwn(toolKeys, operation.tool) ? toolKeys[operation.tool] : null
  if (!toolKey || !['running', 'complete', 'failed'].includes(operation.status)) return t('chatOperation')
  const tool = t(toolKey)
  if (operation.status === 'running') return t('chatToolRunning', { tool })
  if (operation.status === 'failed') return t('chatToolFailed', { tool })
  if (Number.isSafeInteger(operation.task_count) && operation.task_count >= 0 && operation.task_count <= 500) {
    return t('chatToolCompleteWithCount', { tool, count: operation.task_count })
  }
  return t('chatToolComplete', { tool })
}

export function PlanChat({ project, disabled, onPlan, onOperation }) {
  const { t } = useI18n()
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
    let stopped = false
    let reconnectTimer
    let reconnectAttempts = 0
    let current

    const connect = () => {
      if (stopped) return
      setConnection('connecting')
      const next = connectPlanChat(project, (event) => {
        if (stopped || socket.current !== next) return
        if (event.type === 'connected') {
          reconnectAttempts = 0
          if (event.version !== version.current) {
            setConnection('disconnected')
            setError({ key: 'staleChat' })
            return
          }
          setConnection('connected')
          setError(null)
        }
        if (event.type === 'disconnected') {
          socket.current = null
          setConnection('disconnected')
          setOperation(null)
          onOperation?.(false)
          setError({ key: 'chatDisconnected' })
          if (![4401, 4408].includes(event.code)) {
            const delay = Math.min(1000 * 2 ** reconnectAttempts, 30000)
            reconnectAttempts += 1
            reconnectTimer = setTimeout(connect, delay)
          }
        }
        if (event.type === 'status' || event.type === 'tool') setOperation(event)
        if (event.type === 'complete') {
          if (event.version !== version.current + 1) {
            setOperation(null)
            onOperation?.(false)
            setError({ key: 'staleChat' })
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
          setError(event.code === 'protocol' ? { key: 'chatInvalid' } : event.code === 'network' ? { key: 'chatDisconnected' } : event.message)
        }
      })
      current = next
      socket.current = next
    }

    connect()
    return () => { stopped = true; clearTimeout(reconnectTimer); current?.close(); if (socket.current === current) socket.current = null }
  }, [project.projectId, project.token, onPlan, onOperation, retry])

  const send = (event) => {
    event.preventDefault()
    const content = draft.trim()
    if (!content || disabled || operation || connection !== 'connected') return
    setMessages((items) => [...items, { role: 'user', content }])
    setDraft('')
    setLastRequest(content)
    setError(null)
    setOperation({ key: 'startingRequest' })
    onOperation?.(true)
    socket.current.send(JSON.stringify({ type: 'message', content, expected_version: project.version }))
  }

  return <aside className="plan-chat" aria-label={t('planAssistant')}>
    <div className="chat-heading"><span className="ai-orb" aria-hidden="true">✦</span><div><h2>{t('aiAssistant')}</h2><p>{t('editsPlan')}</p></div><span className={`connection ${connection}`}>{t(connection)}</span></div>
    <div className="transcript" aria-live="polite">
      {messages.filter((message) => message.role !== 'system').map((message, index) => <article className={`chat-message ${message.role}`} key={message.id || `${message.role}-${index}`}><strong>{message.role === 'user' ? t('you') : 'GanttAI'}</strong><div className="chat-bubble"><p>{message.content}</p></div></article>)}
      {!messages.some((message) => message.role !== 'system') && <p className="chat-empty">{t('chatEmpty')}</p>}
    </div>
    {operation && <div className="chat-operation" role="status"><span className="spinner" />{operationText(operation, t)}<button type="button" onClick={() => socket.current?.send(JSON.stringify({ type: 'cancel' }))}>{t('cancel')}</button></div>}
    {error && <div className="chat-error" role="alert">{error.key ? t(error.key) : error} <button type="button" onClick={() => { setError(null); setDraft(lastRequest); if (connection === 'disconnected') setRetry((value) => value + 1) }}>{t('retry')}</button></div>}
    <form className="chat-composer" onSubmit={send}><label htmlFor="plan-request">{t('requestChange')}</label><div className="composer-box"><textarea id="plan-request" rows="3" value={draft} disabled={disabled || Boolean(operation) || connection !== 'connected'} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) send(event) }} placeholder={t('requestPlaceholder')} /><div><span>{t('newVersionHint')}</span><button type="submit" disabled={!draft.trim() || disabled || Boolean(operation) || connection !== 'connected'} aria-label={t('sendRequest')}>↑</button></div></div></form>
  </aside>
}
