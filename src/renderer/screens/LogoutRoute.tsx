// src/renderer/screens/LogoutRoute.tsx
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

export function LogoutRoute() {
  const nav = useNavigate()
  useEffect(() => {
    (async () => {
      try { await window.pos.auth.logout() } catch {}
      nav('/login', { replace: true })
    })()
  }, [])
  return <div className="p-6 text-muted-foreground">Signing out…</div>
}
