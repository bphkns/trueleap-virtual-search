# trueleap-virtual-search

TanStack Start demo for a chat-like virtualized message window with anchor jump.

## Stack

- TanStack Start (React)
- TanStack Query `useInfiniteQuery` (bidirectional cursor paging)
- TanStack DB `queryCollectionOptions` + `useLiveQuery` (search side panel list)
- TanStack Virtual `useVirtualizer` (main message panel)
- Tailwind CSS

## What this app does

- Uses 1000 sample messages (`m-0001` to `m-1000`)
- Default main panel: latest timeline window (continuous stream)
- Search side panel: filtered matches for quick anchor selection
- Click/search jump: main panel recenters around anchor (`prev_20 + anchor + next_20`)
- Main panel stays continuous and paginates both directions
  - fetch newer near top
  - fetch older near bottom
- Keeps memory bounded with `maxPages` while preserving scroll position

## Important behavior

- Search results are only for side panel discovery
- Main panel data always comes from timeline cursor APIs (not filtered sparse matches)
- So jumping to `m-0555` shows timeline around 555, not disjoint search-only rows

## Run locally

```bash
pnpm install
pnpm dev
```

Open `http://localhost:3000`.

## Preview production build

```bash
pnpm build
pnpm preview
```

Preview URL is usually shown as `http://127.0.0.1:4173`.

## Project structure

- `src/routes/index.tsx` - route wrapper + `ClientOnly`
- `src/features/virtual-search/use-virtual-search.ts` - data/virtual/pagination logic
- `src/features/virtual-search/virtual-search-example.tsx` - UI rendering
- `src/lib/virtual-search-data.ts` - sample dataset + cursor paging helpers
- `src/styles.css` - base styles

## Cursor model used in sample

- Stable sort: `createdAt DESC, id DESC`
- Cursor token: `createdAt::id`
- Directions:
  - `older` = items after cursor in DESC order
  - `newer` = items before cursor in DESC order
