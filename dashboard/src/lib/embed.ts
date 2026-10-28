// 포트폴리오 사이트 창 안에 들어갔을 때: 부모가 'pw:embed'를 보내면 문서 스크롤을 끄고(휠은 부모 페이지로 넘어감)
// 위치·길이를 알려 부모의 드래그 바가 'pw:scroll-to'로 위아래를 옮기게 한다. 단독으로 열면 아무것도 하지 않는다.
type Msg = { type?: string; top?: number }

export function listenEmbed() {
  if (window.parent === window) return
  let on = false
  const post = () =>
    window.parent.postMessage(
      { type: 'pw:scroll', top: window.scrollY, height: document.documentElement.scrollHeight, view: window.innerHeight },
      '*',
    )
  window.addEventListener('message', (e: MessageEvent<Msg>) => {
    if (e.source !== window.parent || !e.data || typeof e.data !== 'object') return
    if (e.data.type === 'pw:embed') {
      if (!on) {
        on = true
        document.documentElement.style.overflow = 'hidden'
        window.addEventListener('scroll', post, { passive: true })
        window.addEventListener('resize', post)
        new ResizeObserver(post).observe(document.body)
      }
      post()
    } else if (e.data.type === 'pw:scroll-to' && on) {
      window.scrollTo({ top: Number(e.data.top) || 0, behavior: 'instant' })
    }
  })
}
