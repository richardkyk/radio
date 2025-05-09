package room

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"slices"
	"strings"

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
type ParticipantID string

type Room struct {
	id           string
	speakers     []*Speaker
	listeners    []*Listener
	participants []*Participant
	tracks       map[ParticipantID][]*webrtc.TrackLocalStaticRTP
}

type Participant struct {
	Id   ParticipantID
	Room *Room
	Ws   *websocket.Conn

	Speaker  *Speaker
	Listener *Listener
}

type Speaker struct {
	*Participant
	Pc *webrtc.PeerConnection
}

type Listener struct {
	*Participant
	Pc *webrtc.PeerConnection
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

	// loop through all the listeners and add a new audio track if it doesn't exist
	for _, listener := range s.Room.listeners {
		streamId := fmt.Sprintf("%s:%s", s.Id, listener.Id)
		audioTrack, err := webrtc.NewTrackLocalStaticRTP(webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeOpus}, "audio", streamId)
		_, err = listener.Pc.AddTrack(audioTrack)
		if err != nil {
			log.Println("Failed to create audio track:", err)
		}
		s.Room.tracks[ParticipantID(s.Id)] = append(s.Room.tracks[ParticipantID(s.Id)], audioTrack)
	}

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

	data, _ := json.Marshal(s.Id)
	s.Room.NotifyListeners(Signal{
		Type: "speaker-connected",
		Data: data,
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

	speakerIds := []string{"server"}
	for _, s := range l.Room.speakers {
		speakerIds = append(speakerIds, string(s.Id))
	}

	for _, speakerId := range speakerIds {
		streamId := fmt.Sprintf("%s:%s", speakerId, l.Id)
		audioTrack, err := webrtc.NewTrackLocalStaticRTP(webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeOpus}, "audio", streamId)
		_, err = pc.AddTrack(audioTrack)
		if err != nil {
			log.Println("Failed to create audio track:", err)
		}
		l.Room.tracks[ParticipantID(speakerId)] = append(l.Room.tracks[ParticipantID(speakerId)], audioTrack)
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

	data, _ := json.Marshal(l.Id)
	l.Room.NotifySpeakers(Signal{
		Type: "listener-connected",
		Data: data,
	})
	return nil
}

func (l *Listener) AddIceCandidate(candidate webrtc.ICECandidateInit) {
	candidateJSON, _ := json.Marshal(candidate)
	l.Ws.WriteJSON(Signal{
		Type: "ice",
		Data: candidateJSON,
	})
}
func (r *Room) AddParticipant(participant *Participant) {
	participant.Room = r
	log.Printf("Adding Participant (%s) to Room (%s)", participant.Id, r.id)
	r.participants = append(r.participants, participant)
}

func (r *Room) AddSpeaker(speaker *Speaker) {
	log.Printf("Adding Speaker (%s) to Room (%s)", speaker.Id, r.id)
	speaker.Participant.Speaker = speaker
	speaker.Participant.Listener = nil
	r.speakers = append(r.speakers, speaker)
}

func (r *Room) AddListener(listener *Listener) {
	log.Printf("Adding Listener (%s) to Room (%s)", listener.Id, r.id)
	listener.Participant.Speaker = nil
	listener.Participant.Listener = listener
	r.listeners = append(r.listeners, listener)
}

func (r *Room) RemoveParticipant(participant *Participant) {
	for i, p := range r.participants {
		if p != participant {
			continue
		}
		// Remove the participant from the slice
		log.Printf("Removing Participant (%s) from Room (%s)", participant.Id, r.id)
		r.participants = slices.Delete(r.participants, i, i+1)
		break
	}
}

func (r *Room) RemoveSpeaker(participantId ParticipantID) {
	for i, s := range r.speakers {
		if s.Id != participantId {
			continue
		}
		log.Printf("Removing Speaker (%s) from Room %s", s.Id, r.id)
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

		data, _ := json.Marshal(s.Id)
		r.NotifyListeners(Signal{
			Type: "speaker-disconnected",
			Data: data,
		})
		break
	}
}

func (r *Room) RemoveSpeakerTracks(participantId ParticipantID) {
	delete(r.tracks, participantId)
}

func (r *Room) RemoveListener(participantId ParticipantID) {
	for i, l := range r.listeners {
		if l.Id != participantId {
			continue
		}
		log.Printf("Removing Listener (%s) from Room %s", l.Id, r.id)
		// Close the PeerConnection if it's not already nil
		if l.Pc != nil {
			err := l.Pc.Close()
			if err != nil {
				log.Println("Error closing peer connection:", err)
			} else {
				log.Println("Peer connection closed for listener:", l.Id)
			}
		}

		// Remove the listener from the slice
		r.listeners = slices.Delete(r.listeners, i, i+1)
		data, _ := json.Marshal(l.Id)
		r.NotifySpeakers(Signal{
			Type: "listener-disconnected",
			Data: data,
		})
		break
	}
}

func (r *Room) RemoveListenerTracks(participantId ParticipantID) {
	speakerIds := []string{"server"}
	for _, s := range r.speakers {
		speakerIds = append(speakerIds, string(s.Id))
	}

	for _, speakerId := range speakerIds {
		var filteredTracks []*webrtc.TrackLocalStaticRTP
		for _, t := range r.tracks[ParticipantID(speakerId)] {
			streamId := t.StreamID()
			parts := strings.Split(streamId, ":")

			if len(parts) != 2 {
				continue
			}
			listenerId := parts[1]

			if listenerId != string(participantId) {
				filteredTracks = append(filteredTracks, t)
			}
		}
		r.tracks[ParticipantID(speakerId)] = filteredTracks
	}
}

func (r *Room) NotifyListeners(payload Signal) {
	for _, l := range r.listeners {
		l.Ws.WriteJSON(payload)
	}
}

func (r *Room) NotifySpeakers(payload Signal) {
	for _, s := range r.speakers {
		s.Ws.WriteJSON(payload)
	}
}

func (r *Room) RelayAudioToListeners(remote *webrtc.TrackRemote, participantId ParticipantID) {
	for {
		// start := time.Now()
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

		// elapsed := time.Since(start)
		// log.Printf("Read %d bytes in (%s)\n", len(packet.Payload), elapsed)

		// Relay the audio packet to all listeners
		// start = time.Now()
		for _, t := range r.tracks[participantId] {
			// Write the RTP packet to the listener's track
			_ = t.WriteRTP(packet)
		}
		// elapsed = time.Since(start)
		// log.Printf("Relayed %d bytes to %d listeners (%s)\n", len(packet.Payload), len(r.tracks[speakerId]), elapsed)
	}
}

func (r *Room) GetStats() {
	fmt.Printf("Participants: %d, Speakers: %d, Listeners: %d\n", len(r.participants), len(r.speakers), len(r.listeners))
	for speakerID, trackList := range r.tracks {
		fmt.Printf("SpeakerID: %s\n", speakerID)
		for i, track := range trackList {
			if track != nil {
				fmt.Printf("  Track #%d - ID: %s, StreamID: %s\n", i, track.ID(), track.StreamID())
			} else {
				fmt.Printf("  Track #%d - <nil>\n", i)
			}
		}
	}
	fmt.Println()
}

func GetOrCreateRoom(topic string) *Room {
	room, exists := rooms[topic]
	if !exists {
		room = &Room{
			id:        topic,
			speakers:  make([]*Speaker, 0),
			listeners: make([]*Listener, 0),
			tracks:    make(map[ParticipantID][]*webrtc.TrackLocalStaticRTP),
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
