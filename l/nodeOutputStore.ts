import { create } from "zustand";

let _seq = 0;

interface NodeOutputStore {
  outputs: Record<string, string>; // nodeId (or nodeId:handle) -> latest output text
  versions: Record<string, number>; // nodeId -> monotonic version counter
  setOutput: (key: string, output: string) => void;
  getOutput: (key: string) => string | undefined;
  getVersion: (key: string) => number;
  clearOutput: (key: string) => void;
  clearAll: () => void;
}

export const useNodeOutputStore = create<NodeOutputStore>((set, get) => ({
  outputs: {},
  versions: {},
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
  clearAll: () => {
    _seq = 0;
    set({ outputs: {}, versions: {} });
  },
}));
