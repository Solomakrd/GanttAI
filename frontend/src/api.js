const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

function clientError(message, translationKey, translationValues) {
  const error = new Error(message)
  error.translationKey = translationKey
  error.translationValues = translationValues
  return error
}

function serverError(message, serverMessage = message, translationKey, translationValues) {
  const error = new Error(message)
  error.serverProvided = true
  error.serverMessage = serverMessage
  error.translationKey = translationKey
  error.translationValues = translationValues
  return error
}

function parseTask(record) {
  const validText = (value, required = false) => typeof value === 'string' && value.length <= 32767 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value) && (!required || value.trim())
  const isCanonicalDate = (value) => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
    const parsed = new Date(`${value}T00:00:00Z`)
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
  }
  const validDates = record && isCanonicalDate(record.start_date) && isCanonicalDate(record.end_date)
  const validShape = record && validText(record.id, true) && validText(record.task, true) && validText(record.description) && validText(record.assignee, true) &&
    Number.isInteger(record.duration) && record.duration > 0 && validDates &&
    Array.isArray(record.predecessors) && record.predecessors.every((value) => validText(value, true))
  if (!validShape || record.end_date < record.start_date) return null
  return record
}

export function parsePlan(payload, strict = false) {
  const records = Array.isArray(payload?.tasks) ? payload.tasks : []
  const parsed = records.map((record) => ({ task: parseTask(record), id: record?.id || 'unknown' }))
  const rejectedIds = parsed.filter(({ task }) => task === null).map(({ id }) => id)
  const result = {
    tasks: parsed.flatMap(({ task }) => task ? [task] : []),
    rejectedIds,
  }
  const ids = new Set(result.tasks.map((task) => task.id))
  const names = new Set(result.tasks.map((task) => task.task))
  const byId = new Map(result.tasks.map((task) => [task.id, task]))
  const pending = new Map(result.tasks.map((task) => [task.id, task.predecessors.length]))
  const children = new Map(result.tasks.map((task) => [task.id, []]))
  let links = 0
  let graphInvalid = ids.size !== result.tasks.length || names.size !== result.tasks.length || result.tasks.length > 500
  for (const task of result.tasks) {
    links += task.predecessors.length
    if (task.duration > 730 || new Set(task.predecessors).size !== task.predecessors.length || task.predecessors.includes(task.id) ||
      task.predecessors.some((id) => !ids.has(id)) || new Date(`${task.end_date}T00:00:00Z`) - new Date(`${task.start_date}T00:00:00Z`) !== (task.duration - 1) * 86400000) graphInvalid = true
    for (const predecessor of task.predecessors) if (children.has(predecessor)) children.get(predecessor).push(task.id)
  }
  const ready = [...pending].filter(([, count]) => count === 0).map(([id]) => id)
  let visited = 0
  while (ready.length) {
    const id = ready.shift()
    visited += 1
    for (const child of children.get(id)) {
      pending.set(child, pending.get(child) - 1)
      if (pending.get(child) === 0) ready.push(child)
    }
  }
  if (visited !== result.tasks.length || links > 10000) graphInvalid = true
  for (const task of result.tasks) {
    if (task.predecessors.some((id) => byId.get(id)?.end_date >= task.start_date)) graphInvalid = true
  }
  if (result.tasks.length) {
    const starts = result.tasks.map((task) => new Date(`${task.start_date}T00:00:00Z`).getTime())
    const ends = result.tasks.map((task) => new Date(`${task.end_date}T00:00:00Z`).getTime())
    if ((Math.max(...ends) - Math.min(...starts)) / 86400000 + 1 > 730) graphInvalid = true
  }
  if (strict && (!Array.isArray(payload?.tasks) || rejectedIds.length || graphInvalid)) {
    throw clientError('The API returned an invalid plan. The current plan has been kept; reload or retry.', 'invalidPlan')
  }
  return result
}

async function request(path, options) {
  let response
  try {
    response = await fetch(`${API_URL}${path}`, options)
  } catch (error) {
    if (error.name === 'AbortError') throw error
    throw clientError('Cannot reach the Plan API. Check your connection and that the API is running, then retry.', 'apiUnavailable')
  }
  if (!response.ok) {
    let message
    try {
      const { detail } = await response.json()
      if (typeof detail === 'string') throw serverError(detail)
      if (Array.isArray(detail)) {
        message = detail.map((issue) => `${issue.loc?.join(' / ')}: ${issue.msg}`).join('; ')
        if (message) throw serverError(message)
      }
      else if (detail?.message) {
        const location = [detail.sheet && `Sheet “${detail.sheet}”`, detail.row && `row ${detail.row}`, detail.column && `column ${detail.column}`].filter(Boolean).join(', ')
        message = `${location ? `${location}: ` : ''}${detail.message}`
        throw serverError(message, detail.message, 'apiValidationDetail', {
          sheet: detail.sheet, row: detail.row, column: detail.column, message: detail.message,
        })
      }
    } catch (error) {
      if (error.serverProvided) throw error
      // Keep the HTTP status if the server returned a non-JSON error.
    }
    throw clientError(`Plan API returned ${response.status}. Please retry.`, 'apiStatus', { status: response.status })
  }
  return response
}

export async function fetchPlan(signal) {
  const response = await request('/api/plan', { signal })
  return parsePlan(await response.json())
}

function snapshot(payload) {
  if (Array.isArray(payload?.tasks)) {
    const parsed = parsePlan(payload)
    return { projectId: null, conversationId: null, version: 0, tasks: parsed.tasks, rejectedIds: parsed.rejectedIds, messages: [], token: null, legacy: true }
  }
  const parsed = parsePlan(payload?.plan, true)
  if (typeof payload?.project_id !== 'string' || !Number.isInteger(payload.version) || !Array.isArray(payload.messages)) throw clientError('The API returned an invalid project snapshot.', 'invalidProject')
  return { projectId: payload.project_id, conversationId: payload.conversation_id, version: payload.version, tasks: parsed.tasks, rejectedIds: [], messages: payload.messages, token: payload.workspace_token || null, legacy: false }
}

function workspaceProject(record) {
  if (typeof record?.project_id !== 'string' || !Number.isInteger(record.version)) throw clientError('The API returned an invalid workspace.', 'invalidWorkspace')
  return { projectId: record.project_id, version: record.version, createdAt: record.created_at }
}

export async function loadWorkspace(signal) {
  const token = localStorage.getItem('ganttai.workspaceToken')
  let response
  if (token) {
    response = await request('/api/workspace', { signal, headers: { 'X-Workspace-Token': token } })
  } else {
    response = await request('/api/projects', { method: 'POST', signal })
  }
  const payload = await response.json()
  const result = token ? snapshot(payload.active_project) : snapshot(payload)
  result.workspaceProjects = token ? payload.projects.map(workspaceProject) : [{ projectId: result.projectId, version: result.version }]
  result.token = result.token || token
  if (result.token) localStorage.setItem('ganttai.workspaceToken', result.token)
  return result
}

export async function createProject(signal) {
  const token = localStorage.getItem('ganttai.workspaceToken')
  const response = await request('/api/projects', { method: 'POST', signal, headers: token ? { 'X-Workspace-Token': token } : {} })
  const result = snapshot(await response.json())
  result.token = result.token || token
  if (result.token) localStorage.setItem('ganttai.workspaceToken', result.token)
  return result
}

export async function loadProject(projectId, token, signal) {
  const response = await request(`/api/projects/${projectId}`, { signal, headers: { 'X-Workspace-Token': token } })
  const result = snapshot(await response.json())
  result.token = token
  return result
}

export async function undoProject(project, signal) {
  const response = await request(`/api/projects/${project.projectId}/undo`, {
    method: 'POST', signal, headers: { 'Content-Type': 'application/json', 'X-Workspace-Token': project.token },
    body: JSON.stringify({ expected_version: project.version }),
  })
  return snapshot(await response.json())
}

export async function updateProjectTask(project, taskId, values, signal) {
  const response = await request(`/api/projects/${project.projectId}/tasks/${encodeURIComponent(taskId)}`, {
    method: 'PATCH', signal, headers: { 'Content-Type': 'application/json', 'X-Workspace-Token': project.token },
    body: JSON.stringify({ expected_version: project.version, ...values }),
  })
  const result = snapshot(await response.json())
  result.token = project.token
  return result
}

export async function importPlan(file, startDate, signal) {
  const body = new FormData()
  body.append('file', file)
  body.append('start_date', startDate)
  const response = await request('/api/plan/import', { method: 'POST', body, signal })
  const payload = await response.json()
  const parsed = parsePlan(payload)
  if (!Array.isArray(payload.tasks) || parsed.rejectedIds.length) {
    throw clientError('The API returned an invalid plan. The current plan has been kept; correct the workbook or retry.', 'invalidImportedPlan')
  }
  return parsed.tasks
}

export async function importProjectPlan(project, file, startDate, signal) {
  if (!project?.projectId) return { tasks: await importPlan(file, startDate, signal) }
  const body = new FormData()
  body.append('file', file)
  body.append('start_date', startDate)
  body.append('expected_version', String(project.version))
  const response = await request(`/api/projects/${project.projectId}/import`, { method: 'POST', body, signal, headers: { 'X-Workspace-Token': project.token } })
  return snapshot(await response.json())
}

export function connectPlanChat(project, onEvent) {
  const wsUrl = API_URL.replace(/^http/, 'ws')
  const socket = new WebSocket(`${wsUrl}/api/projects/${project.projectId}/chat`)
  socket.addEventListener('open', () => socket.send(JSON.stringify({ type: 'auth', token: project.token })))
  socket.addEventListener('message', (event) => {
    try {
      const payload = JSON.parse(event.data)
      if (payload.type === 'complete') payload.tasks = parsePlan(payload.plan, true).tasks
      onEvent(payload)
    } catch {
      onEvent({ type: 'error', code: 'protocol', message: 'The chat returned an invalid response. The current plan was kept.' })
    }
  })
  socket.addEventListener('close', () => onEvent({ type: 'disconnected' }))
  socket.addEventListener('error', () => onEvent({ type: 'error', code: 'network', message: 'Chat disconnected. Reconnect and retry.' }))
  return socket
}

export async function exportPlan(tasks, signal) {
  const response = await request('/api/plan/export', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tasks }), signal,
  })
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  try {
    link.href = url
    link.download = 'gantt-plan.xlsx'
    document.body.append(link)
    link.click()
  } finally {
    link.remove()
    // Let the browser consume the click before releasing its download URL.
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}
