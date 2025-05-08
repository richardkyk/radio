import { Outlet, createRootRoute } from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'

import Header from '../components/header'

export const Route = createRootRoute({
  component: () => (
    <>
      <Header />

      <Outlet />
      <TanStackRouterDevtools />
    </>
  ),
})
