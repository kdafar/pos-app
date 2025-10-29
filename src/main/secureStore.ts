// src/main/secureStore.ts
import { app } from 'electron'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'

const requirekey = createRequire(import.meta.url)
let keytarMod: any = null
try { keytarMod = requirekey('keytar') } catch { keytarMod = null }
const KT = () => (keytarMod?.default ?? keytarMod) || null

const SERVICE = 'pos-app'
const FALLBACK = path.join(app.getPath('userData'), 'secrets.json')

const read = () => { try { return JSON.parse(fs.readFileSync(FALLBACK,'utf8')) } catch { return {} } }
const write = (o:any) => { fs.mkdirSync(path.dirname(FALLBACK), { recursive:true }); fs.writeFileSync(FALLBACK, JSON.stringify(o)) }

export async function saveSecret(key: string, secret: string) {
  if (!key) return
  const k = KT()
  if (k?.setPassword) return k.setPassword(SERVICE, key, secret)
  const o = read(); o[key] = secret; write(o)
}

export async function loadSecret(key: string) {
  if (!key) return null
  const k = KT()
  if (k?.getPassword) return k.getPassword(SERVICE, key)
  const o = read(); return o[key] ?? null
}

export async function deleteSecret(key: string) {
  if (!key) return false
  const k = KT()
  if (k?.deletePassword) return k.deletePassword(SERVICE, key)
  const o = read(); delete o[key]; write(o); return true
}
