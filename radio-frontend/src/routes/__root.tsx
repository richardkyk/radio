import { Outlet, createRootRoute } from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'

import Header from '../components/header'
import { Toaster } from '@/components/ui/sonner'

export const Route = createRootRoute({
  component: () => (
    <>
      <Header />

      <Outlet />
      <Toaster
        richColors
        duration={Infinity}
        closeButton
        position="top-right"
        className="hover:[[data-sonner-toast][data-styled=true]]:!bg-black  hover:[data-close-button]:bg-black"
        toastOptions={{
          classNames: {
            closeButton:
              '!hover:[data-sonner-toast][data-styled=true]:bg-black [data-close-button]:hover',
          },
        }}
      />
      <TanStackRouterDevtools />
    </>
  ),
})
