import React from 'react'

type Props = { children: React.ReactNode }
type State = { hasError: boolean; message: string }

export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, message: '' }

  static getDerivedStateFromError(error: unknown): State {
    return { hasError: true, message: error instanceof Error ? error.message : 'Unknown error' }
  }

  componentDidCatch(error: unknown) {
    // Keep logging minimal; avoids breaking rendering further.
    // eslint-disable-next-line no-console
    console.error('Render error:', error)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 18, color: '#ff8080', fontFamily: 'JetBrains Mono, monospace' }}>
          <div style={{ fontSize: 12, letterSpacing: 2, color: '#555', marginBottom: 10 }}>RENDER ERROR</div>
          <div style={{ fontSize: 12, marginBottom: 14 }}>{this.state.message}</div>
          <button
            style={{
              border: '1px solid #1e1e2e',
              background: 'rgba(0,0,0,0.18)',
              color: '#e8e8f2',
              borderRadius: 10,
              padding: '8px 10px',
              cursor: 'pointer',
              fontSize: 12,
            }}
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
