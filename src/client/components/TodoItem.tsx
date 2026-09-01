import * as React from 'react'
import type { JiraTodo } from '../types'

interface TodoItemProps {
  todo: JiraTodo
  onClick: () => void
}

export function TodoItem({ todo, onClick }: TodoItemProps): React.ReactElement {
  return React.createElement('div', {
    key: todo.key,
    onClick,
    title: '点击让 LLM 分析此 issue',
    style: {
      display: 'flex', alignItems: 'center', gap: '8px',
      padding: '6px 8px', borderBottom: '1px solid rgba(0,0,0,0.06)',
      cursor: 'pointer',
    },
  },
  React.createElement('span', {
    title: todo.typeName,
    style: {
      display: 'inline-flex', alignItems: 'center', gap: '4px',
      background: 'rgba(0,0,0,0.06)', border: '1px solid rgba(0,0,0,0.12)',
      borderRadius: '999px', padding: '2px 7px', fontSize: '11px',
      color: '#475569', whiteSpace: 'nowrap', flexShrink: 0,
    },
  },
  todo.typeIconUrl !== ''
    ? React.createElement('img', {
        src: todo.typeIconUrl,
        alt: '',
        style: { width: '12px', height: '12px', objectFit: 'contain' },
      })
    : React.createElement('span', {
        style: {
          width: '8px', height: '8px', borderRadius: '50%',
          background: todo.typeColor, flexShrink: 0,
        },
      }),
  todo.typeName),
  React.createElement('div', {
    style: { display: 'flex', flexDirection: 'column', minWidth: '0', flex: '1' },
  },
  React.createElement('div', {
    style: { fontSize: '12px', color: '#334155', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  }, todo.summary === '' ? todo.key : todo.summary),
  React.createElement('div', {
    style: { fontSize: '11px', color: '#6a7c99', marginTop: '1px' },
  }, `${todo.key}${todo.statusName !== '' ? ' · ' + todo.statusName : ''}`)))
}
