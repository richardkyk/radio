import { create } from 'zustand'
import { useWebSocketStore } from './web-socket-store'

interface ListenerState {
  audioElement: HTMLAudioElement | null
  isActive: boolean
  stream: MediaStream
  pc: RTCPeerConnection | null
  answerReceived: boolean
  iceCandidates: Array<RTCIceCandidateInit>
  setAudioElement: (element: HTMLAudioElement | null) => void
  start: () => void
  stop: () => void
  toggle: () => void
  acceptOffer: (data: RTCSessionDescriptionInit) => Promise<void>
  addIceCandidate: (candidate: RTCIceCandidateInit) => Promise<void>
}

export const useListenerStore = create<ListenerState>((set, get) => ({
  audioElement: null,
  isActive: false,
  stream: new MediaStream(),
  pc: null,
  answerReceived: false,
  iceCandidates: [],

  setAudioElement: (element: HTMLAudioElement | null) => {
    set({ audioElement: element })
  },
  start: () => {
    if (get().isActive) return
    console.log('listening starting')

    const sendMessage = useWebSocketStore.getState().sendMessage
    set({ isActive: true })
    try {
      sendMessage({ type: 'listening-started' })
      const pc = new RTCPeerConnection({
        iceServers: [],
      })
      set({ pc })
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          sendMessage({ type: 'ice', data: event.candidate })
        }
      }
      pc.ontrack = (event) => {
        const audioElement = get().audioElement
        if (!audioElement) return

        if (event.track.kind !== 'audio') return

        const remoteStream = event.streams[0]
        const streamId = remoteStream.id

        if (streamId.includes('server')) return

        const currentStream = get().stream
        remoteStream
          .getTracks()
          .forEach((track) => currentStream.addTrack(track))

        if (!audioElement.srcObject) {
          console.log('setting audio src')
          audioElement.srcObject = currentStream
          audioElement
            .play()
            .then(() => console.log('Playing audio'))
            .catch((err) => console.error('Error playing audio:', err))
        }
      }
    } catch (error) {
      console.error('Something went wrong:', error)
      set({ isActive: false })
    }
  },

  stop: () => {
    if (!get().isActive) return
    console.log('listening stopping')

    const sendMessage = useWebSocketStore.getState().sendMessage
    const audioElement = get().audioElement
    if (audioElement) {
      audioElement.srcObject = null
    }
    const currentStream = get().stream
    currentStream.getTracks().forEach((track) => {
      track.stop()
      currentStream.removeTrack(track)
    })

    const pc = get().pc
    if (pc) {
      pc.close()
      set({ pc: null })
    }
    sendMessage({ type: 'listening-stopped' })
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
