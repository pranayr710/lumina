import { create } from "zustand";

interface PipelineControlStore {
  isRunning: boolean;
  start: () => void;
  stop: () => void;
  toggle: () => void;
}

export const usePipelineControlStore = create<PipelineControlStore>((set, get) => ({
  isRunning: false,
  start: () => set({ isRunning: true }),
  stop: () => set({ isRunning: false }),
  toggle: () => set({ isRunning: !get().isRunning }),
}));
