import { Link } from '@tanstack/react-router'
import { useEffect } from 'react'
import { FaChevronLeft } from 'react-icons/fa'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { LANGUAGES } from '@/lib/constants'

interface LanguageSelectionProps {
  role: 'speaker' | 'listener'
}

export default function LanguageSelection(props: LanguageSelectionProps) {
  const { role } = props

  useEffect(() => {
    document.title = `Language Selection`
  }, [role])

  return (
    <main className="flex min-h-[calc(100vh-2.5rem)] flex-col p-4 bg-gray-50">
      <div className="w-full max-w-md mx-auto space-y-4">
        <div className="flex items-center mb-4">
          <Link to="/">
            <Button variant="ghost" size="icon" className="mr-2">
              <FaChevronLeft className="size-5" />
            </Button>
          </Link>
          <h1 className="text-xl font-bold">Language Selection</h1>
        </div>
        <div className="w-full max-w-md mx-auto space-y-4">
          <p className="text-gray-500 mb-6">
            {role === 'speaker'
              ? 'Select the language you want to speak in'
              : 'Select the language you want to listen to'}
          </p>

          <div className="grid grid-cols-2 gap-3">
            {LANGUAGES.map((language) => (
              <Link
                key={language.code}
                to={`/${role}/$language`}
                params={{ language: language.code }}
                className="w-full"
              >
                <Card className="transition-all hover:shadow-md hover:bg-gray-50">
                  <CardContent className="p-4 text-center">
                    <div className="text-lg font-medium">{language.name}</div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </main>
  )
}
