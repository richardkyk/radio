import { Link, createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { FaChevronLeft } from 'react-icons/fa'
import { FaPause, FaUser, FaVolumeHigh } from 'react-icons/fa6'
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
import { useListenerStore } from '@/lib/use-listener-store'
import { cn } from '@/lib/utils'
import { useWebSocketStore } from '@/lib/web-socket-store'

export const Route = createFileRoute('/listener_/$language')({
  component: RouteComponent,
})

function RouteComponent() {
  const { language } = Route.useParams()

  const languageName = LANGUAGES.find((l) => l.code === language)?.name

  const [participantCount, setParticipantCount] = useState(0)

  const audioElementRef = useRef<HTMLAudioElement>(null)
  const videoElementRef = useRef<HTMLVideoElement>(null)

  const { connect, disconnect, status, setMessageHandler } = useWebSocketStore()

  const {
    isActive,
    start,
    stop,
    toggle,
    acceptOffer,
    addIceCandidate,
    setAudioElement,
    setVideoElement,
  } = useListenerStore()

  const handleMessage = useCallback(async (event: MessageEvent) => {
    const msg = JSON.parse(event.data)
    if (msg.type === 'offer') {
      await acceptOffer(msg.data)
    } else if (msg.type === 'ice') {
      await addIceCandidate(msg.data)
    } else if (msg.type === 'speaker-connected') {
      start()
    } else if (msg.type === 'speaker-disconnected') {
      stop()
    } else if (msg.type === 'participant-count') {
      setParticipantCount(msg.data)
    }
  }, [])

  useEffect(() => {
    setAudioElement(audioElementRef.current)
    setVideoElement(videoElementRef.current)
    document.title = `Listening to ${languageName} Room`
  }, [languageName])

  useEffect(() => {
    const wsUrl = new URL(
      `${import.meta.env.VITE_WS_URL}/listener?topic=${language}`,
    )
    connect(wsUrl.toString())
    setMessageHandler(handleMessage)

    return () => {
      disconnect()
    }
  }, [connect, handleMessage, disconnect, setMessageHandler])

  return (
    <main className="flex min-h-[calc(100vh-2.5rem)] flex-col p-4 bg-gray-50">
      <div className="w-full max-w-md mx-auto space-y-4">
        <div className="flex items-center mb-4">
          <Link to="/listener">
            <Button variant="ghost" size="icon" className="mr-2">
              <FaChevronLeft className="size-5" />
            </Button>
          </Link>
          <h1 className="text-xl font-bold">{languageName} Room</h1>
        </div>

        <Card className="mb-6">
          <CardHeader>
            <div className="flex gap-2 items-center">
              <CardTitle>Listening Room</CardTitle>
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
              Listen to speakers in {languageName}. Audio will be translated in
              real-time.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center">
            <div
              className={`p-8 relative rounded-full mb-4 transition-colors ${isActive ? 'bg-green-100' : 'bg-gray-100'}`}
            >
              <Button
                size="icon"
                className={cn(
                  'size-16 rounded-full ',
                  isActive && 'animate-pulse',
                )}
                onClick={toggle}
              >
                <div className="absolute inset-0"></div>
                {isActive ? (
                  <FaPause className="size-8" />
                ) : (
                  <FaVolumeHigh className="size-8" />
                )}
              </Button>
            </div>
            <div className="text-center">
              {isActive ? (
                <div className="text-green-600 font-medium">
                  Listening... Tap to pause
                </div>
              ) : (
                <div className="text-gray-500">Tap to start listening</div>
              )}
            </div>
          </CardContent>
        </Card>

        <audio ref={audioElementRef} controls autoPlay className="hidden" />

        <video
          ref={videoElementRef}
          autoPlay
          controls
          muted
          playsInline
          width="400"
          height="200"
        ></video>

        {participantCount <= 1 && (
          <div className="text-sm text-gray-500 text-center">
            No one is speaking right now. Please wait for speakers to join.
          </div>
        )}
      </div>
    </main>
  )
}
