import * as React from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'

interface HelloEvent {
  event: string
  args: unknown[]
}

interface JiraTodo {
  key: string
  summary: string
  typeName: string
  typeColor: string
  typeIconUrl: string
  statusName: string
}

/** host 分析一个 issue 后返回的内容。 */
interface JiraAnalysis {
  key: string
  summary: string
  analysis: string
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
  const [events, setEvents] = React.useState<string[]>([])
  const replyTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const clickSeqRef = React.useRef(0)
  const [analysis, setAnalysis] = React.useState<JiraAnalysis | null>(null)
  const [analysisLoading, setAnalysisLoading] = React.useState(false)
  const [analysisError, setAnalysisError] = React.useState<string | null>(null)
  const [commentState, setCommentState] = React.useState<'idle' | 'submitting' | 'added' | 'error'>('idle')
  const [commentError, setCommentError] = React.useState<string | null>(null)
  // Google 新闻会话：点击「📰」后宿主创建新会话，Agent 获取新闻并总结。
  const [newsSession, setNewsSession] = React.useState<string | null>(null)
  const [newsLoading, setNewsLoading] = React.useState(false)
  const [newsError, setNewsError] = React.useState<string | null>(null)

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

  // 点击待办项：调 host 让 LLM 分析该 issue，展示回答。
  const analyzeTodo = (todo: JiraTodo): void => {
    if (analysisLoading) return
    setAnalysisLoading(true)
    setAnalysisError(null)
    setAnalysis(null)
    setCommentState('idle')
    setCommentError(null)
    void connection.rpc
      .call('/hello', 'jira/analyze', { args: { key: todo.key } })
      .then((result) => {
        if (result.ok) setAnalysis(result.value as JiraAnalysis)
        else setAnalysisError(`${result.error.code}: ${result.error.message}`)
      })
      .catch((error: unknown) => setAnalysisError(String(error)))
      .finally(() => setAnalysisLoading(false))
  }

  // 用户同意：把分析文本写入 Jira 评论。
  const addComment = (): void => {
    if (analysis === null || commentState === 'submitting') return
    setCommentState('submitting')
    setCommentError(null)
    void connection.rpc
      .call('/hello', 'jira/comment', { args: { key: analysis.key, text: analysis.analysis } })
      .then((result) => {
        if (result.ok) setCommentState('added')
        else {
          setCommentState('error')
          setCommentError(`${result.error.code}: ${result.error.message}`)
        }
      })
      .catch((error: unknown) => {
        setCommentState('error')
        setCommentError(String(error))
      })
  }

  const cancelAnalysis = (): void => {
    setAnalysis(null)
    setCommentState('idle')
    setCommentError(null)
  }

  // 点击「📰」：让宿主创建新会话，Agent 获取最新 Google 新闻并总结。
  // 新会话会出现在 dsh Web UI 的会话列表，可点开查看完整 LLM 交互。
  const startNewsSession = (): void => {
    if (newsLoading) return
    setNewsLoading(true)
    setNewsError(null)
    void connection.rpc
      .call('/hello', 'news/start', { args: {} })
      .then((result) => {
        if (result.ok) setNewsSession((result.value as { sessionId: string }).sessionId)
        else setNewsError(`${result.error.code}: ${result.error.message}`)
      })
      .catch((error: unknown) => setNewsError(String(error)))
      .finally(() => setNewsLoading(false))
  }

  // 挂载后立即加载一次待办列表；点击按钮时也刷新。
  React.useEffect(() => {
    loadTodos()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection])

  // 长轮询：常驻一个 poll 连接接收宿主推送的事件，渲染为按钮上方气泡条。
  React.useEffect(() => {
    let cancelled = false
    let inflight = false
    async function poll(): Promise<void> {
      if (cancelled || inflight) return
      inflight = true
      try {
        const result = await connection.rpc.call('/hello', 'events/poll', { args: {} })
        inflight = false
        if (!cancelled && result.ok && Array.isArray(result.value)) {
          const incoming = (result.value as HelloEvent[]).map((item) => `${item.event}: ${item.args.join(' ')}`)
          if (incoming.length > 0) setEvents([incoming[incoming.length - 1] ?? ''])
        }
      } catch {
        inflight = false
        if (!cancelled) {
          setTimeout(poll, 3_000)
          return
        }
      }
      if (!cancelled) void poll()
    }
    void poll()
    return () => { cancelled = true }
  }, [connection])

  // 清理上一次的恢复定时器，避免连续点击叠加。
  const clearReplyTimer = (): void => {
    if (replyTimerRef.current !== null) {
      clearTimeout(replyTimerRef.current)
      replyTimerRef.current = null
    }
  }

  // 组件卸载时清理定时器。
  React.useEffect(() => () => { clearReplyTimer() }, [])

  const onClick = (): void => {
    const seq = ++clickSeqRef.current
    clearReplyTimer()
    setReply('…')
    void connection.rpc
      .call('/hello', 'ping', { args: { name: 'browser' } })
      .then((result) => {
        if (seq !== clickSeqRef.current) return // 已被更新的点击取代
        if (result.ok) setReply(String(result.value))
        else setReply(`error: ${result.error.code}: ${result.error.message}`)
      })
      .catch((error: unknown) => {
        if (seq !== clickSeqRef.current) return
        setReply(`error: ${String(error)}`)
      })
      .finally(() => {
        if (seq !== clickSeqRef.current) return // 只让最后一次点击生效
        // host 回复 pong（或出错）后 1 秒恢复 hello 样式，次数 +1
        replyTimerRef.current = setTimeout(() => {
          setReply(null)
          setCount((currentCount) => currentCount + 1)
          replyTimerRef.current = null
        }, 1_000)
      })
    loadTodos()
  }

  // 待办列表主体：每项 = 类型徽章 + key + summary + 状态；点击触发 LLM 分析。
  const todoList = todos === null
    ? []
    : todos.map((todo) => React.createElement('div', {
        key: todo.key,
        onClick: () => analyzeTodo(todo),
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
    },
    '我的待办', loading ? '…' : todos !== null ? `(${todos.length})` : '',
    React.createElement('button', {
      onClick: loadTodos,
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
    ...(todos !== null ? todoList : [])),
    // LLM 分析面板（点击待办项后出现）
    ...(analysisLoading
      ? [React.createElement('div', {
          key: 'analysis-loading',
          style: {
            background: 'rgba(255,255,255,0.96)', border: '1px solid rgba(0,0,0,0.12)',
            borderRadius: '10px', width: '300px', padding: '10px 12px', fontSize: '12px',
            color: '#6a7c99',
          },
        }, 'LLM 正在分析…')]
      : []),
    ...(analysisError !== null
      ? [React.createElement('div', {
          key: 'analysis-error',
          style: {
            background: 'rgba(214,69,64,0.1)', border: '1px solid rgba(214,69,64,0.35)',
            borderRadius: '10px', width: '300px', padding: '10px 12px', fontSize: '12px',
            color: '#d64540',
          },
        }, `分析失败：${analysisError}`)]
      : []),
    ...(analysis !== null
      ? [React.createElement('div', {
          key: 'analysis-panel',
          style: {
            background: 'rgba(255,255,255,0.96)', border: '1px solid rgba(79,124,255,0.4)',
            borderRadius: '10px', width: '300px', padding: '10px 12px',
            boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
          },
        },
        React.createElement('div', {
          style: { fontSize: '12px', fontWeight: 600, color: '#1e293b', marginBottom: '4px' },
        }, `${analysis.key} · ${analysis.summary}`),
        React.createElement('div', {
          style: {
            fontSize: '12px', color: '#334155', maxHeight: '180px', overflowY: 'auto',
            whiteSpace: 'pre-wrap', marginBottom: '8px',
          },
        }, analysis.analysis),
        commentState === 'added'
          ? React.createElement('div', {
              style: { fontSize: '12px', color: '#16825d' },
            }, '✅ 已添加到 Jira 评论')
          : React.createElement('div', {
              style: { display: 'flex', gap: '8px', justifyContent: 'flex-end' },
            },
          React.createElement('button', {
            onClick: cancelAnalysis,
            disabled: commentState === 'submitting',
            style: {
              border: '1px solid rgba(0,0,0,0.15)', borderRadius: '6px', padding: '4px 10px',
              fontSize: '12px', background: 'transparent', color: '#475569', cursor: 'pointer',
            },
          }, '取消'),
          React.createElement('button', {
            onClick: addComment,
            disabled: commentState === 'submitting',
            style: {
              border: 'none', borderRadius: '6px', padding: '4px 10px',
              fontSize: '12px', color: '#fff', background: '#4f7cff', cursor: 'pointer',
            },
          }, commentState === 'submitting' ? '添加中…' : '添加到评论')),
        ...(commentState === 'error'
          ? [React.createElement('div', {
              key: 'comment-error',
              style: { fontSize: '12px', color: '#d64540', marginTop: '6px' },
            }, `评论失败：${commentError}`)]
          : []))]
      : []),
    ...events.map((text, index) => React.createElement('div', {
      key: text + index,
      style: {
        background: index === 0 ? 'rgba(79,124,255,0.12)' : 'rgba(0,0,0,0.06)',
        border: '1px solid rgba(79,124,255,0.35)', borderRadius: '8px', padding: '6px 10px',
        fontSize: '12px', color: index === 0 ? '#4f7cff' : '#6a7c99', maxWidth: '260px',
      },
    }, text)),
    // 独立的 Google 新闻入口：按钮 + 状态提示条（不依附待办卡片）。
    ...(newsError !== null
      ? [React.createElement('div', {
          key: 'news-error',
          style: {
            background: 'rgba(214,69,64,0.1)', border: '1px solid rgba(214,69,64,0.35)',
            borderRadius: '8px', padding: '6px 10px', fontSize: '12px', maxWidth: '300px',
            color: '#d64540',
          },
        }, `Google 新闻：${newsError}`)]
      : []),
    ...(newsSession !== null
      ? [React.createElement('div', {
          key: 'news-session',
          style: {
            background: 'rgba(22,130,93,0.08)', border: '1px solid rgba(22,130,93,0.35)',
            borderRadius: '8px', padding: '6px 10px', fontSize: '12px', maxWidth: '300px',
            color: '#16825d',
          },
        }, `✅ 已创建会话 ${newsSession}，在会话列表查看 Agent 总结`)]
      : []),
    React.createElement('div', {
      style: { display: 'flex', gap: '8px', alignItems: 'center' },
    },
    React.createElement('button', {
      onClick: startNewsSession,
      disabled: newsLoading,
      title: '获取 Google 最新新闻并总结（新会话）',
      style: {
        border: 'none', borderRadius: '999px', padding: '8px 14px', fontSize: '13px',
        color: '#fff', background: newsLoading ? '#0e7a8c' : '#0e93ab', cursor: 'pointer',
      },
    }, newsLoading ? '获取中…' : '📰 获取新闻'),
    React.createElement('button', {
      onClick,
      style: {
        border: 'none', borderRadius: '999px', padding: '8px 14px', fontSize: '13px',
        color: '#fff', background: '#4f7cff', cursor: 'pointer',
      },
    }, reply === null ? `hello world x${count}` : reply)),
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
