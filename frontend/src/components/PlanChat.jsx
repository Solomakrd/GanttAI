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
  const socket = useRef(null)
  const reconnectNow = useRef(null)
  const pendingRequest = useRef(null)
  const retryRequest = useRef(null)
  const retryError = useRef(null)
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
          const pending = pendingRequest.current
          const validVersion = pending
            ? event.version === pending.expected_version || event.version === pending.expected_version + 1
            : event.version === version.current
          if (!validVersion) {
            pendingRequest.current = null
            retryRequest.current = null
            retryError.current = null
            setConnection('disconnected')
            setOperation(null)
            onOperation?.(false)
            setError({ key: 'staleChat' })
            return
          }
          setConnection('connected')
          setError(retryRequest.current ? retryError.current : null)
          if (pending) next.send(JSON.stringify(pending))
        }
        if (event.type === 'disconnected') {
          socket.current = null
          setConnection('disconnected')
          const terminal = [4401, 4408].includes(event.code)
          if (terminal) {
            pendingRequest.current = null
            retryRequest.current = null
            retryError.current = null
            setOperation(null)
            onOperation?.(false)
            setError({ key: 'chatDisconnected' })
          } else if (!pendingRequest.current && !retryRequest.current) {
            setError({ key: 'chatDisconnected' })
          }
          if (!terminal) {
            const delay = Math.min(1000 * 2 ** reconnectAttempts, 30000)
            reconnectAttempts += 1
            reconnectTimer = setTimeout(connect, delay)
          }
        }
        const correlated = ['status', 'tool', 'complete', 'clarification', 'cancelled'].includes(event.type) || (event.type === 'error' && event.code !== 'network' && event.code !== 'protocol') || (event.type === 'error' && event.code === 'protocol' && event.request_id)
        const pending = pendingRequest.current
        if (correlated && (!pending || event.request_id !== pending.request_id)) return
        if (event.type === 'error' && event.code === 'protocol' && !event.request_id && pending) {
          next.close()
          return
        }
        if (event.type === 'status' || event.type === 'tool') setOperation(event)
        if (event.type === 'complete') {
          if (event.version !== pending.expected_version + 1) {
            pendingRequest.current = null
            setOperation(null)
            onOperation?.(false)
            setError({ key: 'staleChat' })
            return
          }
          setMessages((items) => [...items, { role: 'assistant', content: event.message }])
          pendingRequest.current = null
          retryRequest.current = null
          retryError.current = null
          setOperation(null)
          onOperation?.(false)
          onPlan({ tasks: event.tasks, version: event.version })
        }
        if (event.type === 'clarification') {
          if (event.version !== pending.expected_version) return
          setMessages((items) => [...items, { role: 'assistant', content: event.message }])
          pendingRequest.current = null
          retryRequest.current = null
          retryError.current = null
          setOperation(null)
          onOperation?.(false)
        }
        if (event.type === 'cancelled') {
          pendingRequest.current = null
          retryRequest.current = null
          retryError.current = null
          setOperation(null)
          onOperation?.(false)
          setError(event.message)
        }
        if (event.type === 'error') {
          const eventError = event.code === 'protocol' ? { key: 'chatInvalid' } : event.code === 'network' ? { key: 'chatDisconnected' } : event.message
          if (event.code === 'network' && retryRequest.current) {
            setError(retryError.current)
            return
          }
          if (event.code !== 'network') {
            retryRequest.current = pending
            retryError.current = eventError
            pendingRequest.current = null
          }
          if (!pendingRequest.current) {
            setOperation(null)
            onOperation?.(false)
          }
          setError(eventError)
        }
      })
      current = next
      socket.current = next
    }

    reconnectNow.current = () => {
      clearTimeout(reconnectTimer)
      const active = socket.current
      socket.current = null
      active?.close()
      connect()
    }
    connect()
    return () => {
      stopped = true
      reconnectNow.current = null
      clearTimeout(reconnectTimer)
      current?.close()
      if (socket.current === current) socket.current = null
      if (pendingRequest.current) {
        pendingRequest.current = null
        onOperation?.(false)
      }
      retryRequest.current = null
      retryError.current = null
    }
  }, [project.projectId, project.token, onPlan, onOperation])

  const send = (event) => {
    event.preventDefault()
    const content = draft.trim()
    if (!content || disabled || operation || connection !== 'connected') return
    const requestId = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`
    const request = { type: 'message', request_id: requestId, content, expected_version: project.version }
    pendingRequest.current = request
    retryRequest.current = null
    retryError.current = null
    setMessages((items) => [...items, { role: 'user', content, request_id: requestId }])
    setDraft('')
    setError(null)
    setOperation({ key: 'startingRequest' })
    onOperation?.(true)
    socket.current.send(JSON.stringify(request))
  }

  const retryFailed = () => {
    const request = retryRequest.current
    if (request) {
      if (disabled || operation) return
      retryRequest.current = null
      retryError.current = null
      pendingRequest.current = request
      setError(null)
      setOperation({ key: 'startingRequest' })
      onOperation?.(true)
      if (connection === 'connected') socket.current.send(JSON.stringify(request))
      else reconnectNow.current?.()
      return
    }
    setError(null)
    reconnectNow.current?.()
  }

  return <aside className="plan-chat" aria-label={t('planAssistant')}>
    <div className="chat-heading"><span className="ai-orb" aria-hidden="true">✦</span><div><h2>{t('aiAssistant')}</h2><p>{t('editsPlan')}</p></div><span className={`connection ${connection}`}>{t(connection)}</span></div>
    <div className="transcript" aria-live="polite">
      {messages.filter((message) => message.role !== 'system').map((message, index) => <article className={`chat-message ${message.role}`} key={message.id || `${message.role}-${index}`}><strong>{message.role === 'user' ? t('you') : 'GanttAI'}</strong><div className="chat-bubble"><p>{message.content}</p></div></article>)}
      {!messages.some((message) => message.role !== 'system') && <p className="chat-empty">{t('chatEmpty')}</p>}
    </div>
    {operation && <div className="chat-operation" role="status"><span className="spinner" />{operationText(operation, t)}<button type="button" onClick={() => socket.current?.send(JSON.stringify({ type: 'cancel', request_id: pendingRequest.current?.request_id }))}>{t('cancel')}</button></div>}
    {error && <div className="chat-error" role="alert">{error.key ? t(error.key) : error} <button type="button" onClick={retryFailed}>{t('retry')}</button></div>}
    <form className="chat-composer" onSubmit={send}><label htmlFor="plan-request">{t('requestChange')}</label><div className="composer-box"><textarea id="plan-request" rows="3" value={draft} disabled={disabled || Boolean(operation) || connection !== 'connected'} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) send(event) }} placeholder={t('requestPlaceholder')} /><div><span>{t('newVersionHint')}</span><button type="submit" disabled={!draft.trim() || disabled || Boolean(operation) || connection !== 'connected'} aria-label={t('sendRequest')}>↑</button></div></div></form>
  </aside>
}
