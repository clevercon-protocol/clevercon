import { StrictMode, Component, type ReactNode, type ErrorInfo } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Suppress unhandled promise rejections from wallet extension detection.
// These are non-fatal: extensions probe for MetaMask/EVM wallets at startup
// even when we only use Freighter. Swallowing them keeps the console clean.
window.addEventListener('unhandledrejection', (e) => {
  const msg = e.reason?.message ?? String(e.reason ?? '')
  if (
    msg.includes('MetaMask') ||
    msg.includes('Failed to connect') ||
    msg.includes('no elements in sequence') ||
    msg.includes('ethereum') ||
    msg.includes('Web3')
  ) {
    e.preventDefault()
  }
})

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info)
  }

  render() {
    const { error } = this.state
    if (error) {
      return (
        <div style={{
          minHeight: '100vh', background: '#0f1117', color: '#f87171',
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', padding: '2rem', fontFamily: 'monospace',
        }}>
          <h2 style={{ color: '#fca5a5', marginBottom: '1rem' }}>React render error</h2>
          <pre style={{
            background: '#1e1e2e', padding: '1rem', borderRadius: '8px',
            maxWidth: '90vw', overflow: 'auto', fontSize: '0.8rem', color: '#f87171',
          }}>
            {error.message}
            {'\n\n'}
            {error.stack}
          </pre>
        </div>
      )
    }
    return this.props.children
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
