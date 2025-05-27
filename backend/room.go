package room

import (
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"slices"

	"github.com/gorilla/websocket"
	"github.com/pion/webrtc/v4"
)

const (
	MagicPrefix  = "\xDE\xAD\xBE\xEF"
	MagicLen     = 4
	HeaderLen    = 4
	TimestampLen = 8
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
	audioTracks  map[ParticipantID][]*webrtc.TrackLocalStaticRTP
	videoTracks  map[ParticipantID][]*webrtc.TrackLocalStaticRTP
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
		if track.Kind() == webrtc.RTPCodecTypeVideo {
			go s.Room.RelayVideoToListeners(track, s.Id)
		}
	})

	// loop through all the listeners and add a new audio track if it doesn't exist
	for _, listener := range s.Room.listeners {
		streamId := fmt.Sprintf("%s:%s:%s", "audio", s.Id, listener.Id)
		audioTrack, err := webrtc.NewTrackLocalStaticRTP(webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeOpus}, "audio", streamId)
		if err != nil {
			log.Println("Failed to create audio track:", err)
		}
		if _, err = listener.Pc.AddTrack(audioTrack); err != nil {
			log.Println("Failed to add audio track:", err)
		}
		s.Room.audioTracks[ParticipantID(s.Id)] = append(s.Room.audioTracks[ParticipantID(s.Id)], audioTrack)

		streamId = fmt.Sprintf("%s:%s:%s", "video", s.Id, listener.Id)
		videoTrack, err := webrtc.NewTrackLocalStaticRTP(webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeVP8}, "video", streamId)
		if err != nil {
			log.Println("Failed to create video track:", err)
		}
		if _, err = listener.Pc.AddTrack(videoTrack); err != nil {
			log.Println("Failed to add video track:", err)
		}
		s.Room.videoTracks[ParticipantID(s.Id)] = append(s.Room.videoTracks[ParticipantID(s.Id)], videoTrack)
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
	s.Room.NotifyParticipants(Signal{
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
		streamId := fmt.Sprintf("%s:%s:%s", "audio", speakerId, l.Id)
		audioTrack, err := webrtc.NewTrackLocalStaticRTP(webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeOpus}, "audio", streamId)
		if err != nil {
			log.Println("Failed to create audio track:", err)
		}
		if _, err = pc.AddTrack(audioTrack); err != nil {
			log.Println("Failed to add audio track:", err)
		}
		l.Room.audioTracks[ParticipantID(speakerId)] = append(l.Room.audioTracks[ParticipantID(speakerId)], audioTrack)

		streamId = fmt.Sprintf("%s:%s:%s", "video", speakerId, l.Id)
		videoTrack, err := webrtc.NewTrackLocalStaticRTP(webrtc.RTPCodecCapability{MimeType: webrtc.MimeTypeVP8}, "video", streamId)
		if err != nil {
			log.Println("Failed to create audio track:", err)
		}
		if _, err = pc.AddTrack(videoTrack); err != nil {
			log.Println("Failed to add video track:", err)
		}
		l.Room.videoTracks[ParticipantID(speakerId)] = append(l.Room.videoTracks[ParticipantID(speakerId)], videoTrack)
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
	l.Room.NotifyParticipants(Signal{
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
	partcipantCount, _ := json.Marshal(r.GetParticipants())
	r.NotifyParticipants(Signal{
		Type: "participant-count",
		Data: partcipantCount,
	})
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
		partcipantCount, _ := json.Marshal(r.GetParticipants())
		r.NotifyParticipants(Signal{
			Type: "participant-count",
			Data: partcipantCount,
		})
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
		r.NotifyParticipants(Signal{
			Type: "speaker-disconnected",
			Data: data,
		})
		break
	}
}

func (r *Room) RemoveSpeakerTracks(participantId ParticipantID) {
	delete(r.audioTracks, participantId)
	delete(r.videoTracks, participantId)
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
		r.NotifyParticipants(Signal{
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
		var filteredAudioTracks []*webrtc.TrackLocalStaticRTP
		for _, t := range r.audioTracks[ParticipantID(speakerId)] {
			for _, listener := range r.listeners {
				streamId := fmt.Sprintf("%s:%s:%s", "audio", speakerId, listener.Id)
				if t.StreamID() == streamId {
					filteredAudioTracks = append(filteredAudioTracks, t)
				}
			}
		}
		r.audioTracks[ParticipantID(speakerId)] = filteredAudioTracks

		var filteredVideoTracks []*webrtc.TrackLocalStaticRTP
		for _, t := range r.videoTracks[ParticipantID(speakerId)] {
			for _, listener := range r.listeners {
				streamId := fmt.Sprintf("%s:%s:%s", "video", speakerId, listener.Id)
				if t.StreamID() == streamId {
					filteredVideoTracks = append(filteredVideoTracks, t)
				}
			}
		}
		r.videoTracks[ParticipantID(speakerId)] = filteredVideoTracks

	}
}

func (r *Room) GetParticipants() int {
	return len(r.participants)
}

func (r *Room) NotifyParticipants(payload Signal) {
	for _, p := range r.participants {
		p.Ws.WriteJSON(payload)
	}
}

func (r *Room) RelayAudioToListeners(remote *webrtc.TrackRemote, participantId ParticipantID) {
	for {
		packet, _, err := remote.ReadRTP()
		if err != nil {
			if (err == io.EOF) || (err == io.ErrClosedPipe) {
				log.Println("Speaker track closed")
				break
			}
			log.Println("Error reading from remote track:", err)
			continue
		}

		for _, t := range r.audioTracks[participantId] {
			_ = t.WriteRTP(packet)
		}
	}
}

func (r *Room) RelayVideoToListeners(remote *webrtc.TrackRemote, participantId ParticipantID) {
	for {
		packet, _, err := remote.ReadRTP()
		if err != nil {
			if (err == io.EOF) || (err == io.ErrClosedPipe) {
				log.Println("Speaker track closed")
				break
			}
			log.Println("Error reading from remote track:", err)
			continue
		}

		payload := packet.Payload
		magicStart := HeaderLen
		magicEnd := magicStart + MagicLen
		if len(payload) > HeaderLen+MagicLen+TimestampLen && string(payload[magicStart:magicEnd]) == MagicPrefix {
			tsStart := magicEnd
			tsEnd := tsStart + TimestampLen
			timestampBytes := payload[tsStart:tsEnd]
			timestamp := binary.BigEndian.Uint64(timestampBytes)

			fmt.Println("Extracted timestamp:", timestamp)

			// Strip metadata from payload
			newPayload := make([]byte, 0, len(payload)-MagicLen-TimestampLen)
			newPayload = append(newPayload, payload[:HeaderLen]...)
			newPayload = append(newPayload, payload[tsEnd:]...)
			packet.Payload = newPayload

			data, _ := json.Marshal(fmt.Sprintf("%d:%d", packet.Timestamp, timestamp))
			r.NotifyParticipants(Signal{
				Type: "timestamp",
				Data: data,
			})
		}

		for _, t := range r.videoTracks[participantId] {
			_ = t.WriteRTP(packet)
		}
	}
}

func (r *Room) GetStats() {
	fmt.Printf("Participants: %d, Speakers: %d, Listeners: %d\n", len(r.participants), len(r.speakers), len(r.listeners))
	for speakerID, trackList := range r.audioTracks {
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
			id:          topic,
			speakers:    make([]*Speaker, 0),
			listeners:   make([]*Listener, 0),
			audioTracks: make(map[ParticipantID][]*webrtc.TrackLocalStaticRTP),
			videoTracks: make(map[ParticipantID][]*webrtc.TrackLocalStaticRTP),
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
