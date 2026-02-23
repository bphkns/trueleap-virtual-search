import { ClientOnly, createFileRoute } from '@tanstack/react-router'

import { VirtualSearchExample } from '@/features/virtual-search/virtual-search-example'

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
