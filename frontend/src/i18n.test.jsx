import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import App from './App'
import { I18nProvider, detectLocale, useI18n } from './i18n'
import { PlanChat } from './components/PlanChat'
import { ExcelControls } from './components/ExcelControls'

const tasks = [
  { id: 'one', task: 'Customer text', description: '', assignee: 'Maya', duration: 2, start_date: '2026-10-05', end_date: '2026-10-06', predecessors: [] },
  { id: 'two', task: 'Second task', description: '', assignee: 'Leo', duration: 5, start_date: '2026-10-07', end_date: '2026-10-11', predecessors: ['one'] },
]

class Socket {
  static instance
  constructor() { this.listeners = {}; this.send = vi.fn(); Socket.instance = this }
  addEventListener(name, callback) { this.listeners[name] = callback }
  close() {}
  emit(payload) { this.listeners.message?.({ data: JSON.stringify(payload) }) }
}

function LocaleProbe() {
  const { locale, setLocale, t } = useI18n()
  return <><span>{locale}</span><span>{t('taskVersion', { count: 2, version: 4 })}</span><span>{t('taskVersion', { count: 5, version: 4 })}</span><button onClick={() => setLocale('en')}>English</button><button onClick={() => setLocale('bad')}>Bad</button></>
}

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  Object.defineProperty(window.navigator, 'language', { configurable: true, value: 'en-US' })
})

describe('localization', () => {
  it('detects supported primary subtags and defaults every unsupported value to Russian', () => {
    expect(detectLocale('ru-RU')).toBe('ru')
    expect(detectLocale('en-GB')).toBe('en')
    expect(detectLocale('fr-FR')).toBe('ru')
    expect(detectLocale('')).toBe('ru')
    expect(detectLocale(null)).toBe('ru')
    expect(detectLocale()).toBe('en')
  })

  it.each([
    ['ru-RU', 'ru', 'Рабочее пространство'],
    ['en-GB', 'en', 'Planning workspace'],
    ['fr-FR', 'ru', 'Рабочее пространство'],
  ])('applies the %s system locale to mounted metadata', (language, locale, title) => {
    Object.defineProperty(window.navigator, 'language', { configurable: true, value: language })
    render(<I18nProvider><LocaleProbe /></I18nProvider>)
    expect(document.documentElement.lang).toBe(locale)
    expect(document.title).toContain(title)
  })

  it('uses Russian fallback metadata and plurals, persists valid changes, and ignores malformed values', () => {
    Object.defineProperty(window.navigator, 'language', { configurable: true, value: 'de-DE' })
    render(<I18nProvider><LocaleProbe /></I18nProvider>)
    expect(screen.getByText('2 задачи · версия 4')).toBeInTheDocument()
    expect(screen.getByText('5 задач · версия 4')).toBeInTheDocument()
    expect(document.documentElement.lang).toBe('ru')
    expect(document.title).toContain('Рабочее пространство')
    fireEvent.click(screen.getByRole('button', { name: 'Bad' }))
    expect(document.documentElement.lang).toBe('ru')
    fireEvent.click(screen.getByRole('button', { name: 'English' }))
    expect(document.documentElement.lang).toBe('en')
    expect(localStorage.getItem('ganttai.locale')).toBe('en')
  })

  it('switches a mounted plan to Russian without losing zoom, selection, or domain text', async () => {
    localStorage.setItem('ganttai.locale', 'en')
    vi.stubGlobal('WebSocket', Socket)
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({
      project_id: 'p1', conversation_id: 'c1', workspace_token: 'token', version: 1, plan: { tasks }, messages: [],
    }) })
    const { container } = render(<I18nProvider><App /></I18nProvider>)
    await screen.findAllByText('Customer text')
    act(() => Socket.instance.emit({ type: 'connected', version: 1 }))
    fireEvent.change(screen.getByLabelText('Request a plan change'), { target: { value: 'Unsaved chat draft' } })
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit Customer text details' }))
    fireEvent.change(screen.getByLabelText('Task name'), { target: { value: 'Unsaved customer text' } })
    fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'ru' } })
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Изменить задачу')
    expect(screen.getByLabelText('Название задачи')).toHaveValue('Unsaved customer text')
    expect(screen.getByLabelText('Запрос на изменение плана')).toHaveValue('Unsaved chat draft')
    expect(screen.getAllByText('Customer text').length).toBeGreaterThan(0)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Проект 1')
    expect(container.querySelector('.chart-controls')).toHaveTextContent('125%')
    expect(container.querySelector('.month-strip')).toHaveTextContent(/октябр/i)
    expect(document.title).toContain('Рабочее пространство')
  })

  it('localizes progress while preserving final assistant text verbatim', () => {
    localStorage.setItem('ganttai.locale', 'ru')
    vi.stubGlobal('WebSocket', Socket)
    const project = { projectId: 'p1', token: 'token', version: 1, tasks, messages: [{ role: 'assistant', content: 'Backend free text' }] }
    render(<I18nProvider><PlanChat project={project} onPlan={vi.fn()} /></I18nProvider>)
    expect(screen.getByRole('complementary', { name: 'Ассистент планирования' })).toHaveTextContent('Backend free text')
    act(() => Socket.instance.emit({ type: 'connected', version: 1 }))
    fireEvent.change(screen.getByLabelText('Запрос на изменение плана'), { target: { value: 'Изменить задачу' } })
    fireEvent.click(screen.getByRole('button', { name: 'Отправить запрос' }))
    const requestId = JSON.parse(Socket.instance.send.mock.calls[0][0]).request_id
    act(() => Socket.instance.emit({ type: 'tool', request_id: requestId, tool: 'update_task', status: 'complete', task_count: 2 }))
    expect(screen.getByRole('status')).toHaveTextContent('Операция завершена: изменение задачи. Проверено 2 задачи.')
    expect(screen.getByRole('status')).not.toHaveTextContent('update_task')
  })

  it('localizes known client failures while preserving server error text verbatim', async () => {
    localStorage.setItem('ganttai.locale', 'ru')
    const fetch = vi.spyOn(global, 'fetch')
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ ok: false, status: 422, json: async () => ({ detail: 'Backend free text' }) })
      .mockResolvedValueOnce({ ok: false, status: 422, json: async () => ({ detail: {
        sheet: 'Tasks', row: 3, column: 'длительность', message: 'Server validation text',
      } }) })
      .mockResolvedValueOnce({ ok: true, blob: async () => { throw new Error('internal blob detail') } })
    render(<I18nProvider><ExcelControls tasks={tasks} onImport={vi.fn()} /></I18nProvider>)
    fireEvent.click(screen.getByRole('button', { name: 'Экспорт в Excel' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось подключиться к API планирования')
    fireEvent.click(screen.getByRole('button', { name: 'Экспорт в Excel' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Backend free text')
    fireEvent.click(screen.getByRole('button', { name: 'Экспорт в Excel' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Лист «Tasks», строка 3, столбец длительность: Server validation text')
    fireEvent.click(screen.getByRole('button', { name: 'Экспорт в Excel' }))
    const fallback = await screen.findByRole('alert')
    expect(fallback).toHaveTextContent('Не удалось выполнить операцию с книгой')
    expect(fallback).not.toHaveTextContent('internal blob detail')
    expect(fetch).toHaveBeenCalledTimes(4)
  })
})
