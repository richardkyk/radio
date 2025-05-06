package main

import (
	_ "embed"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

//go:embed frontend/index.html
var indexHTML string

//go:embed frontend/listener.html
var listenerHTML string

type Connection struct {
	bufferChannel chan []byte
}

type ConnectionPool struct {
	ConnectionMap map[*Connection]struct{}
	mu            sync.Mutex
}

var Pool = &ConnectionPool{ConnectionMap: make(map[*Connection]struct{})}

func (cp *ConnectionPool) AddConnection(connection *Connection) {
	defer cp.mu.Unlock()
	cp.mu.Lock()
	cp.ConnectionMap[connection] = struct{}{}
}

func (cp *ConnectionPool) DeleteConnection(connection *Connection) {
	defer cp.mu.Unlock()
	cp.mu.Lock()
	delete(cp.ConnectionMap, connection)
}

func (cp *ConnectionPool) Broadcast(buffer []byte) {
	defer cp.mu.Unlock()
	cp.mu.Lock()
	for connection := range cp.ConnectionMap {
		bufCopy := make([]byte, len(buffer))
		copy(bufCopy, buffer)
		select {
		case connection.bufferChannel <- bufCopy:
		default:
		}
	}
}

func handleConnection(w http.ResponseWriter, r *http.Request) {
	w.Header().Add("Content-Type", "audio/webm") // match browser MediaRecorder output
	w.Header().Add("Transfer-Encoding", "chunked")
	w.Header().Add("Cache-Control", "no-cache")
	w.Header().Add("Connection", "keep-alive")

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "Streaming unsupported", http.StatusInternalServerError)
		return
	}

	connection := &Connection{bufferChannel: make(chan []byte, 10)} // buffered channel to avoid blocking
	Pool.AddConnection(connection)
	defer Pool.DeleteConnection(connection)
	log.Printf("%s has connected to the audio stream\n", r.RemoteAddr)

	for {
		buf, ok := <-connection.bufferChannel
		if !ok {
			log.Println("Connection closed by broadcaster")
			break
		}
		_, err := w.Write(buf)
		if err != nil {
			log.Printf("Write error: %v", err)
			break
		}
		log.Printf("Sent %d bytes\n", len(buf))
		flusher.Flush()
	}
	log.Printf("%s's connection to the audio stream has been closed\n", r.RemoteAddr)
}

func speakerFrontendHander(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html")
	w.Write([]byte(indexHTML))
}

func listenerFrontendHander(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html")
	w.Write([]byte(listenerHTML))
}

type webSocketHandler struct {
	upgrader websocket.Upgrader
}

func (wsh webSocketHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	c, err := wsh.upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("error %s when upgrading connection to websocket", err)
		return
	}
	defer func() {
		log.Println("closing connection")
		c.Close()
	}()

	os.MkdirAll("output", 0755) // ensure folder exists

	timestamp := time.Now().UnixMilli()
	filename := fmt.Sprintf("audio_%d.webm", timestamp) // Use .webm extension
	filepath := filepath.Join("output", filename)

	file, err := os.Create(filepath)
	if err != nil {
		log.Printf("Error creating file %s: %v", filepath, err)
		return
	}
	defer file.Close()

	for {
		_, data, err := c.ReadMessage()
		if err != nil {
			log.Println("Read error:", err)
			break
		}
		log.Printf("Received %d bytes\n", len(data)) // TODO: handle errors
		Pool.Broadcast(data)
		_, err = file.Write(data)
	}
}

func main() {
	webSocketHandler := webSocketHandler{
		upgrader: websocket.Upgrader{},
	}
	http.HandleFunc("/", listenerFrontendHander)
	http.HandleFunc("/english", handleConnection)
	http.HandleFunc("/stream", speakerFrontendHander)
	http.Handle("/api/stream", webSocketHandler)
	log.Println("Listening on port 443...")
	log.Fatal(http.ListenAndServeTLS(":443", "test.com.pem", "test.com-key.pem", nil))
}
