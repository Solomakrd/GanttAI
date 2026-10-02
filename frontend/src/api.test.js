import { afterEach, expect, it, vi } from 'vitest'
import { connectPlanChat, fetchPlan } from './api'

afterEach(() => vi.unstubAllGlobals())

it('uses same-origin paths when no API override is configured', async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ tasks: [] }) })
  vi.stubGlobal('fetch', fetch)

  await fetchPlan()

  expect(fetch).toHaveBeenCalledWith('/api/plan', { signal: undefined })
})

it('uses the current origin and protocol for chat', () => {
  const WebSocket = vi.fn(function FakeSocket() { this.addEventListener = vi.fn() })
  vi.stubGlobal('WebSocket', WebSocket)

  connectPlanChat({ projectId: 'project-1', token: 'secret' }, vi.fn())

  expect(WebSocket).toHaveBeenCalledWith(`${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/api/projects/project-1/chat`)
})
