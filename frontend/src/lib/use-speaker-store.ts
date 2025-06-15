import { create } from 'zustand'
import { useWebSocketStore } from './web-socket-store'

interface SpeakerState {
  isActive: boolean
  stream: MediaStream | null
  pc: RTCPeerConnection | null
  answerReceived: boolean
  iceCandidates: Array<RTCIceCandidateInit>

  start: () => Promise<void>
  stop: () => void
  toggle: () => void
  acceptOffer: (data: RTCSessionDescriptionInit) => Promise<void>
  addIceCandidate: (candidate: RTCIceCandidateInit) => Promise<void>
}

export const useSpeakerStore = create<SpeakerState>((set, get) => ({
  isActive: false,
  stream: null,
  pc: null,
  answerReceived: false,
  iceCandidates: [],

  start: async () => {
    if (get().isActive) return
    console.log('broadcast starting')

    const sendMessage = useWebSocketStore.getState().sendMessage
    set({ isActive: true })
    try {
      sendMessage({ type: 'broadcast-started' })
      const pc = new RTCPeerConnection({
        iceServers: [],
      })
      set({ pc })
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          sendMessage({ type: 'ice', data: event.candidate })
        }
      }
      const audioStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      })
      const audioTrack = audioStream.getAudioTracks()[0]
      pc.addTrack(audioTrack, audioStream)

      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      set({ stream: audioStream })
      sendMessage({ type: 'offer', data: offer })
    } catch (error) {
      console.error('Error accessing microphone:', error)
      set({ isActive: false })
    }
  },

  stop: () => {
    if (!get().isActive) return
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
    set({ isActive: false, answerReceived: false })
  },
  toggle: () => {
    if (get().isActive) {
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
    for (const c of iceCandidates) {
      await pc.addIceCandidate(new RTCIceCandidate(c))
    }
    set({ iceCandidates: [] })
  },
}))
