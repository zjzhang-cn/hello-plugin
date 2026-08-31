import * as React from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'

interface JiraTodo {
  key: string
  summary: string
  typeName: string
  typeColor: string
  typeIconUrl: string
  statusName: string
}

interface HelloPillProps {
  connection: ConnectionHandle
}

function HelloPill({ connection }: HelloPillProps): React.ReactElement {
  const [count, setCount] = React.useState(0)
  const [reply, setReply] = React.useState<string | null>(null)
  const [todos, setTodos] = React.useState<JiraTodo[] | null>(null)
  const [todosError, setTodosError] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(false)

  const loadTodos = (): void => {
    if (loading) return
    setLoading(true)
    setTodosError(null)
    void connection.rpc
      .call('/hello', 'jira/todos', { args: {} })
      .then((result) => {
        if (result.ok) {
          setTodos(result.value as JiraTodo[])
        } else {
          setTodosError(`${result.error.code}: ${result.error.message}`)
        }
      })
      .catch((error: unknown) => setTodosError(String(error)))
      .finally(() => setLoading(false))
  }

  // 挂载后立即加载一次待办列表；点击按钮时也刷新。
  React.useEffect(() => {
    loadTodos()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection])

  const onClick = (): void => {
    setCount((currentCount) => currentCount + 1)
    void connection.rpc
      .call('/hello', 'ping', { args: { name: 'browser' } })
      .then((result) => {
        if (result.ok) setReply(String(result.value))
        else setReply(`error: ${result.error.code}: ${result.error.message}`)
      })
      .catch((error: unknown) => setReply(`error: ${String(error)}`))
    loadTodos()
  }

  // 待办列表主体：每项 = 类型徽章 + key + summary + 状态。
  const todoList = todos === null
    ? []
    : todos.map((todo) => React.createElement('div', {
        key: todo.key,
        style: {
          display: 'flex', alignItems: 'center', gap: '8px',
          padding: '6px 8px', borderBottom: '1px solid rgba(0,0,0,0.06)',
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
      }, `${todo.key}${todo.statusName !== '' ? ' · ' + todo.statusName : ''}`))))

  return React.createElement(
    'div',
    {
      style: {
        position: 'fixed', right: '16px', bottom: '16px', zIndex: 1000,
        display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px',
        fontFamily: 'system-ui, sans-serif',
      },
    },
    // 待办列表卡片
    React.createElement('div', {
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
    }, '我的待办', loading ? '…' : todos !== null ? `(${todos.length})` : ''),
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
    ...(todos !== null ? todoList : [])),
    React.createElement('button', {
      onClick,
      style: {
        border: 'none', borderRadius: '999px', padding: '8px 14px', fontSize: '13px',
        color: '#fff', background: '#4f7cff', cursor: 'pointer',
      },
    }, reply === null ? `hello world x${count}` : reply),
  )
}

export const inject = ['slots', 'connection']

export function apply(ctx: Context): void {
  const connection = ctx.get('connection') as ConnectionHandle
  ctx.effect(() => ctx.slots.inject('shell.overlay', () => ctx.slots.register(
    { name: 'shell.overlay', id: 'hello-pill', inject: () => ({ connection }) },
    HelloPill,
  )))
}
