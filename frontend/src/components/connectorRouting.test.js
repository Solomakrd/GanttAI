import { describe, expect, it } from 'vitest'
import { routeDependencies } from './connectorRouting'

const bar = (id, left, row, width = 30) => ({ id, left, top: row * 48 + 12, width, height: 24 })
const link = (fromId, toId, suffix = '') => ({ key: JSON.stringify([fromId, toId, suffix]), fromId, toId })

function route(bars, links, width = 300, height = Math.max(...bars.map((item) => item.top)) + 36) {
  return routeDependencies({ bars, links, width, height })
}

function segments(points) {
  return points.slice(1).map((point, index) => [points[index], point])
}

function segmentHitsBar([a, b], obstacle, padding = 4) {
  const left = obstacle.left - padding
  const right = obstacle.left + obstacle.width + padding
  const top = obstacle.top - padding
  const bottom = obstacle.top + obstacle.height + padding
  const steps = 100
  return Array.from({ length: steps + 1 }, (_, index) => index / steps).some((ratio) => {
    const x = a.x + (b.x - a.x) * ratio
    const y = a.y + (b.y - a.y) * ratio
    return x > left && x < right && y > top && y < bottom
  })
}

function properCrossings(first, second) {
  return segments(first).flatMap((a) => segments(second).map((b) => [a, b])).filter(([a, b]) => {
    const denominator = (a[1].x - a[0].x) * (b[1].y - b[0].y) - (a[1].y - a[0].y) * (b[1].x - b[0].x)
    if (Math.abs(denominator) < 0.001) return false
    const t = ((b[0].x - a[0].x) * (b[1].y - b[0].y) - (b[0].y - a[0].y) * (b[1].x - b[0].x)) / denominator
    const u = ((b[0].x - a[0].x) * (a[1].y - a[0].y) - (b[0].y - a[0].y) * (a[1].x - a[0].x)) / denominator
    return t > 0.001 && t < 0.999 && u > 0.001 && u < 0.999
  }).length
}

describe('routeDependencies', () => {
  it('routes a simple chain through the real 10px gap without reversing its fans', () => {
    const bars = [bar('a', 5, 0, 42), bar('b', 57, 1, 42)]
    const [result] = route(bars, [link('a', 'b')], 110)
    expect(result.points[0]).toEqual({ x: 47, y: 24 })
    expect(result.points.at(-1)).toEqual({ x: 57, y: 72 })
    expect(result.waypoints[0].x).toBeLessThanOrEqual(result.waypoints.at(-1).x)
    expect(result.path).toMatch(/^M 47 24 Q [\d.]+ 24,/)
    expect(result.path).toMatch(/Q [\d.]+ 72, 57 72$/)
  })

  it('fans branches and merges while retaining exact shared anchors', () => {
    const bars = [bar('root', 10, 1), bar('up', 100, 0), bar('down', 100, 2), bar('tail', 170, 1)]
    const results = route(bars, [link('root', 'up'), link('root', 'down'), link('up', 'tail'), link('down', 'tail')], 240)
    const outgoing = results.filter((item) => item.fromId === 'root')
    const incoming = results.filter((item) => item.toId === 'tail')
    expect(new Set(outgoing.map((item) => item.waypoints[0].y)).size).toBe(2)
    expect(new Set(incoming.map((item) => item.waypoints.at(-1).y)).size).toBe(2)
    expect(outgoing[0].points[0]).toEqual(outgoing[1].points[0])
    expect(incoming[0].points.at(-1)).toEqual(incoming[1].points.at(-1))
  })

  it('checks rounded visible geometry and avoids an intervening task', () => {
    const bars = [bar('from', 10, 0), bar('blocker', 45, 1, 130), bar('to', 210, 2)]
    const [result] = route(bars, [link('from', 'to')], 260)
    expect(result.path).toContain(' Q ')
    expect(segments(result.points).some((line) => segmentHitsBar(line, bars[1]))).toBe(false)
  })

  it('retains a farther chart-edge corridor when nearer routes are blocked', () => {
    const bars = [bar('a', 5, 0), bar('b', 5, 1), bar('c', 240, 2), bar('d', 180, 3)]
    const [outer] = route(bars, [link('a', 'd'), link('b', 'c')], 300)
    expect(outer.points.some((point) => Math.abs(point.x - 298) < 0.001)).toBe(true)
    expect(outer.points.some((point) => Math.abs(point.y - 190) < 0.001)).toBe(true)
    for (const obstacle of [bars[1], bars[2]]) {
      expect(segments(outer.points).some((line) => segmentHitsBar(line, obstacle))).toBe(false)
    }
  })

  it('uses route-aware bend checks to remove avoidable competing-route crossings', () => {
    const bars = [bar('a', 5, 0), bar('b', 5, 1), bar('c', 240, 2), bar('d', 180, 3)]
    const results = route(bars, [link('a', 'd'), link('b', 'c')], 300)
    expect(properCrossings(results[0].points, results[1].points)).toBe(0)
    expect(route(bars, [link('a', 'd'), link('b', 'c')], 300).map((item) => item.path)).toEqual(results.map((item) => item.path))
  })

  it('routes upward links within bounds and accepts arbitrary identifiers', () => {
    const bars = [bar('target-/[]', 160, 0), bar('middle', 70, 1, 80), bar('source-::', 10, 2)]
    const [result] = route(bars, [link('source-::', 'target-/[]')], 220)
    expect(result.points[0].y).toBeGreaterThan(result.points.at(-1).y)
    result.points.forEach(({ x, y }) => {
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThanOrEqual(220)
      expect(y).toBeGreaterThanOrEqual(0)
      expect(y).toBeLessThanOrEqual(144)
    })
    expect(segments(result.points).some((line) => segmentHitsBar(line, bars[1]))).toBe(false)
  })

  it.each([0.75, 1, 1.25, 1.5, 1.75])('recomputes deterministically from rendered geometry at %sx zoom', (zoom) => {
    const bars = [bar('a', 5, 0, 42), bar('b', 109, 1, 42)].map((item) => ({ ...item, left: (item.left - 5) * zoom + 5, width: item.width * zoom }))
    const width = 156 * zoom
    const first = route(bars, [link('a', 'b')], width)[0]
    const second = route(bars, [link('a', 'b')], width)[0]
    expect(first.path).toBe(second.path)
    expect(first.points).toEqual(second.points)
  })

  it('keeps candidate scoring deterministic after occupancy sampling is capped', () => {
    const bars = Array.from({ length: 14 }, (_, index) => bar(`task-${index}`, 5 + index * 36, index, 28))
    const links = bars.flatMap((to, toIndex) => bars.slice(0, toIndex).map((from) => link(from.id, to.id)))
    const first = route(bars, links, 520).map((item) => item.path)
    expect(route(bars, links, 520).map((item) => item.path)).toEqual(first)
  })

  it('routes a valid 20-task complete DAG within 1000ms', () => {
    const bars = Array.from({ length: 20 }, (_, index) => bar(`task-${index}`, 5 + index * 52, index, 42))
    const links = bars.flatMap((to, toIndex) => bars.slice(0, toIndex).map((from) => link(from.id, to.id)))
    const started = performance.now()
    const results = route(bars, links, 1100)
    expect(results).toHaveLength(190)
    expect(performance.now() - started).toBeLessThan(1000)
    results.forEach((result) => result.points.forEach(({ x, y }) => {
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThanOrEqual(1100)
      expect(y).toBeGreaterThanOrEqual(0)
      expect(y).toBeLessThanOrEqual(960)
    }))
  })
})
