import * as React from 'react'
import type { JiraTodo } from '../types'
import { TodoItem } from './TodoItem'

interface TodoCardProps {
  todos: JiraTodo[] | null
  loading: boolean
  todosError: string | null
  onRefresh: () => void
  onItemClick: (todo: JiraTodo) => void
}

export function TodoCard({ todos, loading, todosError, onRefresh, onItemClick }: TodoCardProps): React.ReactElement {
  return React.createElement('div', {
    style: {
      background: 'rgba(255,255,255,0.96)', border: '1px solid rgba(0,0,0,0.12)',
      borderRadius: '10px', width: '300px', maxHeight: '360px', overflowY: 'auto',
      boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
    },
  },
  React.createElement('div', {
    style: {
      padding: '8px 10px', fontSize: '12px', fontWeight: 600, color: '#1e293b',
      borderBottom: '1px solid rgba(0,0,0,0.08)', display: 'flex',
      justifyContent: 'space-between', alignItems: 'center',
    },
  },
  '我的待办', loading ? '…' : todos !== null ? `(${todos.length})` : '',
  React.createElement('button', {
    onClick: onRefresh,
    title: '刷新待办',
    style: {
      border: 'none', background: 'transparent', cursor: 'pointer',
      fontSize: '14px', lineHeight: '1', padding: '2px 4px',
      color: '#6a7c99',
    },
  }, '⟳')),
  ...(todosError !== null
    ? [React.createElement('div', {
        key: 'jira-error',
        style: {
          background: 'rgba(214,69,64,0.1)', border: '1px solid rgba(214,69,64,0.35)',
          borderRadius: '8px', margin: '8px', padding: '6px 10px', fontSize: '12px',
          color: '#d64540',
        },
      }, `Jira: ${todosError}`)]
    : []),
  ...(todos !== null && todos.length === 0 && todosError === null
    ? [React.createElement('div', {
        key: 'jira-empty',
        style: { padding: '12px 10px', fontSize: '12px', color: '#6a7c99', textAlign: 'center' },
      }, '没有待办事项 🎉')]
    : []),
  ...(todos !== null ? todos.map((todo) => React.createElement(TodoItem, {
    key: todo.key,
    todo,
    onClick: () => onItemClick(todo),
  })) : []))
}
