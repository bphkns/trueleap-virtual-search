import { useVirtualSearch } from './use-virtual-search'

export function VirtualSearchExample() {
  const search = useVirtualSearch()

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
            value={search.searchInput}
            onChange={(event) => search.setSearchInput(event.target.value)}
            placeholder="Search term (try: needle)"
            className="min-w-0 rounded-md border border-zinc-300 px-3 py-2 text-sm"
          />
          <input
            value={search.anchorInput}
            onChange={(event) => search.setAnchorInput(event.target.value)}
            placeholder="Anchor id (m-0500)"
            className="min-w-0 rounded-md border border-zinc-300 px-3 py-2 font-mono text-sm"
          />

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={search.runSearch}
              className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700"
            >
              Jump
            </button>
            <button
              type="button"
              onClick={search.loadLatest}
              className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
            >
              Latest 20
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-1 text-[11px] text-zinc-600">
            <code className="rounded bg-zinc-100 px-1.5 py-0.5">
              {search.activeTerm ? `search:${search.activeTerm}` : 'latest'}
            </code>
            <code className="rounded bg-zinc-100 px-1.5 py-0.5">
              anchor:{search.activeAnchor ?? '-'}
            </code>
            <code className="rounded bg-zinc-100 px-1.5 py-0.5">
              window:{search.windowRows.length}
            </code>
            <code className="rounded bg-zinc-100 px-1.5 py-0.5">
              matches:{search.totalMatches ?? '-'}
            </code>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <h2 className="text-sm font-semibold text-zinc-900">
            Search Results
            <span className="ml-2 rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] font-medium text-zinc-600">
              {search.previewRows.length}
            </span>
          </h2>
          <p className="mt-1 text-xs text-zinc-600">Click any result to set anchor + jump.</p>

          <div className="mt-3 space-y-2">
            {search.previewRows.length === 0 ? (
              <p className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
                No matches for current term.
              </p>
            ) : (
              search.previewRows.map((row, index) => {
                const selected = row.id === search.activeAnchor

                return (
                  <button
                    key={`${row.id}-${index}`}
                    type="button"
                    onClick={() => search.jumpToCandidate(row.id)}
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
        ref={search.parentRef}
        className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-zinc-200 bg-white"
        style={{
          overflowAnchor: 'none',
          scrollbarGutter: 'stable',
        }}
      >
        {search.isPending ? (
          <div className="p-4 text-sm text-zinc-600">Loading messages...</div>
        ) : search.isError ? (
          <div className="p-4 text-sm text-red-600">
            {search.error?.message ?? 'Load failed'}
          </div>
        ) : search.windowRows.length === 0 ? (
          <div className="p-4 text-sm text-zinc-600">No rows to render.</div>
        ) : (
          <div
            style={{
              height: search.virtualizer.getTotalSize(),
              position: 'relative',
              width: '100%',
            }}
          >
            {search.virtualItems.map((virtualRow) => {
              const isTopLoader = search.hasTopLoader && virtualRow.index === 0
              const rowIndex = virtualRow.index - search.topOffset
              const isBottomLoader =
                search.hasBottomLoader && rowIndex >= search.windowRows.length
              const row =
                rowIndex >= 0 && rowIndex < search.windowRows.length
                  ? search.windowRows[rowIndex]
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
                      {search.isFetchingPreviousPage
                        ? 'Loading newer...'
                        : 'Scroll near top for newer'}
                    </div>
                  ) : isBottomLoader ? (
                    <div className="border-b border-zinc-200 px-3 py-2 text-xs text-zinc-500">
                      {search.isFetchingNextPage
                        ? 'Loading older...'
                        : 'Scroll near bottom for older'}
                    </div>
                  ) : row ? (
                    <article
                      data-index={virtualRow.index}
                      ref={(element) => {
                        search.measureRow(row.id, element)
                      }}
                      className={`min-w-0 break-words border-b border-zinc-200 px-3 py-2 ${
                        row.id === search.focusedId ? 'bg-amber-50' : 'bg-white'
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
