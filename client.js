// Client half of dsh-hello-plugin — a browser bundle (classic script).
// The loader executes this as a script; the factory runs at materialization
// with a synchronous `require` bound to the platform module table (seed
// words: react, react/jsx-runtime, react-dom, @deepseek-ai/cordis, …).
// Registration id must equal the package name, the graph row id.
console.log('hello-plugin/client.js loaded')
window.__ModuleLoader__.load({
  id: 'dsh-hello-plugin',
  factory: (require) => {
    const React = require('react')

    // Minimal widget: a floating pill in the bottom-right overlay.
    // Clicking it calls the host via the /hello RPC channel; the host can
    // also push events back, delivered through a long-poll loop below.
    // `connection` is injected by slots.register below (see apply).
    function HelloPill({ connection }) {
      const [count, setCount] = React.useState(0)
      const [reply, setReply] = React.useState(null)
      // 宿主主动推送的事件列表（最新在前）
      const [events, setEvents] = React.useState([])

      const onClick = () => {
        setCount(count + 1)
        // Payload follows the Connection RPC envelope: { args: {...} }.
        connection.rpc
          .call('/hello', 'ping', { args: { name: 'browser' } })
          .then((result) => {
            if (result.ok) setReply(result.value)
            else setReply(`error: ${result.error.code}: ${result.error.message}`)
          })
          .catch((error) => setReply(`error: ${String(error)}`))
      }

      // 长轮询循环：反复拉取 /hello/events/poll。
      // 宿主有事件时立即返回，无事件时挂起 15 秒后返回空数组 ——
      // 收到空数组后立刻发起下一次请求，保持一个常驻的等待连接。
      React.useEffect(() => {
        let cancelled = false
        let inflight = false
        async function poll() {
          if (cancelled || inflight) return
          inflight = true
          try {
            const result = await connection.rpc.call('/hello', 'events/poll', { args: {} })
            // 无论有无事件，await 结束都要复位 inflight，否则循环只跑一轮。
            inflight = false
            if (!cancelled && result.ok && Array.isArray(result.value) && result.value.length > 0) {
              const incoming = result.value.map((item) => `${item.event}: ${item.args.join(' ')}`)
              setEvents((prev) => [...incoming.reverse(), ...prev].slice(0, 5))
            }
          } catch (error) {
            // 传输失败：稍作退避再试，避免热循环。
            inflight = false
            if (!cancelled) {
              setTimeout(poll, 3_000)
              return
            }
          }
          if (!cancelled) poll()
        }
        void poll()
        return () => { cancelled = true }
      }, [connection])

      return React.createElement(
        'div',
        {
          style: {
            position: 'fixed',
            right: '16px',
            bottom: '16px',
            zIndex: 1000,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-end',
            gap: '8px',
            fontFamily: 'system-ui, sans-serif',
          },
        },
        // 事件条：最新事件以呼吸样式显示，其余灰条。
        ...events.map((text, index) =>
          React.createElement('div', {
            key: text + index,
            style: {
              background: index === 0 ? 'rgba(79,124,255,0.12)' : 'rgba(0,0,0,0.06)',
              border: '1px solid rgba(79,124,255,0.35)',
              borderRadius: '8px',
              padding: '6px 10px',
              fontSize: '12px',
              color: index === 0 ? '#4f7cff' : '#6a7c99',
              maxWidth: '260px',
            },
          }, text),
        ),
        React.createElement(
          'button',
          {
            onClick,
            style: {
              border: 'none',
              borderRadius: '999px',
              padding: '8px 14px',
              fontSize: '13px',
              color: '#fff',
              background: '#4f7cff',
              cursor: 'pointer',
            },
          },
          reply === null
            ? '👋 hello world ×' + count
            : reply,
        ),
      )
    }

    function apply(ctx) {
      // `slots` arrives because the plugin declares inject below.
      const slots = ctx.slots
      // `connection` is passed to HelloPill through the register inject face,
      // which runs inside apply's closure and therefore can capture ctx.
      // The component is passed directly (not wrapped): the renderer spreads
      // the injected props onto it as `<HelloPill {...injected} />`.
      ctx.effect(() => slots.inject('shell.overlay', () => slots.register(
        { name: 'shell.overlay', id: 'hello-pill', inject: () => ({ connection: ctx.connection }) },
        HelloPill,
      )))
    }

    return { inject: ['slots', 'connection'], apply }
  },
})
