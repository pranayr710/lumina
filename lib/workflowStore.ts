import { create } from "zustand";
import type { Node, Edge } from "reactflow";

export interface SavedWorkflow {
  id: string;
  name: string;
  nodes: Node[];
  edges: Edge[];
  createdAt: number;
  updatedAt: number;
}

interface WorkflowStore {
  workflows: SavedWorkflow[];
  activeWorkflowId: string | null;
  /** Load workflows + activeWorkflowId from localStorage. */
  loadFromStorage: () => void;
  /** Create a new workflow, make it active, persist. Returns the id. */
  createWorkflow: (name: string, nodes: Node[], edges: Edge[]) => string;
  /** Autosave nodes/edges into the active workflow. */
  autosave: (nodes: Node[], edges: Edge[]) => void;
  /** Switch active workflow by id. */
  setActiveWorkflowId: (id: string) => void;
  /** Delete a workflow. Returns the id of the next workflow to activate (or null). */
  deleteWorkflow: (id: string) => string | null;
  /** Rename a workflow. */
  renameWorkflow: (id: string, name: string) => void;
  /** Wipe everything and start fresh. */
  nuclearReset: (name: string, nodes: Node[], edges: Edge[]) => string;
}

const STORAGE_KEY = "lumina-workflows";
const ACTIVE_KEY = "lumina-active-workflow";

function persist(workflows: SavedWorkflow[], activeId: string | null) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(workflows));
    if (activeId) localStorage.setItem(ACTIVE_KEY, activeId);
    else localStorage.removeItem(ACTIVE_KEY);
  } catch {
    // quota / unavailable
  }
}

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

function makeId(): string {
  return `wf-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

/** Migrate old "action" nodes to the new split action node types. */
function migrateWorkflows(workflows: SavedWorkflow[]): SavedWorkflow[] {
  const actionTypeMap: Record<string, string> = {
    sound: "soundAction",
    log: "logAction",
    notification: "notifyAction",
    webhook: "webhookAction",
  };
  let changed = false;
  const migrated = workflows.map((wf) => {
    const newNodes = wf.nodes.map((n) => {
      if (n.type === "action") {
        changed = true;
        const newType = actionTypeMap[n.data?.actionType] || "logAction";
        return { ...n, type: newType };
      }
      return n;
    });
    // Migrate whisperStt handle from 'text' to 'output'
    const newEdges = wf.edges.map((e) => {
      const sourceNode = wf.nodes.find(n => n.id === e.source);
      if (sourceNode?.type === "whisperStt" && e.sourceHandle === "text") {
        changed = true;
        return { ...e, sourceHandle: "output" };
      }
      return e;
    });
    return changed ? { ...wf, nodes: newNodes, edges: newEdges } : wf;
  });
  return migrated;
}

export const useWorkflowStore = create<WorkflowStore>((set, get) => ({
  workflows: [],
  activeWorkflowId: null,

  loadFromStorage: () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const activeId = localStorage.getItem(ACTIVE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as SavedWorkflow[];
        const migrated = migrateWorkflows(parsed);
        // Sanitize: ensure every node has a valid position
        const sanitized = migrated.map((wf) => ({
          ...wf,
          nodes: wf.nodes.map((n, idx) => ({
            ...n,
            position: {
              x: n.position?.x ?? 250,
              y: n.position?.y ?? (100 + idx * 120),
            },
          })),
        }));
        set({ workflows: sanitized, activeWorkflowId: activeId || sanitized[0]?.id || null });
        // Persist sanitized data
        persist(sanitized, activeId || sanitized[0]?.id || null);
      }
    } catch {
      // corrupt data
    }
  },

  createWorkflow: (name, nodes, edges) => {
    const id = makeId();
    const now = Date.now();
    const wf: SavedWorkflow = {
      id,
      name,
      nodes: deepClone(nodes),
      edges: deepClone(edges),
      createdAt: now,
      updatedAt: now,
    };
    const updated = [...get().workflows, wf];
    set({ workflows: updated, activeWorkflowId: id });
    persist(updated, id);
    return id;
  },

  autosave: (nodes, edges) => {
    const { activeWorkflowId, workflows } = get();
    if (!activeWorkflowId) return;
    const updated = workflows.map((wf) =>
      wf.id === activeWorkflowId
        ? { ...wf, nodes: deepClone(nodes), edges: deepClone(edges), updatedAt: Date.now() }
        : wf
    );
    set({ workflows: updated });
    persist(updated, activeWorkflowId);
  },

  setActiveWorkflowId: (id) => {
    set({ activeWorkflowId: id });
    try {
      localStorage.setItem(ACTIVE_KEY, id);
    } catch {}
  },

  deleteWorkflow: (id) => {
    const { workflows, activeWorkflowId } = get();
    const updated = workflows.filter((wf) => wf.id !== id);
    let nextId: string | null = null;
    if (activeWorkflowId === id) {
      nextId = updated[0]?.id || null;
    } else {
      nextId = activeWorkflowId;
    }
    set({ workflows: updated, activeWorkflowId: nextId });
    persist(updated, nextId);
    return nextId;
  },

  renameWorkflow: (id, name) => {
    const updated = get().workflows.map((wf) =>
      wf.id === id ? { ...wf, name, updatedAt: Date.now() } : wf
    );
    set({ workflows: updated });
    persist(updated, get().activeWorkflowId);
  },
  nuclearReset: (name: string, nodes: Node[], edges: Edge[]) => {
    const id = makeId();
    const now = Date.now();
    const wf: SavedWorkflow = {
      id,
      name,
      nodes: deepClone(nodes),
      edges: deepClone(edges),
      createdAt: now,
      updatedAt: now,
    };
    set({ workflows: [wf], activeWorkflowId: id });
    persist([wf], id);
    return id;
  },
}));
