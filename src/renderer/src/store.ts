import { create } from 'zustand'  // <-- change this line

type State = {
  baseUrl: string
  paired: boolean
  deviceId: string
  branchId: number
  syncing: boolean
  set: (p: Partial<State>) => void
}

export const useApp = create<State>((set) => ({
  baseUrl: 'http://localhost:8000', // or your API
  paired: false,
  deviceId: '',
  branchId: 0,
  syncing: false,
  set: (p) => set(p),
}))
