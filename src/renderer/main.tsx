import React from 'react'
import { createRoot } from 'react-dom/client'
import { defineMpvVideoElement } from 'electron-mpv-video/renderer'
import App from './App'
import './styles/base.css'
import './styles/startup.css'
import './styles/pages.css'
import './styles/player.css'
import './styles/theme-accent.css'

defineMpvVideoElement()

const container = document.getElementById('root')
if (container) {
  createRoot(container).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}
