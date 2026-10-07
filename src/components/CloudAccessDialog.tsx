import { useState } from 'react'
import { LibraryDialog } from './LibraryDialogs'
import { cloudGeneration } from '../app/runtime'

export function CloudAccessDialog({ close }: { close: () => void }) {
  const [code, setCode] = useState('')
  return <LibraryDialog title="连接生成服务" close={close}>
    <p className="library-hint">输入为本次演示配置的访问码。它仅保留到 App 关闭，不会自动开始生成。</p>
    <form className="perfume-form" onSubmit={e => { e.preventDefault(); cloudGeneration.configureAccess(code); close() }}>
      <label>演示访问码<input type="password" required minLength={32} maxLength={256} autoComplete="off" value={code} onChange={e => setCode(e.target.value)} /></label>
      <button className="button">保存访问码</button>
    </form>
  </LibraryDialog>
}
