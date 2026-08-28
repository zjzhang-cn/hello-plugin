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
    // Clicking it calls the host via the /hello RPC channel.
    // `connection` is injected by slots.register below (see apply).
    function HelloPill({ connection }) {
      const [count, setCount] = React.useState(0)
      const [reply, setReply] = React.useState(null)

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

      return React.createElement(
        'button',
        {
          onClick,
          style: {
            position: 'fixed',
            right: '16px',
            bottom: '16px',
            zIndex: 1000,
            border: 'none',
            borderRadius: '999px',
            padding: '8px 14px',
            fontSize: '13px',
            color: '#fff',
            background: '#4f7cff',
            cursor: 'pointer',
            fontFamily: 'system-ui, sans-serif',
          },
        },
        reply === null
          ? '👋 hello world ×' + count
          : reply,
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
