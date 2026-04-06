import { useEffect, type CSSProperties, type ReactNode } from "react"
import {
  HeadContent,
  Link,
  Outlet,
  Scripts,
  createRootRoute,
} from "@tanstack/react-router"
import { registerOfflineServiceWorker } from "../offline/register-service-worker"

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "DO-Sync — Realtime Channel" },
    ],
    styles: [
      {
        children: `
          * { box-sizing: border-box; }
          html, body { margin: 0; padding: 0; background: #111; }
        `,
      },
    ],
  }),
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
})

function RootComponent() {
  useEffect(() => {
    void registerOfflineServiceWorker()
  }, [])

  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  )
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>{children}<Scripts /></body>
    </html>
  )
}

function NotFoundComponent() {
  return (
    <main style={notFoundStyles.page}>
      <section style={notFoundStyles.card}>
        <p style={notFoundStyles.eyebrow}>404</p>
        <h1 style={notFoundStyles.title}>Page not found</h1>
        <p style={notFoundStyles.copy}>
          This route does not exist in the DO-Sync demo.
        </p>
        <Link to="/" style={notFoundStyles.link}>
          Open the default channel
        </Link>
      </section>
    </main>
  )
}

const notFoundStyles = {
  page: {
    minHeight: "100vh",
    display: "grid",
    placeItems: "center",
    padding: "24px",
    background:
      "radial-gradient(circle at top, rgba(77, 162, 255, 0.18), transparent 40%), #111111",
    color: "#F5F7FA",
    fontFamily:
      'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  } satisfies CSSProperties,
  card: {
    width: "min(100%, 480px)",
    padding: "32px",
    borderRadius: "20px",
    border: "1px solid rgba(255, 255, 255, 0.12)",
    background: "rgba(20, 24, 31, 0.92)",
    boxShadow: "0 24px 80px rgba(0, 0, 0, 0.35)",
  } satisfies CSSProperties,
  eyebrow: {
    margin: 0,
    fontSize: "12px",
    fontWeight: 700,
    letterSpacing: "0.24em",
    textTransform: "uppercase",
    color: "#8FB3FF",
  } satisfies CSSProperties,
  title: {
    margin: "12px 0 0",
    fontSize: "32px",
    lineHeight: 1.1,
  } satisfies CSSProperties,
  copy: {
    margin: "12px 0 0",
    color: "rgba(245, 247, 250, 0.72)",
    fontSize: "16px",
    lineHeight: 1.5,
  } satisfies CSSProperties,
  link: {
    display: "inline-flex",
    marginTop: "24px",
    padding: "12px 16px",
    borderRadius: "999px",
    background: "#4DA2FF",
    color: "#08111F",
    fontWeight: 700,
    textDecoration: "none",
  } satisfies CSSProperties,
} as const
