import { create } from "zustand";

interface FrameStore {
  frames: Record<string, string>; // nodeId -> latest base64 frame
  setFrame: (nodeId: string, frame: string) => void;
  getFrame: (nodeId: string) => string | undefined;
  removeFrame: (nodeId: string) => void;
  clearAll: () => void;
}

export const useFrameStore = create<FrameStore>((set, get) => ({
  frames: {},
  setFrame: (nodeId, frame) =>
    set((state) => ({ frames: { ...state.frames, [nodeId]: frame } })),
  getFrame: (nodeId) => get().frames[nodeId],
  removeFrame: (nodeId) =>
    set((state) => {
      const { [nodeId]: _, ...rest } = state.frames;
      return { frames: rest };
    }),
  clearAll: () => set({ frames: {} }),
}));
