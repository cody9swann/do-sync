import { useCallback } from "react"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import ChannelApp from "../app"

export const Route = createFileRoute("/channels/$channelId")({
  component: ChannelRouteComponent,
})

function ChannelRouteComponent() {
  const { channelId } = Route.useParams()
  const navigate = useNavigate()
  const handleNavigateChannel = useCallback(
    (nextChannelId: string) => {
      return navigate({
        to: "/channels/$channelId",
        params: { channelId: nextChannelId },
      })
    },
    [navigate]
  )

  return (
    <ChannelApp
      activeChannelId={channelId}
      onNavigateChannel={handleNavigateChannel}
    />
  )
}
