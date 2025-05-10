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
import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { FaChevronLeft } from 'react-icons/fa'
import { FaPause, FaUser, FaVolumeHigh } from 'react-icons/fa6'
import { toast } from 'sonner'

export const Route = createFileRoute('/listener_/$language')({
  component: RouteComponent,
})

function RouteComponent() {
  const { language } = Route.useParams()

  const languageName = LANGUAGES.find((l) => l.code === language)?.name

  const [isListening, setIsListening] = useState(false)
  const [status, setStatus] = useState<string>('idle')
  const [participantCount, setParticipantCount] = useState(0)

  const [mergedStream] = useState<MediaStream>(new MediaStream())
  const audioElement = useRef<HTMLAudioElement>(null)

  const webSocketRef = useRef<WebSocket | null>(null)
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null)
  const answerReceivedRef = useRef(false)
  const iceCandidatesRef = useRef<RTCIceCandidateInit[]>([])

  const playAudio = () => {
    if (!webSocketRef.current) {
      toast.error('Connection error', {
        description: 'Please refresh the page and try again',
      })
      setStatus('offline')
      return
    }
    console.log('listening starting')
    setIsListening(true)

    try {
      const pc = new RTCPeerConnection({
        iceServers: [],
      })
      peerConnectionRef.current = pc

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          webSocketRef.current?.send(
            JSON.stringify({ type: 'ice', data: event.candidate }),
          )
        }
      }

      pc.ontrack = (event) => {
        if (event.track.kind === 'audio') {
          const streamId = event.streams[0].id
          if (streamId.includes('server')) return
          console.log(event)
          // audioElement.current!.srcObject = event.streams[0]
          event.streams[0]
            .getTracks()
            .forEach((track) => mergedStream.addTrack(track))

          if (audioElement.current && !audioElement.current.srcObject) {
            console.log('setting audio src')
            audioElement.current.srcObject = mergedStream
            audioElement.current
              .play()
              .then(() => {
                console.log('Playing audio')
              })
              .catch((err) => console.error('Error playing audio:', err))
          }
        }
      }

      webSocketRef.current?.send(JSON.stringify({ type: 'listening-started' }))
    } catch (error) {
      console.error(error)
      setIsListening(false)
    }
  }

  const stopAudio = () => {
    console.log('listening stopping')
    // Stop recording
    mergedStream.getTracks().forEach((track) => {
      track.stop()
      console.log(track)
      mergedStream.removeTrack(track)
    })
    peerConnectionRef.current?.close()
    peerConnectionRef.current = null
    webSocketRef.current?.send(JSON.stringify({ type: 'listening-stopped' }))
    answerReceivedRef.current = false
    audioElement.current!.srcObject = null
    setIsListening(false)
  }

  // Toggle listening state
  const toggleListening = () => {
    if (isListening) {
      stopAudio()
    } else {
      playAudio()
    }
  }

  // handle websocket
  useEffect(() => {
    if (webSocketRef.current) return
    const wsUrl = new URL(`wss://localhost/ws/listener?topic=${language}`)
    const ws = new WebSocket(wsUrl)
    webSocketRef.current = ws

    ws.onmessage = async (event) => {
      const msg = JSON.parse(event.data)
      if (msg.type === 'offer') {
        const offer = new RTCSessionDescription(msg.data)
        await peerConnectionRef.current?.setRemoteDescription(offer)

        const answer = await peerConnectionRef.current?.createAnswer()
        await peerConnectionRef.current?.setLocalDescription(answer)

        answerReceivedRef.current = true
        ws.send(
          JSON.stringify({
            type: 'answer',
            data: answer,
          }),
        )
        if (!iceCandidatesRef.current.length) return

        for (const candidate of iceCandidatesRef.current) {
          await peerConnectionRef.current?.addIceCandidate(
            new RTCIceCandidate(candidate),
          )
        }
        iceCandidatesRef.current = []
      } else if (msg.type === 'ice') {
        iceCandidatesRef.current.push(msg.data)
        if (!answerReceivedRef.current) return
        for (const candidate of iceCandidatesRef.current) {
          await peerConnectionRef.current?.addIceCandidate(
            new RTCIceCandidate(candidate),
          )
        }
        iceCandidatesRef.current = []
      } else if (msg.type === 'speaker-connected') {
        if (answerReceivedRef.current) return
        console.log('Speaker connected')
        playAudio()
      } else if (msg.type === 'speaker-disconnected') {
        console.log('Speaker disconnected')
        stopAudio()
      } else if (msg.type === 'participant-count') {
        setParticipantCount(msg.data)
      }
    }

    ws.onopen = async () => {
      console.log('websocket opened')
      ws.send(JSON.stringify({ type: 'listener-connected' }))
      setStatus('online')
    }
    ws.onerror = (event) => {
      if (event.target !== webSocketRef.current) return
      console.log('websocket error', event)
      webSocketRef.current = null
      answerReceivedRef.current = false
      setStatus('offline')
      toast.error('Connection error', {
        description: 'Please refresh the page and try again',
      })
    }
    return () => {
      console.log('websocket closed')
      webSocketRef.current = null
      setStatus('idle')
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'listener-disconnected' }))
      }
      ws.close()
    }
  }, [language])

  useEffect(() => {
    document.title = `Listening to ${languageName} Room`
  }, [languageName])

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
              className={`p-8 relative rounded-full mb-4 transition-colors ${isListening ? 'bg-green-100' : 'bg-gray-100'}`}
            >
              <Button
                size="icon"
                className={cn(
                  'size-16 rounded-full ',
                  isListening && 'animate-pulse',
                )}
                onClick={toggleListening}
              >
                <div className="absolute inset-0"></div>
                {isListening ? (
                  <FaPause className="size-8" />
                ) : (
                  <FaVolumeHigh className="size-8" />
                )}
              </Button>
            </div>
            <div className="text-center mb-4">
              {isListening ? (
                <div className="text-green-600 font-medium">
                  Listening... Tap to pause
                </div>
              ) : (
                <div className="text-gray-500">Tap to start listening</div>
              )}
            </div>
          </CardContent>
        </Card>

        <audio ref={audioElement} controls autoPlay className="hidden"></audio>

        {participantCount <= 1 && (
          <div className="text-sm text-gray-500 text-center">
            No one is speaking right now. Please wait for speakers to join.
          </div>
        )}
      </div>
    </main>
  )
}
