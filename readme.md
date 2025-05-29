# 🌐 Radio - Local Network Voice Translation Platform

Radio is a real-time, one-way voice communication platform built for live human translation use cases, ideal for conferences, events, classrooms, or religious services. It enables interpreters to stream voice translations to listeners over a local network, ensuring ultra-low latency without reliance on the internet.

Built with a React + Vite frontend and a Go backend for WebRTC signaling and media relay, this system offers a scalable, high-performance solution for local multilingual broadcasting.

## ✨ Features

- 🎙️ One-way real-time voice streaming (speakers -> listeners)
- 🗣️ Language-specific rooms (e.g. `/listener/en`, `/speaker/en`)
- 🌐 WebRTC-based media transmission for ultra-low latency
- ⚡ LAN-first architecture — designed for speed and privacy
- 🧩 Modular frontend (Vite + React) and backend (Go)

# 🛠️ Tech Stack
Frontend: React, Zustand, WebSockets, WebRTC
Backend: Go (Golang) with Pion WebRTC for signaling and media relay

