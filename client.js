// Client half of dsh-gehc-plugin — a browser bundle (classic script).
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
    function HelloPill() {
      const [count, setCount] = React.useState(0)
      return React.createElement(
        'button',
        {
          onClick: () => setCount(count + 1),
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
        '👋 hello world ×' + count,
      )
    }

    function apply(ctx) {
      // `slots` arrives because the plugin declares inject below.
      const slots = ctx.slots
      ctx.effect(() => slots.inject('shell.overlay', () => slots.register(
        { name: 'shell.overlay', id: 'hello-pill' },
        () => React.createElement(HelloPill),
      )))
    }

    return { inject: ['slots'], apply }
  },
})
