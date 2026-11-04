import { create } from "zustand";

interface AudioStore {
  audio: Record<string, string>; // nodeId -> latest base64 PCM chunk
  setAudio: (nodeId: string, base64: string) => void;
  getAudio: (nodeId: string) => string | undefined;
  removeAudio: (nodeId: string) => void;
  clearAll: () => void;
}

export const useAudioStore = create<AudioStore>((set, get) => ({
  audio: {},
  setAudio: (nodeId, base64) =>
    set((state) => ({ audio: { ...state.audio, [nodeId]: base64 } })),
  getAudio: (nodeId) => get().audio[nodeId],
  removeAudio: (nodeId) =>
    set((state) => {
      const { [nodeId]: _, ...rest } = state.audio;
      return { audio: rest };
    }),
  clearAll: () => set({ audio: {} }),
}));
