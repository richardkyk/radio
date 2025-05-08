import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { LANGUAGES } from '@/lib/constants'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { FaChevronLeft } from 'react-icons/fa'
import { FaVolumeHigh, FaVolumeOff } from 'react-icons/fa6'

export const Route = createFileRoute('/listener_/$language')({
  component: RouteComponent,
})

function RouteComponent() {
  const { language } = Route.useParams()

  const languageName = LANGUAGES.find((l) => l.code === language)?.name

  const [isListening, setIsListening] = useState(false)
  const [speakers, setSpeakers] = useState(0)
  const [volume, setVolume] = useState(70)
  const [currentSpeaker, setCurrentSpeaker] = useState<string | null>(null)

  // Toggle listening state
  const toggleListening = () => {
    setIsListening(!isListening)
  }

  // Simulate speakers joining and leaving
  useEffect(() => {
    const interval = setInterval(() => {
      // Random chance to add or remove a speaker
      const change = Math.random() > 0.7 ? 1 : Math.random() > 0.8 ? -1 : 0
      setSpeakers((prev) => Math.max(0, prev + change))

      // Simulate a speaker talking
      if (isListening && speakers > 0) {
        const speakerNames = [
          'Alex',
          'Maria',
          'Jean',
          'Hiroshi',
          'Ana',
          'Mohammed',
          'Olga',
        ]
        if (Math.random() > 0.6) {
          setCurrentSpeaker(
            speakerNames[Math.floor(Math.random() * speakerNames.length)],
          )
        } else {
          setCurrentSpeaker(null)
        }
      } else {
        setCurrentSpeaker(null)
      }
    }, 3000)

    return () => clearInterval(interval)
  }, [isListening, speakers])

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
            <div className="flex justify-between items-center">
              <CardTitle>Listening Room</CardTitle>
              <Badge variant="outline">{speakers} speaking</Badge>
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

            {isListening && (
              <div className="w-full space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-sm">Volume</span>
                  <span className="text-sm font-medium">{volume}%</span>
                </div>

                {currentSpeaker && (
                  <div className="mt-6 p-3 bg-green-50 rounded-lg border border-green-100">
                    <div className="flex items-center">
                      <div className="w-2 h-2 bg-green-500 rounded-full mr-2 animate-pulse"></div>
                      <span className="text-sm font-medium">
                        {currentSpeaker} is speaking...
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="text-sm text-gray-500 text-center">
          {speakers === 0
            ? 'No one is speaking right now. Please wait for speakers to join.'
            : 'Adjust your volume for comfortable listening.'}
        </div>
      </div>
    </main>
  )
}
