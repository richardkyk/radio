package main

import (
	_ "embed"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"radio/room"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/pion/webrtc/v4"
)

var (
	//go:embed frontend/index.html
	indexHTML string

	//go:embed frontend/listener.html
	listenerHTML string
)

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
	upgrader := websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool { return true },
	}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("WebSocket upgrade failed:", err)
		return
	}
	defer conn.Close()

	params := r.URL.Query()
	topic := params.Get("topic")

	chatRoom := room.GetOrCreateRoom(topic)
	speaker := room.Speaker{
		Id: room.SpeakerID(uuid.NewString()),
		Ws: conn,
	}
	chatRoom.AddSpeaker(&speaker)
	defer chatRoom.RemoveSpeaker(&speaker)

	for {
		var msg room.Signal
		if err := conn.ReadJSON(&msg); err != nil {
			if err == io.ErrClosedPipe {
				log.Println("Speaker disconnected")
				break
			}
			log.Println("WS read error:", err)
			break
		}

		switch msg.Type {
		case "broadcast-started":
			if err := speaker.CreatePeerConnection(); err != nil {
				log.Println("Peer connection error:", err)
				continue
			}
		case "offer":
			var offer webrtc.SessionDescription
			if err := json.Unmarshal(msg.Data, &offer); err != nil {
				log.Println("Invalid offer:", err)
				return
			}
			if err := speaker.AcceptOffer(offer); err != nil {
				log.Println("Accept offer error:", err)
				return
			}
		case "ice":
			var candidate webrtc.ICECandidateInit
			if err := json.Unmarshal(msg.Data, &candidate); err != nil {
				log.Println("Invalid ICE candidate:", err)
				continue
			}
			speaker.AddIceCandidate(candidate)
		}
	}
}

// Handle offer from listeners
func handleListenerWS(w http.ResponseWriter, r *http.Request) {
	upgrader := websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool { return true },
	}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Println("WebSocket upgrade failed:", err)
		return
	}
	defer conn.Close()

	params := r.URL.Query()
	topic := params.Get("topic")

	chatRoom := room.GetOrCreateRoom(topic)
	listener := room.Listener{
		Id: room.ListenerID(uuid.NewString()),
		Ws: conn,
	}
	chatRoom.AddListener(&listener)
	defer chatRoom.RemoveListener(&listener)

	// Process WebSocket messages from the listener
	for {
		var msg room.Signal
		if err := conn.ReadJSON(&msg); err != nil {
			if err == io.ErrClosedPipe {
				log.Println("Listener disconnected")
				break
			}
			log.Println("WS read error:", err)
			break
		}

		switch msg.Type {
		case "listening-started":
			if err := listener.CreatePeerConnection(); err != nil {
				log.Println("Peer connection error:", err)
				continue
			}
		case "answer":
			var answer webrtc.SessionDescription
			if err := json.Unmarshal(msg.Data, &answer); err != nil {
				log.Println("Invalid answer:", err)
				continue
			}
			if err := listener.AcceptAnswer(answer); err != nil {
				log.Println("Accept answer error:", err)
				continue
			}
		case "ice":
			var candidate webrtc.ICECandidateInit
			if err := json.Unmarshal(msg.Data, &candidate); err != nil {
				log.Println("Invalid ICE candidate:", err)
				continue
			}
			listener.AddIceCandidate(candidate)
		}
	}
}

func main() {
	http.HandleFunc("/", listenerFrontendHander)
	http.HandleFunc("/speaker", speakerFrontendHander)
	http.HandleFunc("/ws/speaker", handleSpeakerWS)
	http.HandleFunc("/ws/listener", handleListenerWS)

	log.Println("Listening on port 443...")
	log.Fatal(http.ListenAndServeTLS(":443", ".cert/cert.pem", ".cert/key.pem", nil))
}
