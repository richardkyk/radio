import { create } from 'zustand'
import { useWebSocketStore } from './web-socket-store'

interface SpeakerState {
  isBroadcasting: boolean
  stream: MediaStream | null
  pc: RTCPeerConnection | null
  answerReceived: boolean
  iceCandidates: RTCIceCandidateInit[]
  start: () => Promise<void>
  stop: () => void
  toggleBroadcast: () => void
  acceptOffer: (data: RTCSessionDescriptionInit) => Promise<void>
  addIceCandidate: (candidate: RTCIceCandidateInit) => Promise<void>
}

export const useSpeakerStore = create<SpeakerState>((set, get) => ({
  isBroadcasting: false,
  stream: null,
  pc: null,
  answerReceived: false,
  iceCandidates: [],

  start: async () => {
    if (get().isBroadcasting) return
    console.log('broadcast starting')

    const sendMessage = useWebSocketStore.getState().sendMessage
    set({ isBroadcasting: true })
    try {
      sendMessage({ type: 'broadcast-started' })
      const pc = new RTCPeerConnection({
        iceServers: [],
      })
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          sendMessage({ type: 'ice', data: event.candidate })
        }
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      })
      stream.getTracks().forEach((track) => pc.addTrack(track, stream))

      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      set({ stream, pc })
      sendMessage({ type: 'offer', data: offer })
    } catch (error) {
      console.error('Error accessing microphone:', error)
      set({ isBroadcasting: false })
    }
  },

  stop: () => {
    if (!get().isBroadcasting) return
    console.log('broadcast stopping')

    const sendMessage = useWebSocketStore.getState().sendMessage
    const stream = get().stream
    if (stream) {
      stream.getTracks().forEach((track) => track.stop())
      set({ stream: null })
    }

    const pc = get().pc
    if (pc) {
      pc.close()
      set({ pc: null })
    }
    sendMessage({ type: 'broadcast-stopped' })
    set({ isBroadcasting: false, answerReceived: false })
  },
  toggleBroadcast: () => {
    if (get().isBroadcasting) {
      get().stop()
    } else {
      get().start()
    }
  },
  acceptOffer: async (data: RTCSessionDescriptionInit) => {
    const pc = get().pc
    if (!pc) return
    const answer = new RTCSessionDescription(data)
    await pc.setRemoteDescription(answer)
    set({ answerReceived: true })
  },
  addIceCandidate: async (candidate: RTCIceCandidateInit) => {
    const pc = get().pc
    if (!pc) return
    const iceCandidates = get().iceCandidates
    iceCandidates.push(candidate)
    if (!get().answerReceived) return
    for (const candidate of iceCandidates) {
      await pc.addIceCandidate(new RTCIceCandidate(candidate))
    }
    set({ iceCandidates: [] })
  },
}))
