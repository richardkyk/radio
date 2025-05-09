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
import { FaVolumeHigh, FaVolumeOff } from 'react-icons/fa6'
import { toast } from 'sonner'

export const Route = createFileRoute('/listener_/$language')({
  component: RouteComponent,
})

function RouteComponent() {
  const { language } = Route.useParams()

  const languageName = LANGUAGES.find((l) => l.code === language)?.name

  const [isListening, setIsListening] = useState(false)
  const [status, setStatus] = useState<string>('idle')

  const webSocketRef = useRef<WebSocket | null>(null)
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null)
  const answerReceivedRef = useRef(false)
  const audioElement = useRef<HTMLAudioElement>(null)
  const iceCandidatesRef = useRef<RTCIceCandidateInit[]>([])
  const audioStreamRef = useRef<MediaStream | null>(null)

  // Toggle listening state
  const toggleListening = () => {
    if (isListening) {
      console.log('stopping')
      // Stop recording
      if (audioStreamRef.current) {
        audioStreamRef.current.getTracks().forEach((track) => track.stop())
        audioStreamRef.current = null
      }
      peerConnectionRef.current?.close()
      peerConnectionRef.current = null
      webSocketRef.current?.send(JSON.stringify({ type: 'listening-stopped' }))
      answerReceivedRef.current = false
      setIsListening(false)
    } else {
      if (!webSocketRef.current) {
        toast.error('Connection error', {
          description: 'Please refresh the page and try again',
        })
        setStatus('offline')
        return
      }
      console.log('starting')
      setIsListening(true)

      const combinedStream = new MediaStream()
      audioStreamRef.current = combinedStream
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
            combinedStream.addTrack(event.track)
            console.log(event)
          }
        }

        webSocketRef.current?.send(
          JSON.stringify({ type: 'listening-started' }),
        )
        if (audioElement.current) {
          audioElement.current.srcObject = combinedStream
          audioElement.current
            .play()
            .then(() => {
              console.log('Playing audio')
            })
            .catch((err) => console.error('Error playing audio:', err))
        }
      } catch (error) {
        console.error(error)
        setIsListening(false)
      }
    }
  }

  // handle websocket
  useEffect(() => {
    console.log('websocket start')
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
      } else if (msg.type === 'speaker-connect') {
        console.log('Speaker connected')
        audioElement.current?.play()
      } else if (msg.type === 'speaker-disconnect') {
        console.log('Speaker disconnected')
        audioElement.current?.pause()
      }
    }

    ws.onopen = async () => {
      console.log('WebSocket connected')
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
      console.log('websocket stop')
      webSocketRef.current = null
      setStatus('idle')
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'listener-disconnected' }))
      }
      ws.close()
    }
  }, [language])

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
              <Badge
                variant="outline"
                className="ml-auto"
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
              <Badge variant="outline">1 speaking</Badge>
            </div>
            <CardDescription>
              Listen to speakers in {languageName}. Audio will be translated in
              real-time.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center">
            <div
              className={`p-8 rounded-full mb-4 transition-colors ${isListening ? 'bg-green-100' : 'bg-gray-100'}`}
            >
              <Button
                variant={isListening ? 'default' : 'outline'}
                size="icon"
                className="h-16 w-16 rounded-full"
                onClick={toggleListening}
              >
                {isListening ? (
                  <FaVolumeHigh className="h-8 w-8" />
                ) : (
                  <FaVolumeOff className="h-8 w-8" />
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

        <audio id="audio" ref={audioElement} controls></audio>

        <div className="text-sm text-gray-500 text-center">
          No one is speaking right now. Please wait for speakers to join.
        </div>
      </div>
    </main>
  )
}
