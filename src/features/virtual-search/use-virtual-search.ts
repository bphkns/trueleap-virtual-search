import * as React from 'react'
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

type WindowPageParam =
  | { kind: 'initial'; anchorId: string | null }
  | { kind: 'older'; cursor: string }
  | { kind: 'newer'; cursor: string }

type WindowPage = {
  items: Message[]
  prevCursor: string | null
  nextCursor: string | null
  resolvedAnchorId?: string | null
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

export function useVirtualSearch() {
  const parentRef = React.useRef<HTMLDivElement>(null)
  const heightsRef = React.useRef(new Map<string, number>())
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

  React.useEffect(() => {
    if (!import.meta.env.DEV) return

    const ids = windowRows.map((row) => row.id)
    const containsAnchor = activeAnchor ? ids.includes(activeAnchor) : false

    console.log('[virtual-search] final message window', {
      searchRun,
      activeAnchor,
      focusedId,
      count: windowRows.length,
      firstId: ids[0] ?? null,
      lastId: ids[ids.length - 1] ?? null,
      containsAnchor,
      ids,
    })
  }, [activeAnchor, focusedId, searchRun, windowRows])

  const sumHeights = React.useCallback((ids: string[]) => {
    return ids.reduce((total, id) => {
      return total + (heightsRef.current.get(id) ?? ESTIMATED_ROW_HEIGHT)
    }, 0)
  }, [])

  React.useEffect(() => {
    heightsRef.current.clear()
    centeredRunRef.current = -1

    const scroller = parentRef.current
    if (scroller) scroller.scrollTop = 0
  }, [searchRun])

  const loadOlder = React.useCallback(async () => {
    if (!hasNextPage || isFetchingNextPage || isPending) return

    const previousRows = windowRows
    const result = await fetchNextPage()
    const nextRows = dedupeById((result.data?.pages ?? []).flatMap((page) => page.items))
    const firstNextId = nextRows[0]?.id
    const firstNextIndexInPrevious = firstNextId
      ? previousRows.findIndex((row) => row.id === firstNextId)
      : -1

    if (firstNextIndexInPrevious > 0) {
      const removedIds = previousRows
        .slice(0, firstNextIndexInPrevious)
        .map((row) => row.id)
      const removedHeight = sumHeights(removedIds)

      requestAnimationFrame(() => {
        const scroller = parentRef.current
        if (!scroller) return
        scroller.scrollTop = Math.max(0, scroller.scrollTop - removedHeight)
      })
    }
  }, [
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isPending,
    sumHeights,
    windowRows,
  ])

  const loadNewer = React.useCallback(async () => {
    if (!hasPreviousPage || isFetchingPreviousPage || isPending) return

    const beforeTop = parentRef.current?.scrollTop ?? 0
    const previousRows = windowRows
    const result = await fetchPreviousPage()
    const nextRows = dedupeById((result.data?.pages ?? []).flatMap((page) => page.items))

    const firstPreviousId = previousRows[0]?.id
    const firstPreviousIndexInNext = firstPreviousId
      ? nextRows.findIndex((row) => row.id === firstPreviousId)
      : -1

    if (firstPreviousIndexInNext > 0) {
      const insertedIds = nextRows
        .slice(0, firstPreviousIndexInNext)
        .map((row) => row.id)
      const insertedHeight = sumHeights(insertedIds)

      requestAnimationFrame(() => {
        const scroller = parentRef.current
        if (!scroller) return
        scroller.scrollTop = beforeTop + insertedHeight
      })
    }
  }, [
    fetchPreviousPage,
    hasPreviousPage,
    isFetchingPreviousPage,
    isPending,
    sumHeights,
    windowRows,
  ])

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
    overscan: 0,
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
    if (!virtualItems.length || isPending) return

    const waitForJumpPosition =
      Boolean(activeAnchor) && centeredRunRef.current !== searchRun
    if (waitForJumpPosition) return

    const first = virtualItems[0]
    const last = virtualItems[virtualItems.length - 1]

    if (hasTopLoader && first && first.index <= 1) {
      void loadNewer()
    }

    const bottomLoaderIndex = topOffset + windowRows.length
    if (hasBottomLoader && last && last.index >= bottomLoaderIndex - 1) {
      void loadOlder()
    }
  }, [
    hasBottomLoader,
    hasTopLoader,
    isPending,
    loadNewer,
    loadOlder,
    activeAnchor,
    topOffset,
    searchRun,
    virtualItems,
    windowRows.length,
  ])

  React.useEffect(() => {
    if (!focusedId || isPending) {
      if (!activeAnchor && centeredRunRef.current !== searchRun) {
        centeredRunRef.current = searchRun
      }
      return
    }
    if (centeredRunRef.current === searchRun) return

    const rowIndex = windowRows.findIndex((row) => row.id === focusedId)
    if (rowIndex === -1) return

    const targetIndex = rowIndex + (hasTopLoader ? 1 : 0)
    let cancelled = false
    let attempts = 0

    const syncToAnchor = () => {
      if (cancelled) return

      virtualizer.scrollToIndex(targetIndex, {
        align: 'start',
      })

      requestAnimationFrame(() => {
        if (cancelled) return

        const firstVisibleIndex = virtualizer.getVirtualItems()[0]?.index ?? -1
        const inPosition = firstVisibleIndex === targetIndex

        if (inPosition || attempts >= 6) {
          centeredRunRef.current = searchRun
          return
        }

        attempts += 1
        syncToAnchor()
      })
    }

    requestAnimationFrame(syncToAnchor)

    return () => {
      cancelled = true
    }
  }, [
    activeAnchor,
    focusedId,
    hasTopLoader,
    isPending,
    searchRun,
    virtualizer,
    windowRows,
  ])

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

  const measureRow = React.useCallback(
    (id: string, element: HTMLElement | null) => {
      if (!element) return
      virtualizer.measureElement(element)
      heightsRef.current.set(id, element.getBoundingClientRect().height)
    },
    [virtualizer],
  )

  return {
    parentRef,
    measureRow,
    searchInput,
    setSearchInput,
    anchorInput,
    setAnchorInput,
    runSearch,
    loadLatest,
    activeTerm,
    activeAnchor,
    totalMatches,
    previewRows,
    jumpToCandidate,
    isPending,
    isError,
    error,
    windowRows,
    focusedId,
    virtualizer,
    virtualItems,
    hasTopLoader,
    hasBottomLoader,
    topOffset,
    isFetchingPreviousPage,
    isFetchingNextPage,
  }
}
