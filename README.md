# trueleap-virtual-search

Minimal TanStack Start demo for chat-search windowing with:

- TanStack DB `queryCollectionOptions` for search preview rows
- TanStack Query `useInfiniteQuery` for bidirectional cursor pagination
- TanStack Virtual for rendering only visible rows

## What it demonstrates

- Dataset: 1000 sample messages
- Start state: latest 20 messages
- Search jump: replaces visible list with `prev_20 + hit + next_20`
- Scroll near top: fetch newer
- Scroll near bottom: fetch older
- Window remains bounded via infinite-query page cap (sliding window behavior)

## Run

```bash
pnpm install
pnpm dev
```

Open `http://localhost:3000`.

## Build

```bash
pnpm build
```

## Key files

- `src/routes/index.tsx` - UI + virtualizer + infinite query + query collection usage
- `src/lib/virtual-search-data.ts` - sample data + cursor paging helpers
- `src/styles.css` - base styles + defensive CSS baseline
