package main

import (
	_ "embed"
	"encoding/json"
	"log"
	"net/http"
	"slices"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/pion/rtp"
	"github.com/pion/webrtc/v4"
)

var (
	//go:embed frontend/index.html
	indexHTML string

	//go:embed frontend/listener.html
	listenerHTML string

	// Slice to keep track of listener connections and audio tracks
	listenerTracks []*webrtc.TrackLocalStaticRTP
	listenerMu     sync.Mutex
)

type Signal struct {
	Type string          `json:"type"`
	Data json.RawMessage `json:"data"`
}

func speakerFrontendHander(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html")
	w.Write([]byte(indexHTML))
}

func listenerFrontendHander(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html")
	w.Write([]byte(listenerHTML))
}

// Handle offer from the speaker
func handleSpeakerWS(w http.ResponseWriter, r *http.Request) {
	upgrader := websocket.Upgrader{}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("WebSocket upgrade failed:", err)
		return
	}
	defer conn.Close()

	pc, err := createPeerConnection()
	if err != nil {
		log.Println("Peer connection error:", err)
		return
	}
	defer pc.Close()

	// On ICE candidate, send it to the client via WS
	pc.OnICECandidate(func(c *webrtc.ICECandidate) {
		if c == nil {
			return
		}
		candidateJSON, _ := json.Marshal(c.ToJSON())
		conn.WriteJSON(Signal{
			Type: "ice",
			Data: candidateJSON,
		})
	})

	// On audio track, relay to listeners
	pc.OnTrack(func(track *webrtc.TrackRemote, receiver *webrtc.RTPReceiver) {
		if track.Kind() == webrtc.RTPCodecTypeAudio {
			go relayAudioToListeners(track)
		}
	})

	for {
		var msg Signal
		if err := conn.ReadJSON(&msg); err != nil {
			log.Println("WS read error:", err)
			break
		}

		switch msg.Type {
		case "offer":
			var offer webrtc.SessionDescription
			if err := json.Unmarshal(msg.Data, &offer); err != nil {
				log.Println("Invalid offer:", err)
				return
			}
			if err := pc.SetRemoteDescription(offer); err != nil {
				log.Println("SetRemoteDescription failed:", err)
				return
			}

			answer, err := pc.CreateAnswer(nil)
			if err != nil {
				log.Println("CreateAnswer failed:", err)
				return
			}
			if err := pc.SetLocalDescription(answer); err != nil {
				log.Println("SetLocalDescription failed:", err)
				return
			}

			<-webrtc.GatheringCompletePromise(pc)

			answerJSON, _ := json.Marshal(*pc.LocalDescription())
			conn.WriteJSON(Signal{
				Type: "answer",
				Data: answerJSON,
			})

		case "ice":
			var candidate webrtc.ICECandidateInit
			if err := json.Unmarshal(msg.Data, &candidate); err != nil {
				log.Println("Invalid ICE candidate:", err)
				continue
			}
			pc.AddICECandidate(candidate)
		}
	}
}

// Handle offer from listeners
func handleListenerWS(w http.ResponseWriter, r *http.Request) {
	upgrader := websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool { return true }, // Allow any origin (adjust for security)
	}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("WebSocket upgrade failed:", err)
		return
	}
	defer conn.Close()

	// Create a new WebRTC peer connection for the listener
	pc, err := createPeerConnection()
	if err != nil {
		log.Println("Peer connection creation failed:", err)
		return
	}
	defer pc.Close()

	// On ICE candidate, send it to the client via WebSocket
	pc.OnICECandidate(func(c *webrtc.ICECandidate) {
		if c == nil {
			return
		}
		candidateJSON, _ := json.Marshal(c.ToJSON())
		conn.WriteJSON(Signal{
			Type: "ice",
			Data: candidateJSON,
		})
	})

	// Create a track for receiving audio (or any media type)
	// This is where the server prepares the track to receive media from the speaker.
	audioTrack, err := webrtc.NewTrackLocalStaticRTP(webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeOpus}, "audio", "broadcast")
	listenerTracks = append(listenerTracks, audioTrack)
	if err != nil {
		log.Println("Failed to create audio track:", err)
		return
	}

	// Add the created audio track to the peer connection
	_, err = pc.AddTrack(audioTrack)
	if err != nil {
		log.Println("Failed to add audio track to listener:", err)
		return
	}
	// Defer a function to remove the track when the connection closes
	defer func() {
		// Remove the track from the listenerTracks slice
		for i, track := range listenerTracks {
			if track == audioTrack {
				listenerTracks = slices.Delete(listenerTracks, i, i+1)
				break
			}
		}
	}()

	// Process WebSocket messages from the listener
	for {
		var msg Signal
		if err := conn.ReadJSON(&msg); err != nil {
			log.Println("Error reading WebSocket message:", err)
			break
		}

		switch msg.Type {
		case "listen":
			// When listener starts listening, create an offer and send it
			offer, err := pc.CreateOffer(nil)
			if err != nil {
				log.Println("Failed to create offer:", err)
				continue
			}

			if err := pc.SetLocalDescription(offer); err != nil {
				log.Println("Failed to set local description:", err)
				continue
			}

			// Send the offer to the listener
			offerJSON, _ := json.Marshal(*pc.LocalDescription())
			conn.WriteJSON(Signal{
				Type: "offer",
				Data: offerJSON,
			})

		case "answer":
			var answer webrtc.SessionDescription
			if err := json.Unmarshal(msg.Data, &answer); err != nil {
				log.Println("Invalid answer:", err)
				continue
			}

			// Set remote description from the listener's answer
			if err := pc.SetRemoteDescription(answer); err != nil {
				log.Println("Failed to set remote description:", err)
				continue
			}

		case "ice":
			var candidate webrtc.ICECandidateInit
			if err := json.Unmarshal(msg.Data, &candidate); err != nil {
				log.Println("Invalid ICE candidate:", err)
				continue
			}
			pc.AddICECandidate(candidate)
		}
	}
}

// Helper function to create a new peer connection with necessary settings
func createPeerConnection() (*webrtc.PeerConnection, error) {
	m := webrtc.MediaEngine{}
	m.RegisterDefaultCodecs()
	api := webrtc.NewAPI(webrtc.WithMediaEngine(&m))

	peerConnection, err := api.NewPeerConnection(webrtc.Configuration{
		ICEServers: []webrtc.ICEServer{},
	})
	if err != nil {
		return nil, err
	}

	// Handle ICE connection state changes (optional)
	peerConnection.OnICEConnectionStateChange(func(state webrtc.ICEConnectionState) {
		log.Printf("ICE connection state: %s", state.String())
		if state == webrtc.ICEConnectionStateFailed {
			peerConnection.Close()
		}
	})

	return peerConnection, nil
}

// Relay audio from the speaker to all listeners
func relayAudioToListeners(remote *webrtc.TrackRemote) {
	buffer := make([]byte, 500)
	for {
		// Read audio data from the speaker's track
		n, _, err := remote.Read(buffer)
		if err != nil {
			log.Println("Error reading from remote track:", err)
			break
		}

		// Decode the RTP packet
		packet := &rtp.Packet{}
		if err := packet.Unmarshal(buffer[:n]); err != nil {
			log.Println("Failed to unmarshal RTP packet:", err)
			continue
		}

		// Relay the audio packet to all listeners
		start := time.Now()
		listenerMu.Lock()
		for _, track := range listenerTracks {
			// Write the RTP packet to the listener's track
			_ = track.WriteRTP(packet)
		}
		listenerMu.Unlock()
		elapsed := time.Since(start)
		log.Printf("Relayed %d bytes to %d listeners (%s)\n", n, len(listenerTracks), elapsed)
	}
}

func main() {
	http.HandleFunc("/", listenerFrontendHander)
	http.HandleFunc("/speaker", speakerFrontendHander)
	http.HandleFunc("/ws/speaker", handleSpeakerWS)
	http.HandleFunc("/ws/listener", handleListenerWS)

	log.Println("Listening on port 443...")
	log.Fatal(http.ListenAndServeTLS(":443", "test.com.pem", "test.com-key.pem", nil))
}
