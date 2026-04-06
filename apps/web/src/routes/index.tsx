import { Navigate, createFileRoute } from "@tanstack/react-router"
import { DEFAULT_CHANNEL_ID } from "../db/messages"

export const Route = createFileRoute("/")({
  component: IndexRedirect,
})

function IndexRedirect() {
  return (
    <Navigate
      to="/channels/$channelId"
      params={{ channelId: DEFAULT_CHANNEL_ID }}
      replace
    />
  )
}
