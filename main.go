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

// var (
// 	//go:embed frontend/index.html
// 	indexHTML string
//
// 	//go:embed frontend/listener.html
// 	listenerHTML string
// )

// func speakerFrontendHander(w http.ResponseWriter, r *http.Request) {
// 	w.Header().Set("Content-Type", "text/html")
// 	w.Write([]byte(indexHTML))
// }
//
// func listenerFrontendHander(w http.ResponseWriter, r *http.Request) {
// 	w.Header().Set("Content-Type", "text/html")
// 	w.Write([]byte(listenerHTML))
// }

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
	participant := room.Participant{
		Id: room.ParticipantID(uuid.NewString()),
		Ws: conn,
	}
	chatRoom.AddParticipant(&participant)
	defer func() {
		chatRoom.RemoveSpeaker(participant.Id)
		chatRoom.RemoveSpeakerTracks(participant.Id)
		chatRoom.RemoveParticipant(&participant)
	}()

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
			speaker := room.Speaker{
				Participant: &participant,
			}
			chatRoom.AddSpeaker(&speaker)
			if err := speaker.CreatePeerConnection(); err != nil {
				log.Println("Peer connection error:", err)
				chatRoom.RemoveSpeaker(participant.Id)
				chatRoom.RemoveSpeakerTracks(participant.Id)
				continue
			}
			chatRoom.GetStats()
		case "offer":
			var offer webrtc.SessionDescription
			if err := json.Unmarshal(msg.Data, &offer); err != nil {
				log.Println("Invalid offer:", err)
				return
			}
			if err := participant.Speaker.AcceptOffer(offer); err != nil {
				log.Println("Accept offer error:", err)
				return
			}
		case "ice":
			var candidate webrtc.ICECandidateInit
			if err := json.Unmarshal(msg.Data, &candidate); err != nil {
				log.Println("Invalid ICE candidate:", err)
				continue
			}
			participant.Speaker.AddIceCandidate(candidate)
		case "broadcast-stopped":
			chatRoom.RemoveSpeaker(participant.Id)
			chatRoom.RemoveSpeakerTracks(participant.Id)
			chatRoom.GetStats()
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
	participant := room.Participant{
		Id: room.ParticipantID(uuid.NewString()),
		Ws: conn,
	}
	chatRoom.AddParticipant(&participant)
	defer func() {
		chatRoom.RemoveListener(participant.Id)
		chatRoom.RemoveListenerTracks(participant.Id)
		chatRoom.RemoveParticipant(&participant)
	}()

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
			listener := room.Listener{
				Participant: &participant,
			}
			chatRoom.AddListener(&listener)
			if err := listener.CreatePeerConnection(); err != nil {
				log.Println("Peer connection error:", err)
				chatRoom.RemoveListener(participant.Id)
				chatRoom.RemoveListenerTracks(participant.Id)
				continue
			}
			chatRoom.GetStats()
		case "answer":
			var answer webrtc.SessionDescription
			if err := json.Unmarshal(msg.Data, &answer); err != nil {
				log.Println("Invalid answer:", err)
				continue
			}
			if err := participant.Listener.AcceptAnswer(answer); err != nil {
				log.Println("Accept answer error:", err)
				continue
			}
		case "ice":
			var candidate webrtc.ICECandidateInit
			if err := json.Unmarshal(msg.Data, &candidate); err != nil {
				log.Println("Invalid ICE candidate:", err)
				continue
			}
			participant.Listener.AddIceCandidate(candidate)
		case "listening-stopped":
			chatRoom.RemoveListener(participant.Id)
			chatRoom.RemoveListenerTracks(participant.Id)
			chatRoom.GetStats()
		}
	}
}

func main() {
	// http.HandleFunc("/", listenerFrontendHander)
	// http.HandleFunc("/speaker", speakerFrontendHander)
	http.HandleFunc("/ws/speaker", handleSpeakerWS)
	http.HandleFunc("/ws/listener", handleListenerWS)

	log.Println("Listening on port 443...")
	log.Fatal(http.ListenAndServeTLS(":443", ".cert/cert.pem", ".cert/key.pem", nil))
}
