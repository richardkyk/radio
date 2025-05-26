import { create } from 'zustand'
import { useWebSocketStore } from './web-socket-store'
import jsQR from 'jsqr'

declare class MediaStreamTrackProcessor<
  T extends MediaStreamTrack = MediaStreamTrack,
> {
  constructor(init: { track: T })
  readonly readable: ReadableStream<VideoFrame>
}

interface ListenerState {
  audioStream: MediaStream
  videoStream: MediaStream
  audioElement: HTMLAudioElement | null
  videoElement: HTMLVideoElement | null
  isActive: boolean
  pc: RTCPeerConnection | null
  answerReceived: boolean
  iceCandidates: Array<RTCIceCandidateInit>
  latency: number
  setAudioElement: (element: HTMLAudioElement | null) => void
  setVideoElement: (element: HTMLVideoElement | null) => void
  start: () => void
  stop: () => void
  toggle: () => void
  acceptOffer: (data: RTCSessionDescriptionInit) => Promise<void>
  addIceCandidate: (candidate: RTCIceCandidateInit) => Promise<void>
}

export const useListenerStore = create<ListenerState>((set, get) => ({
  audioStream: new MediaStream(),
  videoStream: new MediaStream(),
  audioElement: null,
  videoElement: null,
  isActive: false,
  pc: null,
  answerReceived: false,
  iceCandidates: [],
  latency: 0,

  setAudioElement: (audioElement: HTMLAudioElement | null) => {
    if (audioElement) audioElement.srcObject = get().audioStream
    set({ audioElement })
  },
  setVideoElement: (videoElement: HTMLVideoElement | null) => {
    if (videoElement) videoElement.srcObject = get().videoStream
    set({ videoElement })
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
      pc.ontrack = async (event) => {
        const audioElement = get().audioElement
        if (!audioElement) return
        if (event.track.kind === 'audio') {
          const remoteStream = event.streams[0]
          const streamId = remoteStream.id

          console.log('audioStream', streamId)
          if (streamId.includes('server')) return

          const audioStream = get().audioStream
          remoteStream
            .getTracks()
            .forEach((track) => audioStream.addTrack(track))

          audioElement
            .play()
            .then(() => console.log('Playing audio'))
            .catch((err) => console.error('Error playing audio:', err))
        }

        const videoElement = get().videoElement
        if (!videoElement) return
        if (event.track.kind === 'video') {
          const remoteStream = event.streams[0]
          const streamId = remoteStream.id

          console.log('videoStream', streamId)
          if (streamId.includes('server')) return

          const videoStream = get().videoStream
          remoteStream
            .getTracks()
            .forEach((track) => videoStream.addTrack(track))

          videoElement
            .play()
            .then(() => console.log('Playing video'))
            .catch((err) => console.error('Error playing video:', err))

          const videoTrack = videoStream.getVideoTracks()[0]
          const processor = new MediaStreamTrackProcessor({ track: videoTrack })
          const reader = processor.readable.getReader()

          async function processFrames() {
            while (true) {
              const { value: frame, done } = await reader.read()
              if (done) break

              const receivedAt = Date.now()
              const width = frame.displayWidth
              const height = frame.displayHeight
              const buffer = new Uint8ClampedArray(width * height * 4) // RGBA

              await frame.copyTo(buffer, {
                layout: [{ offset: 0, stride: width * 4 }],
                format: 'RGBA',
              })
              frame.close()

              const qrResult = jsQR(buffer, width, height)
              if (qrResult) {
                const sentAt = new Date(parseInt(qrResult.data)).valueOf()
                const latency = receivedAt - sentAt
                set({ latency })
                console.log(`Latency: ${latency}ms`)
              }
            }
          }

          processFrames()
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
    const audioStream = get().audioStream
    audioStream.getTracks().forEach((track) => {
      track.stop()
      audioStream.removeTrack(track)
    })
    const videoStream = get().videoStream
    videoStream.getTracks().forEach((track) => {
      track.stop()
      videoStream.removeTrack(track)
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
