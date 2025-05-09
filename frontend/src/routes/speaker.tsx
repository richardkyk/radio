import { createFileRoute } from '@tanstack/react-router'
import LanguageSelection from './-language-selection'

export const Route = createFileRoute('/speaker')({
  component: RouteComponent,
})

function RouteComponent() {
  return <LanguageSelection role="speaker" />
}
