import { HeadContent, Link, Scripts, createRootRoute } from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { TanStackDevtools } from '@tanstack/react-devtools'

import Header from '../components/Header'

import appCss from '../styles.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: 'TanStack Start Starter',
      },
    ],
    links: [
      {
        rel: 'stylesheet',
        href: appCss,
      },
    ],
  }),
  shellComponent: RootDocument,
  notFoundComponent: NotFoundComponent,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <Header />
        {children}
        <TanStackDevtools
          config={{
            position: 'bottom-right',
          }}
          plugins={[
            {
              name: 'Tanstack Router',
              render: <TanStackRouterDevtoolsPanel />,
            },
          ]}
        />
        <Scripts />
      </body>
    </html>
  )
}

function NotFoundComponent() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16 text-center text-white">
      <p className="text-sm font-semibold uppercase tracking-[0.3em] text-cyan-400">
        404
      </p>
      <h1 className="mt-4 text-4xl font-black">Page not found</h1>
      <p className="mt-4 text-lg text-gray-300">
        This route is not defined in the current TanStack Start app.
      </p>
      <Link
        to="/"
        className="mt-8 inline-flex rounded-lg bg-cyan-500 px-5 py-3 font-semibold text-white transition-colors hover:bg-cyan-600"
      >
        Return home
      </Link>
    </main>
  )
}
