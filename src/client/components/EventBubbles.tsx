import * as React from 'react'

interface EventBubblesProps {
  events: string[]
}

export function EventBubbles({ events }: EventBubblesProps): React.ReactElement {
  return React.createElement(React.Fragment, null,
    ...events.map((text, index) => React.createElement('div', {
      key: text + index,
      style: {
        background: index === 0 ? 'rgba(79,124,255,0.12)' : 'rgba(0,0,0,0.06)',
        border: '1px solid rgba(79,124,255,0.35)', borderRadius: '8px', padding: '6px 10px',
        fontSize: '12px', color: index === 0 ? '#4f7cff' : '#6a7c99', maxWidth: '260px',
      },
    }, text)),
  )
}
