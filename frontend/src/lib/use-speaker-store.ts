import { create } from 'zustand'
import { useWebSocketStore } from './web-socket-store'

declare global {
  interface RTCRtpSender {
    createEncodedStreams(): {
      readable: ReadableStream<RTCEncodedVideoFrame | RTCEncodedAudioFrame>
      writable: WritableStream<RTCEncodedVideoFrame | RTCEncodedAudioFrame>
    }
  }
}

interface SpeakerState {
  isActive: boolean
  stream: MediaStream | null
  pc: RTCPeerConnection | null
  answerReceived: boolean
  iceCandidates: Array<RTCIceCandidateInit>
  videoElement: HTMLCanvasElement | null
  start: () => Promise<void>
  stop: () => void
  toggle: () => void
  acceptOffer: (data: RTCSessionDescriptionInit) => Promise<void>
  addIceCandidate: (candidate: RTCIceCandidateInit) => Promise<void>
  setVideoElement: (element: HTMLCanvasElement | null) => void
}

export const useSpeakerStore = create<SpeakerState>((set, get) => ({
  isActive: false,
  stream: null,
  pc: null,
  answerReceived: false,
  iceCandidates: [],
  videoElement: null,

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

      const videoElement = get().videoElement
      if (videoElement) {
        const videoStream = videoElement.captureStream()
        const videoTrack = videoStream.getVideoTracks()[0]
        console.log('videoTrack', videoTrack)
        const dummyStream = new MediaStream([videoTrack])
        pc.addTrack(videoTrack, dummyStream)
        // const sender = pc.addTrack(videoTrack, dummyStream)
        //
        // const { readable, writable } = sender.createEncodedStreams()
        // const transformStream = new TransformStream({
        //   async transform(encodedFrame, controller) {
        //     const timestamp = BigInt(Date.now()) * 1_000_000n
        //     const meta = new Uint8Array(8)
        //     new DataView(meta.buffer).setBigUint64(0, timestamp, false)
        //
        //     const newData = new Uint8Array(
        //       meta.length + encodedFrame.data.byteLength,
        //     )
        //     newData.set(meta)
        //     newData.set(new Uint8Array(encodedFrame.data), meta.length)
        //     encodedFrame.data = newData.buffer
        //     controller.enqueue(encodedFrame)
        //   },
        // })
        // readable.pipeThrough(transformStream).pipeTo(writable)
      }

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
  setVideoElement: (element: HTMLCanvasElement | null) => {
    set({ videoElement: element })
  },
}))
