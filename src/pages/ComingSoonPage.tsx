import { BrandMark } from '../components/BrandMark'
import { BackLink, ButtonLink } from '../components/ui'

export function NotFoundPage() {
  return <main className="screen pending-screen" id="main-content">
    <header className="secondary-header"><BackLink /></header>
    <section className="pending-content">
      <BrandMark /><h1 tabIndex={-1}>这一页还没有气味</h1>
      <p className="pending-description">页面不存在，回到首页开始探索吧。</p>
      <ButtonLink to="/home" replace>返回首页</ButtonLink>
    </section>
  </main>
}
