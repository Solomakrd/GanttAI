const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

function parseTask(record) {
  const isCanonicalDate = (value) => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
    const parsed = new Date(`${value}T00:00:00Z`)
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
  }
  const validDates = record && isCanonicalDate(record.start_date) && isCanonicalDate(record.end_date)
  const validShape = record && typeof record.id === 'string' && record.id &&
    typeof record.task === 'string' && record.task && typeof record.assignee === 'string' &&
    Number.isInteger(record.duration) && record.duration > 0 && validDates &&
    Array.isArray(record.predecessors)
  if (!validShape || record.end_date < record.start_date) return null
  return record
}

function parsePlan(payload) {
  const records = Array.isArray(payload.tasks) ? payload.tasks : []
  const parsed = records.map((record) => ({ task: parseTask(record), id: record?.id || 'unknown' }))
  const rejectedIds = parsed.filter(({ task }) => task === null).map(({ id }) => id)
  return {
    tasks: parsed.flatMap(({ task }) => task ? [task] : []),
    rejectedIds,
  }
}

async function request(path, options) {
  let response
  try {
    response = await fetch(`${API_URL}${path}`, options)
  } catch (error) {
    if (error.name === 'AbortError') throw error
    throw new Error('Cannot reach the Plan API. Check your connection and that the API is running, then retry.')
  }
  if (!response.ok) {
    let message = `Plan API returned ${response.status}. Please retry.`
    try {
      const { detail } = await response.json()
      if (typeof detail === 'string') message = detail
      else if (Array.isArray(detail)) message = detail.map((issue) => `${issue.loc?.join(' / ')}: ${issue.msg}`).join('; ')
      else if (detail?.message) {
        const location = [detail.sheet && `Sheet “${detail.sheet}”`, detail.row && `row ${detail.row}`, detail.column && `column ${detail.column}`].filter(Boolean).join(', ')
        message = `${location ? `${location}: ` : ''}${detail.message}`
      }
    } catch { /* Keep the HTTP status if the server returned a non-JSON error. */ }
    throw new Error(message)
  }
  return response
}

export async function fetchPlan(signal) {
  const response = await request('/api/plan', { signal })
  return parsePlan(await response.json())
}

export async function importPlan(file, startDate, signal) {
  const body = new FormData()
  body.append('file', file)
  body.append('start_date', startDate)
  const response = await request('/api/plan/import', { method: 'POST', body, signal })
  const payload = await response.json()
  const parsed = parsePlan(payload)
  if (!Array.isArray(payload.tasks) || parsed.rejectedIds.length) {
    throw new Error('The API returned an invalid plan. The current plan has been kept; correct the workbook or retry.')
  }
  return parsed.tasks
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
