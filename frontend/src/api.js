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

export async function fetchPlan(signal) {
  const response = await fetch(`${API_URL}/api/plan`, { signal })
  if (!response.ok) throw new Error(`Plan API returned ${response.status}`)
  const payload = await response.json()
  const records = Array.isArray(payload.tasks) ? payload.tasks : []
  const parsed = records.map((record) => ({ task: parseTask(record), id: record?.id || 'unknown' }))
  const rejectedIds = parsed.filter(({ task }) => task === null).map(({ id }) => id)
  return {
    tasks: parsed.flatMap(({ task }) => task ? [task] : []),
    rejectedIds,
  }
}
