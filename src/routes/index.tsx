import * as React from 'react'
import { ClientOnly, createFileRoute } from '@tanstack/react-router'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { queryCollectionOptions } from '@tanstack/query-db-collection'
import { createCollection, useLiveQuery } from '@tanstack/react-db'
import { useVirtualizer } from '@tanstack/react-virtual'

import {
  AROUND_COUNT,
  DEFAULT_ANCHOR_ID,
  PAGE_SIZE,
  fetchAroundWindow,
  fetchByCursor,
  fetchSubsetForCollection,
  type Message,
} from '@/lib/virtual-search-data'

const CANDIDATE_LIMIT = 120
const MAX_ITEMS = 240
const MAX_PAGES = Math.ceil(MAX_ITEMS / PAGE_SIZE) + 2
const ESTIMATED_ROW_HEIGHT = 66
const TOP_TRIGGER_PX = 260
const BOTTOM_TRIGGER_PX = 260

type WindowPageParam =
  | { kind: 'initial'; anchorId: string | null }
  | { kind: 'older'; cursor: string }
  | { kind: 'newer'; cursor: string }

type WindowPage = {
  items: Message[]
  prevCursor: string | null
  nextCursor: string | null
  totalMatches?: number
  resolvedAnchorId?: string | null
}

export const Route = createFileRoute('/')({
  component: IndexRouteComponent,
})

function IndexRouteComponent() {
  return (
    <ClientOnly
      fallback={
        <main className="mx-auto flex h-[calc(100vh-5rem)] max-w-7xl items-center justify-center p-4 text-sm text-zinc-600">
          Loading interactive search demo...
        </main>
      }
    >
      <VirtualSearchExample />
    </ClientOnly>
  )
}

function dedupeById(rows: Message[]): Message[] {
  const seen = new Set<string>()
  const out: Message[] = []

  for (const row of rows) {
    if (seen.has(row.id)) continue
    seen.add(row.id)
    out.push(row)
  }

  return out
}

function VirtualSearchExample() {
  const parentRef = React.useRef<HTMLDivElement>(null)
  const heightsRef = React.useRef(new Map<string, number>())
  const previousIdsRef = React.useRef<string[]>([])
  const pendingShiftRef = React.useRef<'prepend' | 'append' | null>(null)
  const centeredRunRef = React.useRef<number>(-1)

  const [searchInput, setSearchInput] = React.useState('needle')
  const [anchorInput, setAnchorInput] = React.useState(DEFAULT_ANCHOR_ID)
  const [activeTerm, setActiveTerm] = React.useState('')
  const [activeAnchor, setActiveAnchor] = React.useState<string | null>(null)
  const [searchRun, setSearchRun] = React.useState(0)

  const queryClient = useQueryClient()

  const previewTerm = searchInput.trim()
  const previewCollectionId = React.useMemo(() => {
    const compact = previewTerm
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
    return `search-preview-${compact || 'all'}`
  }, [previewTerm])

  const previewCollection = React.useMemo(
    () =>
      createCollection(
        queryCollectionOptions<Message>({
          id: previewCollectionId,
          queryKey: ['messages-preview', previewTerm],
          queryClient,
          getKey: (item) => item.id,
          queryFn: async (ctx) => {
            const rawLimit = ctx.meta?.loadSubsetOptions?.limit
            const limit =
              typeof rawLimit === 'number' && Number.isFinite(rawLimit)
                ? rawLimit
                : CANDIDATE_LIMIT

            return fetchSubsetForCollection({
              q: previewTerm,
              limit,
            })
          },
        }),
      ),
    [previewCollectionId, previewTerm, queryClient],
  )

  const { data: previewRowsRaw = [] } = useLiveQuery((q) =>
    q
      .from({ message: previewCollection })
      .orderBy(({ message }) => message.createdAt, 'desc')
      .limit(CANDIDATE_LIMIT)
      .select(({ message }) => ({
        id: message.id,
        chatId: message.chatId,
        createdAt: message.createdAt,
        text: message.text,
      })),
  )

  const previewRows = React.useMemo(() => {
    const validRows = previewRowsRaw.filter((row): row is Message => {
      return (
        typeof row?.id === 'string' &&
        typeof row?.chatId === 'string' &&
        typeof row?.createdAt === 'string' &&
        typeof row?.text === 'string'
      )
    })

    return dedupeById(validRows)
  }, [previewRowsRaw])

  const {
    data,
    isPending,
    isError,
    error,
    hasNextPage,
    hasPreviousPage,
    isFetchingNextPage,
    isFetchingPreviousPage,
    fetchNextPage,
    fetchPreviousPage,
  } = useInfiniteQuery({
    queryKey: ['virtual-search-window', activeAnchor, searchRun] as const,
    initialPageParam: {
      kind: 'initial' as const,
      anchorId: activeAnchor,
    },
    maxPages: MAX_PAGES,
    queryFn: async ({
      pageParam,
    }: {
      pageParam: WindowPageParam
    }): Promise<WindowPage> => {
      if (pageParam.kind === 'initial') {
        if (!pageParam.anchorId) {
          return fetchByCursor({
            cursor: null,
            direction: 'older',
            limit: PAGE_SIZE,
          })
        }

        return fetchAroundWindow({
          anchorId: pageParam.anchorId ?? activeAnchor ?? DEFAULT_ANCHOR_ID,
          around: AROUND_COUNT,
        })
      }

      if (pageParam.kind === 'older') {
        return fetchByCursor({
          cursor: pageParam.cursor,
          direction: 'older',
          limit: PAGE_SIZE,
        })
      }

      return fetchByCursor({
        cursor: pageParam.cursor,
        direction: 'newer',
        limit: PAGE_SIZE,
      })
    },
    getNextPageParam: (lastPage): WindowPageParam | undefined => {
      if (!lastPage.nextCursor) return undefined
      return {
        kind: 'older',
        cursor: lastPage.nextCursor,
      }
    },
    getPreviousPageParam: (firstPage): WindowPageParam | undefined => {
      if (!firstPage.prevCursor) return undefined
      return {
        kind: 'newer',
        cursor: firstPage.prevCursor,
      }
    },
  })

  const firstPage = data?.pages[0]

  const focusedId =
    activeTerm.length > 0
      ? (firstPage?.resolvedAnchorId ?? activeAnchor ?? null)
      : null

  const totalMatches = activeTerm.length > 0 ? previewRows.length : null

  const windowRows = React.useMemo(() => {
    const pages = data?.pages ?? []
    return dedupeById(pages.flatMap((page) => page.items))
  }, [data?.pages])

  const sumHeights = React.useCallback((ids: string[]) => {
    return ids.reduce((total, id) => {
      return total + (heightsRef.current.get(id) ?? ESTIMATED_ROW_HEIGHT)
    }, 0)
  }, [])

  React.useEffect(() => {
    heightsRef.current.clear()
    previousIdsRef.current = []
    pendingShiftRef.current = null

    const scroller = parentRef.current
    if (scroller) scroller.scrollTop = 0
  }, [activeAnchor, activeTerm])

  React.useEffect(() => {
    const nextIds = windowRows.map((row) => row.id)
    const previousIds = previousIdsRef.current
    const mode = pendingShiftRef.current

    previousIdsRef.current = nextIds

    if (!mode || !previousIds.length || !nextIds.length) {
      pendingShiftRef.current = null
      return
    }

    const scroller = parentRef.current
    if (!scroller) {
      pendingShiftRef.current = null
      return
    }

    if (mode === 'prepend') {
      const firstPreviousId = previousIds[0]
      const firstPreviousIndexInNext = firstPreviousId
        ? nextIds.indexOf(firstPreviousId)
        : -1

      if (firstPreviousIndexInNext > 0) {
        const insertedIds = nextIds.slice(0, firstPreviousIndexInNext)
        scroller.scrollTop += sumHeights(insertedIds)
      }
    }

    if (mode === 'append') {
      const firstNextId = nextIds[0]
      const firstNextIndexInPrevious = firstNextId
        ? previousIds.indexOf(firstNextId)
        : -1

      if (firstNextIndexInPrevious > 0) {
        const removedIds = previousIds.slice(0, firstNextIndexInPrevious)
        scroller.scrollTop = Math.max(0, scroller.scrollTop - sumHeights(removedIds))
      }
    }

    pendingShiftRef.current = null
  }, [sumHeights, windowRows])

  const loadOlder = React.useCallback(async () => {
    if (!hasNextPage || isFetchingNextPage || isPending) return

    pendingShiftRef.current = 'append'
    try {
      await fetchNextPage()
    } finally {
      if (pendingShiftRef.current === 'append') {
        pendingShiftRef.current = null
      }
    }
  }, [fetchNextPage, hasNextPage, isFetchingNextPage, isPending])

  const loadNewer = React.useCallback(async () => {
    if (!hasPreviousPage || isFetchingPreviousPage || isPending) return

    pendingShiftRef.current = 'prepend'
    try {
      await fetchPreviousPage()
    } finally {
      if (pendingShiftRef.current === 'prepend') {
        pendingShiftRef.current = null
      }
    }
  }, [fetchPreviousPage, hasPreviousPage, isFetchingPreviousPage, isPending])

  const onScroll = React.useCallback(() => {
    const scroller = parentRef.current
    if (!scroller) return

    if (scroller.scrollTop <= TOP_TRIGGER_PX) {
      void loadNewer()
    }

    const distanceToBottom =
      scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight

    if (distanceToBottom <= BOTTOM_TRIGGER_PX) {
      void loadOlder()
    }
  }, [loadNewer, loadOlder])

  React.useEffect(() => {
    const scroller = parentRef.current
    if (!scroller) return
    if (!hasNextPage || isFetchingNextPage) return

    if (scroller.scrollHeight <= scroller.clientHeight + 2) {
      void loadOlder()
    }
  }, [hasNextPage, isFetchingNextPage, loadOlder, windowRows.length])

  const hasTopLoader = Boolean(hasPreviousPage)
  const hasBottomLoader = Boolean(hasNextPage)
  const topOffset = hasTopLoader ? 1 : 0

  const virtualizer = useVirtualizer({
    getScrollElement: () => parentRef.current,
    count:
      windowRows.length + (hasTopLoader ? 1 : 0) + (hasBottomLoader ? 1 : 0),
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    overscan: 10,
    getItemKey: (index) => {
      if (hasTopLoader && index === 0) return 'loader-top'
      const rowIndex = index - topOffset
      if (rowIndex >= 0 && rowIndex < windowRows.length) {
        return windowRows[rowIndex]!.id
      }
      return 'loader-bottom'
    },
  })

  const virtualItems = virtualizer.getVirtualItems()

  React.useEffect(() => {
    if (!focusedId || isPending) return
    if (centeredRunRef.current === searchRun) return

    const rowIndex = windowRows.findIndex((row) => row.id === focusedId)
    if (rowIndex === -1) return

    const targetIndex = rowIndex + (hasTopLoader ? 1 : 0)

    requestAnimationFrame(() => {
      virtualizer.scrollToIndex(targetIndex, {
        align: 'center',
      })
    })

    centeredRunRef.current = searchRun
  }, [focusedId, hasTopLoader, isPending, searchRun, virtualizer, windowRows])

  const runSearch = React.useCallback(() => {
    const term = searchInput.trim()

    if (!term) {
      setActiveTerm('')
      setActiveAnchor(null)
      setSearchRun((count) => count + 1)
      return
    }

    const anchor = anchorInput.trim() || DEFAULT_ANCHOR_ID
    setActiveTerm(term)
    setActiveAnchor(anchor)
    setSearchRun((count) => count + 1)
  }, [anchorInput, searchInput])

  const loadLatest = React.useCallback(() => {
    setActiveTerm('')
    setActiveAnchor(null)
    setSearchRun((count) => count + 1)
  }, [])

  const jumpToCandidate = React.useCallback(
    (id: string) => {
      const term = searchInput.trim()
      if (!term) return

      setAnchorInput(id)
      setActiveTerm(term)
      setActiveAnchor(id)
      setSearchRun((count) => count + 1)
    },
    [searchInput],
  )

  return (
    <main className="mx-auto flex h-[calc(100vh-5rem)] min-h-0 max-w-7xl flex-col gap-3 p-4 lg:flex-row">
      <aside className="flex min-h-0 w-full flex-col rounded-xl border border-zinc-200 bg-white shadow-sm lg:w-[360px] lg:shrink-0">
        <div className="space-y-3 border-b border-zinc-200 p-4">
          <h1 className="text-base font-semibold text-zinc-900">Search</h1>
          <p className="text-xs text-zinc-600">
            Use query + anchor, then jump. Window stays bounded while scrolling in both
            directions.
          </p>

          <input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search term (try: needle)"
            className="min-w-0 rounded-md border border-zinc-300 px-3 py-2 text-sm"
          />
          <input
            value={anchorInput}
            onChange={(event) => setAnchorInput(event.target.value)}
            placeholder="Anchor id (m-0500)"
            className="min-w-0 rounded-md border border-zinc-300 px-3 py-2 font-mono text-sm"
          />

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={runSearch}
              className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700"
            >
              Jump
            </button>
            <button
              type="button"
              onClick={loadLatest}
              className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
            >
              Latest 20
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-1 text-[11px] text-zinc-600">
            <code className="rounded bg-zinc-100 px-1.5 py-0.5">
              {activeTerm ? `search:${activeTerm}` : 'latest'}
            </code>
            <code className="rounded bg-zinc-100 px-1.5 py-0.5">
              anchor:{activeAnchor ?? '-'}
            </code>
            <code className="rounded bg-zinc-100 px-1.5 py-0.5">window:{windowRows.length}</code>
            <code className="rounded bg-zinc-100 px-1.5 py-0.5">matches:{totalMatches ?? '-'}</code>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <h2 className="text-sm font-semibold text-zinc-900">
            Search Results
            <span className="ml-2 rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] font-medium text-zinc-600">
              {previewRows.length}
            </span>
          </h2>
          <p className="mt-1 text-xs text-zinc-600">Click any result to set anchor + jump.</p>

          <div className="mt-3 space-y-2">
            {previewRows.length === 0 ? (
              <p className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
                No matches for current term.
              </p>
            ) : (
              previewRows.map((row, index) => {
                const selected = row.id === activeAnchor

                return (
                  <button
                    key={`${row.id}-${index}`}
                    type="button"
                    onClick={() => jumpToCandidate(row.id)}
                    className={`flex w-full min-w-0 flex-col gap-1 rounded-md border px-3 py-2 text-left transition-colors ${
                      selected
                        ? 'border-amber-400 bg-amber-50'
                        : 'border-zinc-200 bg-white hover:bg-zinc-50'
                    }`}
                  >
                    <span className="truncate font-mono text-xs text-zinc-500">{row.id}</span>
                    <span className="line-clamp-2 min-w-0 break-words text-xs text-zinc-700">
                      {row.text}
                    </span>
                  </button>
                )
              })
            )}
          </div>
        </div>
      </aside>

      <section
          ref={parentRef}
          onScroll={onScroll}
          className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-zinc-200 bg-white"
          style={{
            overflowAnchor: 'none',
            scrollbarGutter: 'stable',
          }}
        >
          {isPending ? (
            <div className="p-4 text-sm text-zinc-600">Loading messages...</div>
          ) : isError ? (
            <div className="p-4 text-sm text-red-600">{error?.message ?? 'Load failed'}</div>
          ) : windowRows.length === 0 ? (
            <div className="p-4 text-sm text-zinc-600">No rows to render.</div>
          ) : (
            <div
              style={{
                height: virtualizer.getTotalSize(),
                position: 'relative',
                width: '100%',
              }}
            >
              {virtualItems.map((virtualRow) => {
                const isTopLoader = hasTopLoader && virtualRow.index === 0
                const rowIndex = virtualRow.index - topOffset
                const isBottomLoader = hasBottomLoader && rowIndex >= windowRows.length
                const row =
                  rowIndex >= 0 && rowIndex < windowRows.length
                    ? windowRows[rowIndex]
                    : null

                return (
                  <div
                    key={virtualRow.key}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                  >
                    {isTopLoader ? (
                      <div className="border-b border-zinc-200 px-3 py-2 text-xs text-zinc-500">
                        {isFetchingPreviousPage
                          ? 'Loading newer...'
                          : 'Scroll near top for newer'}
                      </div>
                    ) : isBottomLoader ? (
                      <div className="border-b border-zinc-200 px-3 py-2 text-xs text-zinc-500">
                        {isFetchingNextPage
                          ? 'Loading older...'
                          : 'Scroll near bottom for older'}
                      </div>
                    ) : row ? (
                      <article
                        data-index={virtualRow.index}
                        ref={(element) => {
                          if (!element) return
                          virtualizer.measureElement(element)
                          heightsRef.current.set(
                            row.id,
                            element.getBoundingClientRect().height,
                          )
                        }}
                        className={`min-w-0 break-words border-b border-zinc-200 px-3 py-2 ${
                          row.id === focusedId ? 'bg-amber-50' : 'bg-white'
                        }`}
                      >
                        <div className="truncate text-xs text-zinc-500">
                          <span className="font-mono">{row.id}</span> | {row.createdAt}
                        </div>
                        <p className="mt-1 min-w-0 break-words text-sm leading-6 text-zinc-900">
                          {row.text}
                        </p>
                      </article>
                    ) : null}
                  </div>
                )
              })}
            </div>
          )}
      </section>
    </main>
  )
}
