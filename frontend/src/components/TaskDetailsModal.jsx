import { useEffect, useRef, useState } from 'react'

function derivedEnd(start, duration) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !Number.isInteger(duration) || duration < 1) return ''
  const date = new Date(`${start}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return ''
  date.setUTCDate(date.getUTCDate() + duration - 1)
  return date.toISOString().slice(0, 10)
}

export function TaskDetailsModal({ task, tasks, onClose, onSave, disabled = false }) {
  const [form, setForm] = useState({
    task: task.task, description: task.description, assignee: task.assignee,
    duration: String(task.duration), start_date: task.start_date, predecessors: task.predecessors,
  })
  const [error, setError] = useState(null)
  const [pending, setPending] = useState(false)
  const dialog = useRef(null)
  const firstField = useRef(null)
  const returnFocus = useRef(document.activeElement)

  useEffect(() => {
    firstField.current?.focus()
    const previous = returnFocus.current
    return () => { if (previous?.isConnected) previous.focus() }
  }, [])

  useEffect(() => {
    const keydown = (event) => {
      if (event.key === 'Escape' && !pending) onClose()
      if (event.key !== 'Tab' || !dialog.current) return
      const controls = [...dialog.current.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled)')]
      if (!controls.length) return
      const first = controls[0]
      const last = controls[controls.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', keydown)
    return () => document.removeEventListener('keydown', keydown)
  }, [onClose, pending])

  const set = (field, value) => setForm((current) => ({ ...current, [field]: value }))
  const submit = async (event) => {
    event.preventDefault()
    const duration = Number(form.duration)
    if (disabled || pending) return
    if (!form.task.trim()) return setError('Task name is required.')
    if (!form.assignee.trim()) return setError('Assignee is required.')
    if (!Number.isInteger(duration) || duration < 1 || duration > 730) return setError('Duration must be a whole number from 1 to 730.')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.start_date)) return setError('Choose a valid start date.')
    setPending(true)
    setError(null)
    try {
      await onSave({ ...form, task: form.task.trim(), assignee: form.assignee.trim(), duration })
    } catch (saveError) {
      setError(saveError.message || 'The task could not be saved. The current plan was kept.')
      setPending(false)
    }
  }

  const unavailable = pending || disabled
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !pending) onClose() }}>
    <section ref={dialog} className="task-modal" role="dialog" aria-modal="true" aria-labelledby="task-modal-title" aria-describedby="task-modal-help" aria-busy={pending}>
      <div className="modal-heading"><div><span className="eyebrow">Task details</span><h2 id="task-modal-title">Edit task</h2></div><button type="button" className="modal-close" aria-label="Close task details" disabled={pending} onClick={onClose}>&times;</button></div>
      <form onSubmit={submit}>
        <p id="task-modal-help">Update the task and save all changes as one new plan version.</p>
        <div className="modal-fields">
          <label>Task name<input ref={firstField} value={form.task} disabled={unavailable} onChange={(event) => set('task', event.target.value)} /></label>
          <label>Assignee<input value={form.assignee} disabled={unavailable} onChange={(event) => set('assignee', event.target.value)} /></label>
          <label>Duration (days)<input type="number" min="1" max="730" step="1" value={form.duration} disabled={unavailable} onChange={(event) => set('duration', event.target.value)} /></label>
          <label>Start date<input type="date" value={form.start_date} disabled={unavailable} onChange={(event) => set('start_date', event.target.value)} /></label>
          <label>End date<input type="date" value={derivedEnd(form.start_date, Number(form.duration))} readOnly aria-readonly="true" /></label>
          <label className="description-field">Description<textarea rows="4" value={form.description} disabled={unavailable} onChange={(event) => set('description', event.target.value)} /></label>
        </div>
        <fieldset disabled={unavailable}><legend>Predecessors</legend>
          <div className="predecessor-list">{tasks.filter((item) => item.id !== task.id).map((item) => <label key={item.id}><input type="checkbox" checked={form.predecessors.includes(item.id)} onChange={(event) => set('predecessors', event.target.checked ? [...form.predecessors, item.id] : form.predecessors.filter((id) => id !== item.id))} /> <span>{item.task}</span></label>)}</div>
          {tasks.length === 1 && <p>No other tasks are available.</p>}
        </fieldset>
        {error && <p className="modal-error" role="alert">{error}</p>}
        <div className="modal-actions"><button type="button" disabled={pending} onClick={onClose}>Cancel</button><button type="submit" disabled={unavailable}>{pending ? 'Saving...' : 'Save changes'}</button></div>
      </form>
    </section>
  </div>
}
