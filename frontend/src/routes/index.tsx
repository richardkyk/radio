import { Link, createFileRoute } from '@tanstack/react-router'
import { useEffect } from 'react'
import { FaHeadphones, FaMicrophone } from 'react-icons/fa'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

export const Route = createFileRoute('/')({
  component: App,
})

function App() {
  useEffect(() => {
    document.title = 'Radio'
  }, [])

  return (
    <main className="flex min-h-[calc(100vh-2.5rem)] flex-col p-4 bg-gray-50">
      <div className="w-full max-w-md mx-auto space-y-4">
        <div className="flex items-center mb-4">
          <div className="h-9"></div>
          <h1 className="text-xl font-bold">Role Selection</h1>
        </div>

        <div className="w-full max-w-md mx-auto space-y-4">
          <p className="text-gray-500 mb-6">Choose your role to continue</p>
        </div>

        <div className="grid grid-cols-1 gap-4 mt-8">
          <Link to="/speaker" className="w-full">
            <Card className="transition-all hover:shadow-md">
              <CardHeader className="pb-2">
                <CardTitle className="text-xl">Speaker</CardTitle>
                <CardDescription>Speak in your language</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-center p-6">
                  <FaMicrophone className="h-16 w-16 text-primary" />
                </div>
              </CardContent>
            </Card>
          </Link>

          <Link to="/listener" className="w-full">
            <Card className="transition-all hover:shadow-md">
              <CardHeader className="pb-2">
                <CardTitle className="text-xl">Listener</CardTitle>
                <CardDescription>Listen to translations</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-center p-6">
                  <FaHeadphones className="h-16 w-16 text-primary" />
                </div>
              </CardContent>
            </Card>
          </Link>
        </div>
      </div>
    </main>
  )
}
