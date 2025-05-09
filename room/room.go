package room

import (
	"encoding/json"
	"io"
	"log"
	"slices"
	"time"

	"github.com/gorilla/websocket"
	"github.com/pion/webrtc/v4"
)

var (
	rooms = make(map[string]*Room)
)

type Signal struct {
	Type string          `json:"type"`
	Data json.RawMessage `json:"data"`
}

type RoomID string
type SpeakerID string
type ListenerID string

type Room struct {
	id        string
	speakers  []*Speaker
	listeners []*Listener
	tracks    map[SpeakerID][]*webrtc.TrackLocalStaticRTP
}

type Speaker struct {
	Id   SpeakerID
	Room *Room
	Pc   *webrtc.PeerConnection
	Ws   *websocket.Conn
}

type Listener struct {
	Id   ListenerID
	Room *Room
	Pc   *webrtc.PeerConnection
	Ws   *websocket.Conn
}

func (s *Speaker) CreatePeerConnection() error {
	pc, err := createPeerConnection()
	if err != nil {
		log.Println("Peer connection error:", err)
		return err
	}
	s.Pc = pc

	// On ICE candidate, send it to the client via WS
	pc.OnICECandidate(func(c *webrtc.ICECandidate) {
		if c == nil {
			return
		}
		candidateJSON, _ := json.Marshal(c.ToJSON())
		s.Ws.WriteJSON(Signal{
			Type: "ice",
			Data: candidateJSON,
		})
	})

	// On audio track, relay to listeners
	pc.OnTrack(func(track *webrtc.TrackRemote, receiver *webrtc.RTPReceiver) {
		if track.Kind() == webrtc.RTPCodecTypeAudio {
			go s.Room.RelayAudioToListeners(track, s.Id)
		}
	})
	return nil
}

func (s *Speaker) AcceptOffer(offer webrtc.SessionDescription) error {
	if err := s.Pc.SetRemoteDescription(offer); err != nil {
		log.Println("SetRemoteDescription failed:", err)
		return err
	}

	answer, err := s.Pc.CreateAnswer(nil)
	if err != nil {
		log.Println("CreateAnswer failed:", err)
		return err
	}
	if err := s.Pc.SetLocalDescription(answer); err != nil {
		log.Println("SetLocalDescription failed:", err)
		return err
	}

	<-webrtc.GatheringCompletePromise(s.Pc)

	answerJSON, _ := json.Marshal(*s.Pc.LocalDescription())
	s.Ws.WriteJSON(Signal{
		Type: "answer",
		Data: answerJSON,
	})

	s.Room.NotifyListeners(Signal{
		Type: "speaker-connected",
		Data: json.RawMessage(s.Id),
	})
	return nil
}

func (s *Speaker) AddIceCandidate(candidate webrtc.ICECandidateInit) {
	candidateJSON, _ := json.Marshal(candidate)
	s.Ws.WriteJSON(Signal{
		Type: "ice",
		Data: candidateJSON,
	})
}

func (l *Listener) CreatePeerConnection() error {
	pc, err := createPeerConnection()
	if err != nil {
		log.Println("Peer connection error:", err)
		return err
	}
	l.Pc = pc

	// On ICE candidate, send it to the client via WS
	pc.OnICECandidate(func(c *webrtc.ICECandidate) {
		if c == nil {
			return
		}
		candidateJSON, _ := json.Marshal(c.ToJSON())
		l.Ws.WriteJSON(Signal{
			Type: "ice",
			Data: candidateJSON,
		})
	})

	for _, s := range l.Room.speakers {
		audioTrack, err := webrtc.NewTrackLocalStaticRTP(webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeOpus}, "audio", string(s.Id))
		_, err = pc.AddTrack(audioTrack)
		if err != nil {
			log.Println("Failed to create audio track:", err)
		}
	}

	offer, err := pc.CreateOffer(nil)
	if err != nil {
		log.Println("Failed to create offer:", err)
		return err
	}

	if err := pc.SetLocalDescription(offer); err != nil {
		log.Println("Failed to set local description:", err)
		return err
	}

	<-webrtc.GatheringCompletePromise(pc)

	offerJSON, _ := json.Marshal(*pc.LocalDescription())
	l.Ws.WriteJSON(Signal{
		Type: "offer",
		Data: offerJSON,
	})

	return nil
}

func (l *Listener) AcceptAnswer(answer webrtc.SessionDescription) error {
	if err := l.Pc.SetRemoteDescription(answer); err != nil {
		log.Println("SetRemoteDescription failed:", err)
		return err
	}
	return nil
}

func (l *Listener) AddIceCandidate(candidate webrtc.ICECandidateInit) {
	candidateJSON, _ := json.Marshal(candidate)
	l.Ws.WriteJSON(Signal{
		Type: "ice",
		Data: candidateJSON,
	})
}

func (r *Room) AddSpeaker(speaker *Speaker) {
	speaker.Room = r
	log.Printf("adding speaker %s to room %s", speaker.Id, r.id)
	r.speakers = append(r.speakers, speaker)
}

func (r *Room) AddListener(listener *Listener) {
	listener.Room = r
	r.listeners = append(r.listeners, listener)
}

func (r *Room) RemoveSpeaker(speaker *Speaker) {
	for i, s := range r.speakers {
		if s != speaker {
			continue
		}
		log.Printf("removing speaker %s from room %s", speaker.Id, r.id)
		// Close the PeerConnection if it's not already nil
		if s.Pc != nil {
			err := s.Pc.Close()
			if err != nil {
				log.Println("Error closing peer connection:", err)
			} else {
				log.Println("Peer connection closed for speaker:", s.Id)
			}
		}

		// Remove the speaker from the slice
		r.speakers = slices.Delete(r.speakers, i, i+1)

		r.NotifyListeners(Signal{
			Type: "speaker-disconnected",
			Data: json.RawMessage(speaker.Id),
		})
		break
	}
}

func (r *Room) RemoveListener(listener *Listener) {
	for i, l := range r.listeners {
		if l == listener {
			continue
		}
		// Close the PeerConnection if it's not already nil
		if l.Pc != nil {
			err := l.Pc.Close()
			if err != nil {
				log.Println("Error closing peer connection:", err)
			} else {
				log.Println("Peer connection closed for speaker:", l.Id)
			}
		}

		// Remove the listener from the slice
		r.listeners = slices.Delete(r.listeners, i, i+1)
		break
	}
}

func (r *Room) NotifyListeners(payload Signal) {
	for _, l := range r.listeners {
		l.Ws.WriteJSON(payload)
	}
}

func GetOrCreateRoom(topic string) *Room {
	room, exists := rooms[topic]
	if !exists {
		room = &Room{
			id:        topic,
			speakers:  make([]*Speaker, 0),
			listeners: make([]*Listener, 0),
			tracks:    make(map[SpeakerID][]*webrtc.TrackLocalStaticRTP),
		}
		rooms[topic] = room
	}
	return room
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

func (r *Room) RelayAudioToListeners(remote *webrtc.TrackRemote, speakerId SpeakerID) {
	for {
		start := time.Now()
		// Read audio data from the speaker's track
		packet, _, err := remote.ReadRTP()
		if err != nil {
			if (err == io.EOF) || (err == io.ErrClosedPipe) {
				log.Println("Speaker track closed")
				break
			}
			log.Println("Error reading from remote track:", err)
			continue
		}

		elapsed := time.Since(start)
		log.Printf("Read %d bytes in (%s)\n", len(packet.Payload), elapsed)

		// Relay the audio packet to all listeners
		start = time.Now()
		for _, t := range r.tracks[speakerId] {
			log.Println("relaying to track")
			log.Println(t)
			// Write the RTP packet to the listener's track
			_ = t.WriteRTP(packet)
		}
		elapsed = time.Since(start)
		log.Printf("Relayed %d bytes to %d listeners (%s)\n", len(packet.Payload), len(r.tracks[speakerId]), elapsed)
	}
}
