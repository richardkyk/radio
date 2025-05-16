import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { LANGUAGES, STATUSES } from '@/lib/constants'
import { useSpeakerStore } from '@/lib/use-speaker-store'
import { cn } from '@/lib/utils'
import { useWebSocketStore } from '@/lib/web-socket-store'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'
import { FaChevronLeft } from 'react-icons/fa'
import { FaMicrophone, FaUser } from 'react-icons/fa6'

export const Route = createFileRoute('/speaker_/$language')({
  component: RouteComponent,
})

function RouteComponent() {
  const { language } = Route.useParams()
  const languageName = LANGUAGES.find((l) => l.code === language)?.name

  const [participantCount, setParticipantCount] = useState(0)

  const { connect, disconnect, status, setMessageHandler } = useWebSocketStore()

  const { isActive, toggle, acceptOffer, addIceCandidate } = useSpeakerStore()

  const handleMessage = useCallback(async (event: MessageEvent) => {
    const msg = JSON.parse(event.data)
    if (msg.type === 'answer') {
      await acceptOffer(msg.data)
    } else if (msg.type === 'ice') {
      await addIceCandidate(msg.data)
    } else if (msg.type === 'participant-count') {
      setParticipantCount(msg.data)
    }
  }, [])

  useEffect(() => {
    const wsUrl = new URL(
      `${import.meta.env.VITE_WS_URL}/speaker?topic=${language}`,
    )
    connect(wsUrl.toString())
    setMessageHandler(handleMessage)

    return () => {
      disconnect()
    }
  }, [connect, handleMessage, disconnect, setMessageHandler])

  useEffect(() => {
    document.title = `Speaking to ${languageName} Room`
  }, [languageName])

  return (
    <main className="flex min-h-[calc(100vh-2.5rem)] flex-col p-4 bg-gray-50">
      <div className="w-full max-w-md mx-auto space-y-4">
        <div className="flex items-center mb-4">
          <Link to="/speaker">
            <Button variant="ghost" size="icon" className="mr-2">
              <FaChevronLeft className="size-5" />
            </Button>
          </Link>
          <h1 className="text-xl font-bold">{languageName} Room</h1>
        </div>

        <Card className="mb-6">
          <CardHeader>
            <div className="flex gap-2 items-center">
              <CardTitle>Speaking Room</CardTitle>
              <Badge variant="secondary" className="gap-1.5 ml-auto">
                <FaUser className="size-4" />
                <span className="font-semibold">{participantCount}</span>
              </Badge>
              <Badge
                variant="outline"
                style={{
                  borderColor: `var(${
                    STATUSES.find((s) => s.code === status)?.color
                  })`,
                  backgroundColor: `var(${
                    STATUSES.find((s) => s.code === status)?.background
                  })`,
                }}
              >
                <div
                  className={cn('size-2 rounded-full')}
                  style={{
                    backgroundColor: `var(${
                      STATUSES.find((s) => s.code === status)?.color
                    })`,
                  }}
                ></div>
                {STATUSES.find((s) => s.code === status)?.name}
              </Badge>
            </div>
            <CardDescription>
              Speak clearly into your microphone. Your voice will be transmitted
              to all listeners.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center">
            <div
              className={`p-8 rounded-full relative mb-4 transition-colors ${isActive ? 'bg-red-100' : 'bg-gray-100'}`}
            >
              <Button
                disabled={status === 'offline'}
                variant={isActive ? 'destructive' : 'default'}
                size="icon"
                className={cn(
                  'size-16 rounded-full ',
                  isActive && 'animate-pulse',
                )}
                onClick={toggle}
              >
                <div className="absolute inset-0"></div>

                {isActive ? (
                  <FaMicrophone className="size-8" />
                ) : (
                  <FaMicrophone className="size-8" />
                )}
              </Button>
            </div>
            <div className="text-center">
              {status === 'offline' ? (
                <div className="text-red-500 font-medium">
                  Check your connection
                </div>
              ) : isActive ? (
                <div className="text-red-500 font-medium">
                  Broadcasting... Tap to stop
                </div>
              ) : (
                <div className="text-gray-500">Tap to start speaking</div>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="text-sm text-gray-500 text-center">
          Remember to speak clearly and at a moderate pace for the best results.
        </div>
      </div>
    </main>
  )
}
