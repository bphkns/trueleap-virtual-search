export type Message = {
  id: string
  chatId: string
  createdAt: string
  text: string
}

export type CursorDirection = 'older' | 'newer'

export type CursorPage = {
  items: Message[]
  prevCursor: string | null
  nextCursor: string | null
}

export const DEMO_CHAT_ID = 'chat-1'
export const DEFAULT_ANCHOR_ID = 'm-0500'
export const PAGE_SIZE = 20
export const AROUND_COUNT = 20

const LATENCY_MS = 90

const MESSAGES = buildMessages(1000)

function buildMessages(total: number): Message[] {
  const start = Date.parse('2026-01-01T00:00:00.000Z')
  const rows: Message[] = []

  for (let i = 1; i <= total; i++) {
    const id = `m-${String(i).padStart(4, '0')}`
    const createdAt = new Date(start + i * 60_000).toISOString()
    const hasKeyword = i === 500 || i % 37 === 0 || i % 53 === 0
    const keyword = hasKeyword ? ' needle' : ''
    const longToken =
      i === 500
        ? ' longtoken_without_breakpoints_longtoken_without_breakpoints'
        : ''

    rows.push({
      id,
      chatId: DEMO_CHAT_ID,
      createdAt,
      text: `Message ${i}${keyword} lorem ipsum dolor sit amet${longToken}`,
    })
  }

  return rows.sort(compareDesc)
}

function compareDesc(
  a: Pick<Message, 'createdAt' | 'id'>,
  b: Pick<Message, 'createdAt' | 'id'>,
): number {
  if (a.createdAt === b.createdAt) {
    if (a.id === b.id) return 0
    return a.id > b.id ? -1 : 1
  }
  return a.createdAt > b.createdAt ? -1 : 1
}

function encodeCursor(row: Pick<Message, 'createdAt' | 'id'>): string {
  return `${row.createdAt}::${row.id}`
}

function decodeCursor(cursor: string): { createdAt: string; id: string } | null {
  const splitIndex = cursor.lastIndexOf('::')
  if (splitIndex === -1) return null

  return {
    createdAt: cursor.slice(0, splitIndex),
    id: cursor.slice(splitIndex + 2),
  }
}

function bySearchTerm(term: string): Message[] {
  const q = term.trim().toLowerCase()
  if (!q) return MESSAGES
  return MESSAGES.filter((row) => row.text.toLowerCase().includes(q))
}

function pageFromSlice(all: Message[], slice: Message[]): CursorPage {
  if (!slice.length) {
    return {
      items: [],
      prevCursor: null,
      nextCursor: null,
    }
  }

  const first = slice[0]
  const last = slice[slice.length - 1]

  if (!first || !last) {
    return {
      items: [],
      prevCursor: null,
      nextCursor: null,
    }
  }

  const firstIndex = all.findIndex(
    (row) => row.id === first.id && row.createdAt === first.createdAt,
  )
  const lastIndex = all.findIndex(
    (row) => row.id === last.id && row.createdAt === last.createdAt,
  )

  return {
    items: slice,
    prevCursor: firstIndex > 0 ? encodeCursor(first) : null,
    nextCursor:
      lastIndex >= 0 && lastIndex < all.length - 1 ? encodeCursor(last) : null,
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export async function fetchSubsetForCollection(args: {
  q: string
  limit: number
}): Promise<Message[]> {
  await wait(LATENCY_MS)
  const rows = bySearchTerm(args.q)
  return rows.slice(0, Math.max(0, args.limit))
}

export async function fetchAroundWindow(args: {
  anchorId: string | null
  around: number
}): Promise<CursorPage & { totalMatches: number; resolvedAnchorId: string | null }> {
  await wait(LATENCY_MS)

  const rows = MESSAGES
  if (!rows.length) {
    return {
      items: [],
      prevCursor: null,
      nextCursor: null,
      totalMatches: 0,
      resolvedAnchorId: null,
    }
  }

  const around = Math.max(0, args.around)
  let anchorIndex = rows.findIndex((row) => row.id === args.anchorId)

  if (anchorIndex === -1) {
    const preferredIndex = rows.findIndex((row) => row.id === DEFAULT_ANCHOR_ID)
    anchorIndex = preferredIndex === -1 ? Math.floor(rows.length / 2) : preferredIndex
  }

  const start = Math.max(0, anchorIndex - around)
  const end = Math.min(rows.length, anchorIndex + around + 1)
  const slice = rows.slice(start, end)
  const page = pageFromSlice(rows, slice)
  const resolvedAnchorId = rows[anchorIndex]?.id ?? null

  return {
    ...page,
    totalMatches: rows.length,
    resolvedAnchorId,
  }
}

export async function fetchByCursor(args: {
  cursor: string | null
  direction: CursorDirection
  limit: number
}): Promise<CursorPage> {
  await wait(LATENCY_MS)

  const rows = MESSAGES
  if (!rows.length) {
    return {
      items: [],
      prevCursor: null,
      nextCursor: null,
    }
  }

  const limit = Math.max(0, args.limit)

  if (!args.cursor) {
    if (args.direction === 'older') {
      return pageFromSlice(rows, rows.slice(0, limit))
    }

    return {
      items: [],
      prevCursor: null,
      nextCursor: null,
    }
  }

  const tuple = decodeCursor(args.cursor)
  if (!tuple) {
    return {
      items: [],
      prevCursor: null,
      nextCursor: null,
    }
  }

  const pivot = rows.findIndex(
    (row) => row.id === tuple.id && row.createdAt === tuple.createdAt,
  )

  if (pivot === -1) {
    return {
      items: [],
      prevCursor: null,
      nextCursor: null,
    }
  }

  if (args.direction === 'older') {
    const start = pivot + 1
    return pageFromSlice(rows, rows.slice(start, start + limit))
  }

  const end = pivot
  const start = Math.max(0, end - limit)
  return pageFromSlice(rows, rows.slice(start, end))
}
