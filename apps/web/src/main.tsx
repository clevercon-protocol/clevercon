// Browser polyfill for @stellar/stellar-sdk and the wallet kit (expect Node's Buffer).
import { Buffer } from 'buffer';
(globalThis as unknown as { Buffer?: typeof Buffer }).Buffer ||= Buffer;

import { StrictMode, Component, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';

/** Surfaces render errors instead of a blank page. */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            padding: 24,
            color: '#fca5a5',
            fontFamily: 'monospace',
            background: '#0b0d13',
            minHeight: '100vh',
          }}
        >
          <h1 style={{ color: '#f8fafc' }}>Something went wrong</h1>
          <pre style={{ whiteSpace: 'pre-wrap' }}>{this.state.error.message}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
