import { create } from 'zustand'
import { useWebSocketStore } from './web-socket-store'

type Speaker = {
  id: string
  stream: MediaStream
}

interface ListenerState {
  speakers: Speaker[]
  isActive: boolean
  pc: RTCPeerConnection | null
  answerReceived: boolean
  iceCandidates: Array<RTCIceCandidateInit>

  addSpeaker: (id: string, track: MediaStreamTrack) => void
  removeSpeaker: (id: string) => void
  start: () => void
  stop: () => void
  play: () => void
  pause: () => void
  toggle: () => void
  acceptOffer: (data: RTCSessionDescriptionInit) => Promise<void>
  addIceCandidate: (candidate: RTCIceCandidateInit) => Promise<void>
}

export const useListenerStore = create<ListenerState>((set, get) => ({
  speakers: [],
  videoStream: new MediaStream(),
  isActive: false,
  pc: null,
  answerReceived: false,
  iceCandidates: [],

  addSpeaker: (id: string, track: MediaStreamTrack) => {
    const stream = new MediaStream([track])
    const audio = new Audio()
    audio.srcObject = stream
    audio.autoplay = true
    audio.muted = true
    const speaker = {
      id,
      stream,
    }
    set({ speakers: [...get().speakers, speaker] })
  },
  removeSpeaker: (id: string) => {
    const speakers = get().speakers.filter((s) => s.id !== id)
    set({ speakers })
  },
  start: () => {
    const sendMessage = useWebSocketStore.getState().sendMessage
    try {
      sendMessage({ type: 'listener-connected' })
      const pc = new RTCPeerConnection({
        iceServers: [],
      })
      set({ pc })
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          sendMessage({ type: 'ice', data: event.candidate })
        }
      }
      pc.ontrack = async (event) => {
        if (event.track.kind === 'audio') {
          const remoteStream = event.streams[0]
          const streamId = remoteStream.id
          get().addSpeaker(streamId, event.track)
        }
      }
    } catch (error) {
      console.error('Something went wrong:', error)
    }
  },
  play: () => {
    if (get().isActive) return
    set({ isActive: true })
  },
  pause: () => {
    if (!get().isActive) return
    set({ isActive: false })
  },
  stop: () => {
    if (!get().isActive) return
    console.log('listening stopping')

    const sendMessage = useWebSocketStore.getState().sendMessage

    const pc = get().pc
    if (pc) {
      pc.close()
      set({ pc: null })
    }
    sendMessage({ type: 'listener-disconnected' })
    set({ isActive: false, answerReceived: false, speakers: [] })
  },
  toggle: () => {
    if (get().isActive) {
      get().pause()
    } else {
      get().play()
    }
  },
  acceptOffer: async (data: RTCSessionDescriptionInit) => {
    const pc = get().pc
    if (!pc) return
    const offer = new RTCSessionDescription(data)
    await pc.setRemoteDescription(offer)

    const sendMessage = useWebSocketStore.getState().sendMessage
    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)

    set({ answerReceived: true })
    sendMessage({ type: 'answer', data: answer })
    const iceCandidates = get().iceCandidates
    if (iceCandidates.length === 0) return

    for (const candidate of iceCandidates) {
      await pc.addIceCandidate(new RTCIceCandidate(candidate))
    }
    set({ iceCandidates: [] })
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
