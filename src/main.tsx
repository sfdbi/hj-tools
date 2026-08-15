import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router'
import './index.css'
import App from './App.tsx'

// HashRouter：纯静态托管（GitHub Pages 等）无 SPA 回退时路由仍可正常工作
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
)
