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
import { cn } from '@/lib/utils'
import { useWebSocketStore } from '@/lib/web-socket-store'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { FaChevronLeft } from 'react-icons/fa'
import { FaMicrophone, FaUser } from 'react-icons/fa6'

export const Route = createFileRoute('/speaker_/$language')({
  component: RouteComponent,
})

function RouteComponent() {
  const { language } = Route.useParams()
  const languageName = LANGUAGES.find((l) => l.code === language)?.name

  const [isBroadcasting, setIsBroadcasting] = useState(false)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [participantCount, setParticipantCount] = useState(0)

  const peerConnectionRef = useRef<RTCPeerConnection | null>(null)
  const answerReceivedRef = useRef(false)
  const iceCandidatesRef = useRef<RTCIceCandidateInit[]>([])
  const analyserRef = useRef<number | null>(null)

  const { connect, disconnect, status, setMessageHandler, sendMessage } =
    useWebSocketStore()

  // Handle microphone access
  const toggleBroadcast = async () => {
    if (isBroadcasting) {
      console.log('broadcast stopping')
      // Stop recording
      if (stream) {
        stream.getTracks().forEach((track) => track.stop())
        setStream(null)
      }
      peerConnectionRef.current?.close()
      peerConnectionRef.current = null
      clearInterval(analyserRef.current as number)
      sendMessage({ type: 'broadcast-stopped' })
      answerReceivedRef.current = false
      setIsBroadcasting(false)
    } else {
      if (status !== 'online') {
        return
      }
      console.log('broadcast starting')
      setIsBroadcasting(true)
      try {
        sendMessage({ type: 'broadcast-started' })
        const pc = new RTCPeerConnection({
          iceServers: [],
        })
        peerConnectionRef.current = pc
        pc.onicecandidate = (event) => {
          if (event.candidate) {
            sendMessage({ type: 'ice', data: event.candidate })
          }
        }
        // Start recording
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        })
        stream.getTracks().forEach((track) => pc.addTrack(track, stream))
        setStream(stream)

        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        sendMessage({ type: 'offer', data: offer })
      } catch (error) {
        console.error('Error accessing microphone:', error)
        setIsBroadcasting(false)
      }
    }
  }

  const handleMessage = useCallback(async (event: MessageEvent) => {
    const msg = JSON.parse(event.data)
    if (msg.type === 'answer') {
      const answer = new RTCSessionDescription(msg.data)
      await peerConnectionRef.current?.setRemoteDescription(answer)
      answerReceivedRef.current = true
    } else if (msg.type === 'ice') {
      iceCandidatesRef.current.push(msg.data)
      if (!answerReceivedRef.current) return
      for (const candidate of iceCandidatesRef.current) {
        await peerConnectionRef.current?.addIceCandidate(
          new RTCIceCandidate(candidate),
        )
      }
      iceCandidatesRef.current = []
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
              className={`p-8 rounded-full relative mb-4 transition-colors ${isBroadcasting ? 'bg-red-100' : 'bg-gray-100'}`}
            >
              <Button
                disabled={status === 'offline'}
                variant={isBroadcasting ? 'destructive' : 'default'}
                size="icon"
                className={cn(
                  'size-16 rounded-full ',
                  isBroadcasting && 'animate-pulse',
                )}
                onClick={toggleBroadcast}
              >
                <div className="absolute inset-0"></div>

                {isBroadcasting ? (
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
              ) : isBroadcasting ? (
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
