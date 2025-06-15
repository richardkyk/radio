import { create } from 'zustand'
import { toast } from 'sonner'

type MessageHandler = (event: MessageEvent, ws: WebSocket) => void

interface WebSocketState {
  status: 'idle' | 'online' | 'offline'
  ws: WebSocket | null
  wsUrl: string | null
  messageHandler: MessageHandler | null
  onOpenHandler: () => void

  connect: (url: string) => void
  disconnect: () => void
  sendMessage: (data: any) => void
  setMessageHandler: (handler: MessageHandler) => void
  setOnOpenHandler: (handler: () => void) => void
}

export const useWebSocketStore = create<WebSocketState>((set, get) => ({
  status: 'idle',
  ws: null,
  wsUrl: null,
  messageHandler: null,
  onOpenHandler: () => {},

  connect: (url: string) => {
    if (get().ws) return

    const ws = new WebSocket(url)

    ws.onopen = () => {
      set({ status: 'online', ws, wsUrl: url })
      ws.send(JSON.stringify({ type: `participant-connected` }))
      get().onOpenHandler()
    }

    ws.onmessage = (event) => {
      const handler = get().messageHandler
      if (handler) handler(event, ws)
    }

    ws.onerror = () => {
      set({ status: 'offline' })
      toast.error('Connection error', {
        description: 'Please refresh the page and try again',
      })
    }

    ws.onclose = () => {
      set({ status: 'idle', ws: null, wsUrl: null })
    }

    set({ ws })
  },

  disconnect: () => {
    const ws = get().ws
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: `participant-disconnected` }))
      ws.close()
      set({ ws: null, status: 'idle', wsUrl: null })
    }
  },

  sendMessage: (data: any) => {
    const ws = get().ws
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data))
    } else {
      console.warn('WebSocket is not open')
    }
  },

  setMessageHandler: (handler: MessageHandler) => {
    set({ messageHandler: handler })
  },

  setOnOpenHandler: (handler: () => void) => {
    set({ onOpenHandler: handler })
  },
}))
