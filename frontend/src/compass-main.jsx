import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './compass.css'
import Catalyst from './Compass.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Catalyst />
  </StrictMode>,
)
