import '@ant-design/v5-patch-for-react-19'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/globals.css'
import './styles/redesign.css'
import './styles/surfaces.css'
import './styles/settings.css'
import './styles/analysis.css'
import { installChunkReloadGuard } from './lib/chunk-reload'
import App from './App.tsx'

// 部署后旧页面可能引用已失效的构建产物：动态 import 失败时自动整页刷新一次
installChunkReloadGuard()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
