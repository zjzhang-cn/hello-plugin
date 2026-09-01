import * as React from 'react'

interface HelloButtonProps {
  reply: string | null
  count: number
  onClick: () => void
}

export function HelloButton({ reply, count, onClick }: HelloButtonProps): React.ReactElement {
  return React.createElement('button', {
    onClick,
    style: {
      border: 'none', borderRadius: '999px', padding: '8px 14px', fontSize: '13px',
      color: '#fff', background: '#4f7cff', cursor: 'pointer',
    },
  }, reply === null ? `hello world x${count}` : reply)
}
