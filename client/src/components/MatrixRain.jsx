import { useEffect, useRef } from 'react'

// The falling-code background of Matrix mode: columns of half-width katakana
// and digits dropping down a full-screen canvas, each frame drawn over a
// translucent black so older glyphs fade into trails. Throttled to ~20 fps,
// paused while the tab is hidden, and a single still frame when the system
// asks for reduced motion.
const RAIN_GLYPHS = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789:.=*+-<>¦'
const RAIN_SIZE = 16 // px per glyph cell
const RAIN_FPS = 20

export function MatrixRain() {
  const ref = useRef(null)
  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas.getContext('2d')
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let drops = []
    let frame = 0
    let last = 0

    function resize() {
      const dpr = window.devicePixelRatio || 1
      canvas.width = window.innerWidth * dpr
      canvas.height = window.innerHeight * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, window.innerWidth, window.innerHeight)
      const rows = Math.ceil(window.innerHeight / RAIN_SIZE)
      // Start each column at a random height so the rain doesn't begin as
      // one flat line.
      drops = Array.from({ length: Math.ceil(window.innerWidth / RAIN_SIZE) }, () =>
        Math.floor(Math.random() * -rows),
      )
      if (still) for (let i = 0; i < 40; i++) draw()
    }

    function draw() {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.08)'
      ctx.fillRect(0, 0, window.innerWidth, window.innerHeight)
      ctx.font = `${RAIN_SIZE}px ui-monospace, monospace`
      const rows = window.innerHeight / RAIN_SIZE
      drops.forEach((y, i) => {
        const ch = RAIN_GLYPHS[Math.floor(Math.random() * RAIN_GLYPHS.length)]
        // The leading glyph is near-white; the trail behind it is green.
        ctx.fillStyle = Math.random() < 0.1 ? '#d6ffe0' : '#00ff41'
        ctx.fillText(ch, i * RAIN_SIZE, y * RAIN_SIZE)
        drops[i] = y > rows && Math.random() > 0.975 ? 0 : y + 1
      })
    }

    function loop(t) {
      frame = requestAnimationFrame(loop)
      if (document.hidden || t - last < 1000 / RAIN_FPS) return
      last = t
      draw()
    }

    resize()
    window.addEventListener('resize', resize)
    if (!still) frame = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', resize)
    }
  }, [])
  return <canvas ref={ref} className="matrix-rain" aria-hidden="true" />
}
