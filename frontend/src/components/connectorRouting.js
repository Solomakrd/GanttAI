const OBSTACLE_PADDING = 5
const EDGE_PADDING = 2
const FAN_LENGTH = 12
const FAN_SPACING = 3
const FAN_MAX_OFFSET = 6
const CORNER_RADIUS = 6
const CURVE_STEPS = 8
const BUCKET_SIZE = 48
const MAX_VALID_CANDIDATES = 64
const MAX_OCCUPANCY_SEGMENTS = 128
const EPSILON = 0.001

function rounded(value) {
  return Math.round(value * 1000) / 1000
}

function samePoint(a, b) {
  return Math.abs(a.x - b.x) < EPSILON && Math.abs(a.y - b.y) < EPSILON
}

function uniqueNumbers(values) {
  return [...new Set(values.map(rounded))].sort((a, b) => a - b)
}

function nearest(values, origin, limit) {
  return values.slice().sort((a, b) => Math.abs(a - origin) - Math.abs(b - origin) || a - b).slice(0, limit)
}

function compareLinks(a, b) {
  return Math.abs(b.end.y - b.start.y) - Math.abs(a.end.y - a.start.y) || a.key.localeCompare(b.key)
}

function fanOffsets(links, endpoint) {
  const groups = new Map()
  links.forEach((link) => {
    const id = endpoint === 'start' ? link.fromId : link.toId
    const group = groups.get(id) || []
    group.push(link)
    groups.set(id, group)
  })
  const offsets = new Map()
  groups.forEach((group) => {
    group.sort((a, b) => {
      const oppositeA = endpoint === 'start' ? a.end.y : a.start.y
      const oppositeB = endpoint === 'start' ? b.end.y : b.start.y
      return oppositeA - oppositeB || a.key.localeCompare(b.key)
    })
    const spacing = group.length > 1 ? Math.min(FAN_SPACING, FAN_MAX_OFFSET * 2 / (group.length - 1)) : 0
    group.forEach((link, index) => offsets.set(link.key, (index - (group.length - 1) / 2) * spacing))
  })
  return offsets
}

function segment(a, b, route) {
  return {
    a,
    b,
    route,
    minX: Math.min(a.x, b.x),
    maxX: Math.max(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxY: Math.max(a.y, b.y),
  }
}

function segmentsFor(points, route) {
  return points.slice(1).map((point, index) => segment(points[index], point, route))
    .filter((line) => !samePoint(line.a, line.b))
}

function cross(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}

function interaction(first, second) {
  const firstDx = first.b.x - first.a.x
  const firstDy = first.b.y - first.a.y
  const secondDx = second.b.x - second.a.x
  const secondDy = second.b.y - second.a.y
  const denominator = firstDx * secondDy - firstDy * secondDx
  if (Math.abs(denominator) > EPSILON) {
    const t = ((second.a.x - first.a.x) * secondDy - (second.a.y - first.a.y) * secondDx) / denominator
    const u = ((second.a.x - first.a.x) * firstDy - (second.a.y - first.a.y) * firstDx) / denominator
    if (t < -EPSILON || t > 1 + EPSILON || u < -EPSILON || u > 1 + EPSILON) return null
    return { point: { x: first.a.x + t * firstDx, y: first.a.y + t * firstDy }, overlap: 0 }
  }
  if (Math.abs(cross(first.a, first.b, second.a)) > EPSILON) return null
  const useX = Math.abs(firstDx) >= Math.abs(firstDy)
  const low = Math.max(useX ? first.minX : first.minY, useX ? second.minX : second.minY)
  const high = Math.min(useX ? first.maxX : first.maxY, useX ? second.maxX : second.maxY)
  if (high < low - EPSILON) return null
  return { point: null, overlap: Math.max(0, high - low), touch: high <= low + EPSILON }
}

function hitsObstacle(line, obstacle) {
  if (line.maxX <= obstacle.left || line.minX >= obstacle.right || line.maxY <= obstacle.top || line.minY >= obstacle.bottom) return false
  let low = 0
  let high = 1
  const dx = line.b.x - line.a.x
  const dy = line.b.y - line.a.y
  for (const [p, q] of [[-dx, line.a.x - obstacle.left], [dx, obstacle.right - line.a.x], [-dy, line.a.y - obstacle.top], [dy, obstacle.bottom - line.a.y]]) {
    if (Math.abs(p) < EPSILON) {
      if (q < 0) return false
    } else {
      const ratio = q / p
      if (p < 0) low = Math.max(low, ratio)
      else high = Math.min(high, ratio)
    }
  }
  return low < high - EPSILON
}

function hasSelfInteraction(lines) {
  for (let first = 0; first < lines.length; first += 1) {
    for (let second = first + 2; second < lines.length; second += 1) {
      const result = interaction(lines[first], lines[second])
      if (result && (!result.touch || result.overlap > EPSILON)) return true
      if (result?.touch) return true
    }
  }
  return false
}

function bucketKeys(line) {
  const keys = []
  for (let x = Math.floor(line.minX / BUCKET_SIZE); x <= Math.floor(line.maxX / BUCKET_SIZE); x += 1) {
    for (let y = Math.floor(line.minY / BUCKET_SIZE); y <= Math.floor(line.maxY / BUCKET_SIZE); y += 1) keys.push(`${x}:${y}`)
  }
  return keys
}

function createOccupancy() {
  const buckets = new Map()
  let nextId = 0
  return {
    add(lines) {
      lines.forEach((line) => {
        const entry = { ...line, id: nextId }
        nextId += 1
        bucketKeys(entry).forEach((key) => {
          const bucket = buckets.get(key) || []
          bucket.push(entry)
          buckets.set(key, bucket)
        })
      })
    },
    sample(bounds) {
      const found = new Map()
      bucketKeys(bounds).forEach((key) => (buckets.get(key) || []).forEach((entry) => found.set(entry.id, entry)))
      const centerX = (bounds.minX + bounds.maxX) / 2
      const centerY = (bounds.minY + bounds.maxY) / 2
      return [...found.values()].map((entry) => {
        const dx = (entry.minX + entry.maxX) / 2 - centerX
        const dy = (entry.minY + entry.maxY) / 2 - centerY
        return { entry, distance: dx * dx + dy * dy }
      }).sort((a, b) => a.distance - b.distance || a.entry.id - b.entry.id)
        .slice(0, MAX_OCCUPANCY_SEGMENTS).map(({ entry }) => entry)
    },
  }
}

function trueSharedAnchor(point, first, second) {
  return first.anchors.some((anchor) => samePoint(anchor.point, point)
    && second.anchors.some((other) => anchor.id === other.id && samePoint(other.point, point)))
}

function scoreCandidate(candidate, occupied) {
  let crossings = 0
  let overlap = 0
  candidate.lines.forEach((line) => occupied.forEach((prior) => {
    if (line.route.key === prior.route.key) return
    if (line.maxX < prior.minX - EPSILON || line.minX > prior.maxX + EPSILON || line.maxY < prior.minY - EPSILON || line.minY > prior.maxY + EPSILON) return
    const result = interaction(line, prior)
    if (!result) return
    if (result.point && trueSharedAnchor(result.point, line.route, prior.route)) return
    if (result.overlap > EPSILON) overlap += result.overlap
    else crossings += 1
  }))
  return overlap * 100000 + crossings * 10000 + candidate.bends * 8 + candidate.length
}

function pointAlong(from, to, distance) {
  const length = Math.hypot(to.x - from.x, to.y - from.y)
  if (!length) return { ...from }
  const ratio = distance / length
  return { x: rounded(from.x + (to.x - from.x) * ratio), y: rounded(from.y + (to.y - from.y) * ratio) }
}

function compact(points) {
  const unique = points.filter((point, index) => !index || !samePoint(point, points[index - 1]))
  return unique.filter((point, index) => {
    if (!index || index === unique.length - 1) return true
    const previous = unique[index - 1]
    const next = unique[index + 1]
    return !((Math.abs(previous.x - point.x) < EPSILON && Math.abs(point.x - next.x) < EPSILON)
      || (Math.abs(previous.y - point.y) < EPSILON && Math.abs(point.y - next.y) < EPSILON))
  })
}

function buildVisibleRoute(start, core, end, radius, route) {
  const points = [{ ...start }]
  let path = `M ${start.x} ${start.y}`
  const appendLine = (point) => {
    if (samePoint(points.at(-1), point)) return
    path += ` L ${point.x} ${point.y}`
    points.push({ ...point })
  }
  const appendQuadratic = (control, finish) => {
    const begin = points.at(-1)
    path += ` Q ${control.x} ${control.y}, ${finish.x} ${finish.y}`
    for (let step = 1; step <= CURVE_STEPS; step += 1) {
      const t = step / CURVE_STEPS
      const inverse = 1 - t
      points.push({
        x: rounded(inverse * inverse * begin.x + 2 * inverse * t * control.x + t * t * finish.x),
        y: rounded(inverse * inverse * begin.y + 2 * inverse * t * control.y + t * t * finish.y),
      })
    }
  }

  const startFan = core[0]
  appendQuadratic({ x: rounded((start.x + startFan.x) / 2), y: start.y }, startFan)
  for (let index = 1; index < core.length - 1; index += 1) {
    const previous = core[index - 1]
    const corner = core[index]
    const next = core[index + 1]
    const bend = Math.min(radius, Math.hypot(corner.x - previous.x, corner.y - previous.y) / 2, Math.hypot(next.x - corner.x, next.y - corner.y) / 2)
    if (bend < EPSILON) {
      appendLine(corner)
      continue
    }
    appendLine(pointAlong(corner, previous, bend))
    appendQuadratic(corner, pointAlong(corner, next, bend))
  }
  const endFan = core.at(-1)
  appendLine(endFan)
  appendQuadratic({ x: rounded((endFan.x + end.x) / 2), y: end.y }, end)
  const lines = segmentsFor(points, route)
  return {
    path,
    points,
    lines,
    bends: Math.max(0, core.length - 2),
    length: lines.reduce((sum, line) => sum + Math.hypot(line.b.x - line.a.x, line.b.y - line.a.y), 0),
  }
}

function fanLength(start, end, available) {
  const gap = end.x - start.x
  return Math.max(0, Math.min(FAN_LENGTH, gap > 0 ? gap / 3 : FAN_LENGTH, available))
}

function candidateCores(startFan, endFan, xs, ys) {
  const candidates = []
  if (Math.abs(startFan.y - endFan.y) < EPSILON) candidates.push([startFan, endFan])
  xs.forEach((x) => candidates.push([startFan, { x, y: startFan.y }, { x, y: endFan.y }, endFan]))
  ys.forEach((y) => xs.forEach((departureX) => xs.forEach((arrivalX) => {
    candidates.push([startFan, { x: departureX, y: startFan.y }, { x: departureX, y }, { x: arrivalX, y }, { x: arrivalX, y: endFan.y }, endFan])
  })))
  return candidates
}

function selectCandidates(valid) {
  const selected = new Map()
  const add = (candidate) => selected.set(candidate.signature, candidate)
  const byLength = valid.slice().sort((a, b) => a.length - b.length || a.signature.localeCompare(b.signature))
  const extents = valid.map((candidate) => ({
    candidate,
    minX: Math.min(...candidate.points.map((point) => point.x)),
    maxX: Math.max(...candidate.points.map((point) => point.x)),
    minY: Math.min(...candidate.points.map((point) => point.y)),
    maxY: Math.max(...candidate.points.map((point) => point.y)),
  }))
  for (const property of ['minX', 'maxX', 'minY', 'maxY']) {
    extents.slice().sort((a, b) => a[property] - b[property] || a.candidate.signature.localeCompare(b.candidate.signature)).slice(0, 4).forEach((entry) => add(entry.candidate))
    extents.slice().sort((a, b) => b[property] - a[property] || a.candidate.signature.localeCompare(b.candidate.signature)).slice(0, 4).forEach((entry) => add(entry.candidate))
  }
  byLength.forEach((candidate) => {
    if (selected.size < MAX_VALID_CANDIDATES) add(candidate)
  })
  return [...selected.values()].slice(0, MAX_VALID_CANDIDATES)
}

export function routeDependencies({ bars, links, width, height, rowHeight = 48, radius = CORNER_RADIUS }) {
  if (!links.length) return []
  const barsById = new Map(bars.map((bar) => [bar.id, bar]))
  const prepared = links.flatMap((link) => {
    const from = barsById.get(link.fromId)
    const to = barsById.get(link.toId)
    return from && to ? [{
      ...link,
      start: { x: rounded(from.left + from.width), y: rounded(from.top + from.height / 2) },
      end: { x: rounded(to.left), y: rounded(to.top + to.height / 2) },
    }] : []
  })
  const startOffsets = fanOffsets(prepared, 'start')
  const endOffsets = fanOffsets(prepared, 'end')
  const obstacles = bars.map((bar) => ({
    id: bar.id,
    left: Math.max(0, bar.left - OBSTACLE_PADDING),
    right: Math.min(width, bar.left + bar.width + OBSTACLE_PADDING),
    top: Math.max(0, bar.top - OBSTACLE_PADDING),
    bottom: Math.min(height, bar.top + bar.height + OBSTACLE_PADDING),
  }))
  const xCorridors = uniqueNumbers([EDGE_PADDING, width - EDGE_PADDING, ...obstacles.flatMap((item) => [item.left, item.right])])
    .filter((value) => value >= EDGE_PADDING && value <= width - EDGE_PADDING)
  const gutterValues = [EDGE_PADDING, height - EDGE_PADDING]
  for (let boundary = rowHeight; boundary < height; boundary += rowHeight) {
    gutterValues.push(boundary - 6, boundary - 3, boundary, boundary + 3, boundary + 6)
  }
  const gutters = uniqueNumbers(gutterValues).filter((value) => value >= EDGE_PADDING && value <= height - EDGE_PADDING)
  const occupancy = createOccupancy()
  const routes = new Map()
  const candidateSets = new Map()
  const selected = new Map()

  prepared.slice().sort(compareLinks).forEach((link) => {
    const startFan = {
      x: rounded(link.start.x + fanLength(link.start, link.end, width - EDGE_PADDING - link.start.x)),
      y: rounded(Math.max(EDGE_PADDING, Math.min(height - EDGE_PADDING, link.start.y + startOffsets.get(link.key)))),
    }
    const endFan = {
      x: rounded(link.end.x - fanLength(link.start, link.end, link.end.x - EDGE_PADDING)),
      y: rounded(Math.max(EDGE_PADDING, Math.min(height - EDGE_PADDING, link.end.y + endOffsets.get(link.key)))),
    }
    const route = { key: link.key, anchors: [{ id: link.fromId, point: link.start }, { id: link.toId, point: link.end }] }
    const relevantObstacles = obstacles.filter((item) => item.id !== link.fromId && item.id !== link.toId)
    const xOrigin = (startFan.x + endFan.x) / 2
    const yOrigin = (startFan.y + endFan.y) / 2
    const xLimits = uniqueNumbers([2, 4, 8, 16, xCorridors.length]).filter((value) => value <= xCorridors.length)
    const yLimits = uniqueNumbers([4, 8, 16, gutters.length]).filter((value) => value <= gutters.length)
    const seen = new Set()
    const valid = []
    let leastBlocked

    for (let stage = 0; stage < Math.max(xLimits.length, yLimits.length) && !valid.length; stage += 1) {
      const xs = uniqueNumbers([
        ...nearest(xCorridors, xOrigin, xLimits[Math.min(stage, xLimits.length - 1)]),
        EDGE_PADDING,
        width - EDGE_PADDING,
      ])
      const ys = uniqueNumbers([
        ...nearest(gutters, yOrigin, yLimits[Math.min(stage, yLimits.length - 1)]),
        EDGE_PADDING,
        height - EDGE_PADDING,
      ])
      for (const rawCore of candidateCores(startFan, endFan, xs, ys)) {
        const core = compact(rawCore)
        const signature = core.map((point) => `${point.x},${point.y}`).join(';')
        if (seen.has(signature)) continue
        seen.add(signature)
        const candidate = { ...buildVisibleRoute(link.start, core, link.end, radius, route), signature, core }
        if (hasSelfInteraction(candidate.lines)) continue
        const blocked = candidate.lines.reduce((count, line) => count + relevantObstacles.filter((obstacle) => hitsObstacle(line, obstacle)).length, 0)
        if (!leastBlocked || blocked < leastBlocked.blocked || (blocked === leastBlocked.blocked && candidate.length < leastBlocked.length)) leastBlocked = { ...candidate, blocked }
        if (!blocked) valid.push(candidate)
      }
    }

    const candidates = selectCandidates(valid)
    if (!candidates.length && leastBlocked) candidates.push(leastBlocked)
    if (!candidates.length) {
      const core = compact([startFan, endFan])
      candidates.push({ ...buildVisibleRoute(link.start, core, link.end, 0, route), signature: '' })
    }
    candidateSets.set(link.key, candidates)
    const bounds = candidates.flatMap((candidate) => candidate.lines).reduce((result, line) => ({
      a: { x: Math.min(result.a.x, line.minX), y: Math.min(result.a.y, line.minY) },
      b: { x: Math.max(result.b.x, line.maxX), y: Math.max(result.b.y, line.maxY) },
      minX: Math.min(result.minX, line.minX),
      maxX: Math.max(result.maxX, line.maxX),
      minY: Math.min(result.minY, line.minY),
      maxY: Math.max(result.maxY, line.maxY),
    }), { a: { x: width, y: height }, b: { x: 0, y: 0 }, minX: width, maxX: 0, minY: height, maxY: 0 })
    const occupied = occupancy.sample(bounds)
    let best
    candidates.forEach((candidate) => {
      const score = scoreCandidate(candidate, occupied)
      if (!best || score < best.score - EPSILON || (Math.abs(score - best.score) < EPSILON && candidate.signature < best.signature)) best = { ...candidate, score }
    })
    occupancy.add(best.lines)
    selected.set(link.key, best)
  })

  if (prepared.length <= 50) {
    prepared.slice().sort(compareLinks).forEach((link) => {
      const currentOccupancy = createOccupancy()
      prepared.slice().sort(compareLinks).forEach((other) => {
        if (other.key !== link.key) currentOccupancy.add(selected.get(other.key).lines)
      })
      const candidates = candidateSets.get(link.key)
      const bounds = candidates.flatMap((candidate) => candidate.lines).reduce((result, line) => ({
        minX: Math.min(result.minX, line.minX),
        maxX: Math.max(result.maxX, line.maxX),
        minY: Math.min(result.minY, line.minY),
        maxY: Math.max(result.maxY, line.maxY),
      }), { minX: width, maxX: 0, minY: height, maxY: 0 })
      const occupied = currentOccupancy.sample(bounds)
      let best
      candidates.forEach((candidate) => {
        const score = scoreCandidate(candidate, occupied)
        if (!best || score < best.score - EPSILON || (Math.abs(score - best.score) < EPSILON && candidate.signature < best.signature)) best = { ...candidate, score }
      })
      selected.set(link.key, best)
    })
  }

  prepared.forEach((link) => {
    const best = selected.get(link.key)
    routes.set(link.key, { ...link, path: best.path, points: best.points, waypoints: best.core })
  })

  return prepared.map((link) => routes.get(link.key))
}
