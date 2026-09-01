import * as React from 'react'

interface PanelProps {
  children: React.ReactNode
}

export function Panel({ children }: PanelProps): React.ReactElement {
  return React.createElement('div', {
    style: {
      background: 'rgba(255,255,255,0.98)',
      border: '1px solid rgba(0,0,0,0.12)',
      borderRadius: '12px',
      padding: '12px',
      boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      maxHeight: '80vh',
      overflowY: 'auto',
    },
  }, children)
}
