import { create } from "zustand";
import type { Node, Edge } from "reactflow";

interface Snapshot { nodes: Node[]; edges: Edge[] }

interface HistoryStore {
  stack: Snapshot[];
  index: number;
  push: (nodes: Node[], edges: Edge[]) => void;
  undo: () => Snapshot | null;
  redo: () => Snapshot | null;
  canUndo: () => boolean;
  canRedo: () => boolean;
  clear: () => void;
}

const MAX = 60;
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

export const useHistoryStore = create<HistoryStore>((set, get) => ({
  stack: [],
  index: -1,

  push: (nodes, edges) => {
    const { stack, index } = get();
    const trimmed = stack.slice(0, index + 1);
    trimmed.push({ nodes: clone(nodes), edges: clone(edges) });
    if (trimmed.length > MAX) trimmed.shift();
    set({ stack: trimmed, index: trimmed.length - 1 });
  },

  undo: () => {
    const { stack, index } = get();
    if (index <= 0) return null;
    const next = index - 1;
    set({ index: next });
    return stack[next];
  },

  redo: () => {
    const { stack, index } = get();
    if (index >= stack.length - 1) return null;
    const next = index + 1;
    set({ index: next });
    return stack[next];
  },

  canUndo: () => get().index > 0,
  canRedo: () => get().index < get().stack.length - 1,
  clear: () => set({ stack: [], index: -1 }),
}));
