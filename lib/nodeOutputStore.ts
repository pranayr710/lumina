import { create } from "zustand";

let _seq = 0;

interface NodeOutputStore {
  outputs: Record<string, string>;
  versions: Record<string, number>;
  errors: Record<string, string>;
  setOutput: (key: string, output: string) => void;
  getOutput: (key: string) => string | undefined;
  getVersion: (key: string) => number;
  clearOutput: (key: string) => void;
  setError: (nodeId: string, error: string) => void;
  clearError: (nodeId: string) => void;
  getError: (nodeId: string) => string | undefined;
  clearAll: () => void;
}

export const useNodeOutputStore = create<NodeOutputStore>((set, get) => ({
  outputs: {},
  versions: {},
  errors: {},

  setOutput: (key, output) =>
    set((state) => ({
      outputs: { ...state.outputs, [key]: output },
      versions: { ...state.versions, [key]: ++_seq },
    })),

  getOutput: (key) => get().outputs[key],
  getVersion: (key) => get().versions[key] ?? 0,

  clearOutput: (key) =>
    set((state) => {
      const { [key]: _o, ...restOutputs } = state.outputs;
      const { [key]: _v, ...restVersions } = state.versions;
      return { outputs: restOutputs, versions: restVersions };
    }),

  setError: (nodeId, error) =>
    set((state) => ({ errors: { ...state.errors, [nodeId]: error } })),

  clearError: (nodeId) =>
    set((state) => {
      const { [nodeId]: _, ...rest } = state.errors;
      return { errors: rest };
    }),

  getError: (nodeId) => get().errors[nodeId],

  clearAll: () => {
    _seq = 0;
    set({ outputs: {}, versions: {}, errors: {} });
  },
}));
