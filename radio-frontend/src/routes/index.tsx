import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { createFileRoute, Link } from '@tanstack/react-router'
import { FaHeadphones, FaMicrophone } from 'react-icons/fa'

export const Route = createFileRoute('/')({
  component: App,
})

function App() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-4 bg-gray-50">
      <div className="w-full max-w-md space-y-4">
        <p className="text-center text-gray-500">
          Choose your role to continue
        </p>

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
