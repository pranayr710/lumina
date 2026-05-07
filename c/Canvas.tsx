"use client";

import React, { useCallback, useRef, useState, useEffect, useMemo } from "react";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  type Connection,
  type Edge,
  type Node,
  type ReactFlowInstance,
  BackgroundVariant,
} from "reactflow";
import "reactflow/dist/style.css";
import { FolderOpen, ChevronLeft, GitBranch, Sparkles, X, LayoutDashboard, HelpCircle, BookOpen } from "lucide-react";
import Sidebar from "./Sidebar";
import WorkflowPanel from "./WorkflowPanel";
import { NODE_TYPES } from "@/l/reactFlowTypes";
import PreviewOverlay from "./PreviewOverlay";
import AiChat from "./AiChat";
import VaultSettings from "./VaultSettings";
import { pipelineSocket } from "@/l/websocket";
import { useWorkflowStore, type SavedWorkflow } from "@/l/workflowStore";
import { useFrameStore } from "@/l/frameStore";
import { useAudioStore } from "@/l/audioStore";
import { useNodeOutputStore } from "@/l/nodeOutputStore";
import { useTelemetryStore } from "@/l/telemetryStore";
import TelemetryHud from "./TelemetryHud";
import {
  prepareSwitch,
  completeSwitch,
  destroyWorkflowCaptures,
} from "@/l/captureRegistry";

const VALID_NODE_TYPES = new Set<string>(Object.keys(NODE_TYPES));

const defaultNodes: Node[] = [
  {
    id: "camera-1",
    type: "camera",
    position: { x: 50, y: 200 },
    data: {},
  },
  {
    id: "detect-1",
    type: "detection",
    position: { x: 480, y: 180 },
    data: { confidence: 45, interval: 2 },
  },
  {
    id: "vlm-1",
    type: "visualLlm",
    position: { x: 900, y: 100 },
    data: {
      prompt:
        "Describe any safety concerns you see. Mention if anyone is not wearing required safety gear.",
      interval: 10,
    },
  },
  {
    id: "logic-1",
    type: "logic",
    position: { x: 1400, y: 180 },
    data: {
      conditions: [
        { id: "1", operator: "contains", value: "danger" },
        { id: "2", operator: "contains", value: "hazard" },
        { id: "3", operator: "contains", value: "unsafe" },
      ],
      mode: "any",
    },
  },
  {
    id: "log-1",
    type: "logAction",
    position: { x: 1880, y: 200 },
    data: {},
  },
];

const defaultEdges: Edge[] = [
  {
    id: "e-camera-detect",
    source: "camera-1",
    sourceHandle: "camera",
    target: "detect-1",
    targetHandle: "camera",
    animated: true,
    style: { stroke: "rgba(66, 133, 244, 0.4)" },
  },
  {
    id: "e-camera-vlm",
    source: "camera-1",
    sourceHandle: "camera",
    target: "vlm-1",
    targetHandle: "camera",
    animated: true,
    style: { stroke: "rgba(66, 133, 244, 0.4)" },
  },
  {
    id: "e-detect-vlm",
    source: "detect-1",
    sourceHandle: "match",
    target: "vlm-1",
    targetHandle: "trigger",
    animated: true,
    style: { stroke: "rgba(52, 168, 83, 0.4)" },
  },
  {
    id: "e-vlm-logic",
    source: "vlm-1",
    sourceHandle: "response",
    target: "logic-1",
    targetHandle: "input",
    animated: true,
    style: { stroke: "rgba(168, 85, 247, 0.4)" },
  },
  {
    id: "e-logic-action",
    source: "logic-1",
    sourceHandle: "match",
    target: "log-1",
    targetHandle: "trigger",
    animated: true,
    style: { stroke: "#4285F4", strokeWidth: 2 },
  },
];

let nodeId = 100;
const getNewId = () => `node-${nodeId++}`;

/** Reset nodeId counter above max numeric ID found in nodes */
function syncNodeIdCounter(nodes: Node[]) {
  const maxId = nodes.reduce((max, n) => {
    const match = n.id.match(/(\d+)/);
    return match ? Math.max(max, parseInt(match[1], 10)) : max;
  }, 0);
  nodeId = Math.max(nodeId, maxId + 1);
}

export default function Canvas() {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [reactFlowInstance, setReactFlowInstance] =
    useState<ReactFlowInstance | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChangeOriginal] = useEdgesState([]);
  
  const onEdgesChange = useCallback((changes: any) => {
    console.log("Edge Changes Detected:", changes);
    onEdgesChangeOriginal(changes);
  }, [onEdgesChangeOriginal]);
  
  const [backendConnected, setBackendConnected] = useState(false);
  const [workflowInput, setWorkflowInput] = useState("");
  const [generateLoading, setGenerateLoading] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [workflowPanelOpen, setWorkflowPanelOpen] = useState(false);
  const [vaultOpen, setVaultOpen] = useState(false);
  const [aiChatOpen, setAiChatOpen] = useState(false);
  const [docsOpen, setDocsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    (window as any).toggleVault = () => setVaultOpen((v) => !v);
    return () => { delete (window as any).toggleVault; };
  }, []);
  
  const [isDashboard, setIsDashboard] = useState(false);
  const [pinnedNodes, setPinnedNodes] = useState<{id: string, label: string}[]>([]);

  const handleTogglePin = useCallback((nodeId: string, label: string) => {
    setPinnedNodes(prev => {
      const exists = prev.find(p => p.id === nodeId);
      if (exists) return prev.filter(p => p.id !== nodeId);
      return [...prev, { id: nodeId, label }];
    });
  }, []);

  const initializedRef = useRef(false);
  const suppressAutosaveRef = useRef(false);

  const workflows = useWorkflowStore((s) => s.workflows);
  const activeWorkflowId = useWorkflowStore((s) => s.activeWorkflowId);
  const loadFromStorage = useWorkflowStore((s) => s.loadFromStorage);
  const createWorkflow = useWorkflowStore((s) => s.createWorkflow);
  const autosave = useWorkflowStore((s) => s.autosave);
  const setActiveWorkflowId = useWorkflowStore((s) => s.setActiveWorkflowId);
  const deleteWorkflow = useWorkflowStore((s) => s.deleteWorkflow);
  const renameWorkflow = useWorkflowStore((s) => s.renameWorkflow);

  // ─── Bootstrap ───
  useEffect(() => {
    loadFromStorage();
    const store = useWorkflowStore.getState();

    if (store.workflows.length === 0) {
      const id = store.createWorkflow("Default Pipeline", defaultNodes, defaultEdges);
      setNodes(defaultNodes);
      setEdges(defaultEdges);
      syncNodeIdCounter(defaultNodes);
    } else {
      const activeId = store.activeWorkflowId || store.workflows[0].id;
      const wf = store.workflows.find((w) => w.id === activeId) || store.workflows[0];
      if (wf) {
        setNodes(wf.nodes);
        setEdges(wf.edges);
        syncNodeIdCounter(wf.nodes);
        if (store.activeWorkflowId !== wf.id) {
          store.setActiveWorkflowId(wf.id);
        }
      }
    }

    setTimeout(() => {
      initializedRef.current = true;
    }, 200);
  }, []);

  // ─── Autosave ───
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!initializedRef.current) return;
    if (suppressAutosaveRef.current) return;

    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      autosave(nodes, edges);
    }, 800);

    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
  }, [nodes, edges, autosave]);

  // ─── WebSocket ───
  const updateTelemetry = useTelemetryStore((s) => s.updateTelemetry);

  useEffect(() => {
    const unsub = pipelineSocket.on("telemetry_update", (data: any) => {
      updateTelemetry(data);
    });
    return () => unsub();
  }, [updateTelemetry]);

  useEffect(() => {
    pipelineSocket.connect();

    const statusHandler = (data: any) => {
      setBackendConnected(data.connected);
    };
    pipelineSocket.on("status", statusHandler);

    const generatedHandler = (data: {
      nodes?: { id: string; type: string; data?: Record<string, any> }[];
      edges?: {
        source: string;
        target: string;
        sourceHandle?: string;
        targetHandle?: string;
      }[];
      error?: string | null;
    }) => {
      setGenerateLoading(false);
      setGenerateError(data.error ?? null);
      if (data.nodes?.length && !data.error) {
        suppressAutosaveRef.current = true;
        const spacing = 380;
        const validNodes = data.nodes.filter((n) =>
          VALID_NODE_TYPES.has(n.type)
        );
        const newNodes: Node[] = validNodes.map((n, i) => ({
          id: n.id,
          type: n.type,
          position: { x: 50 + i * spacing, y: 200 },
          data: n.data || {},
        }));
        const nodeIds = new Set(newNodes.map((n) => n.id));
        const newEdges: Edge[] = (data.edges || [])
          .filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
          .map((e, i) => ({
            id: `e-${e.source}-${e.target}-${i}`,
            source: e.source,
            target: e.target,
            sourceHandle: e.sourceHandle,
            targetHandle: e.targetHandle,
            animated: true,
            style: { stroke: "rgba(66, 133, 244, 0.4)" },
          }));
        setNodes(newNodes);
        setEdges(newEdges);
        syncNodeIdCounter(newNodes);
        setTimeout(() => { suppressAutosaveRef.current = false; }, 500);
      }
    };

    const chatHandler = (payload: any) => {
      if (payload.new_workflow) {
        suppressAutosaveRef.current = true;
        setNodes(payload.new_workflow.nodes);
        setEdges(payload.new_workflow.edges);
        syncNodeIdCounter(payload.new_workflow.nodes);
        setTimeout(() => { suppressAutosaveRef.current = false; }, 500);
      }
    };

    pipelineSocket.on("workflow_generated", generatedHandler);
    pipelineSocket.on("chat_result", chatHandler);

    return () => {
      pipelineSocket.off("status", statusHandler);
      pipelineSocket.off("workflow_generated", generatedHandler);
      pipelineSocket.off("chat_result", chatHandler);
      pipelineSocket.disconnect();
    };
  }, [setNodes, setEdges]);

  // ─── Edge Flow Visual Feedback ───
  const lastVersionsRef = useRef<Record<string, number>>({});
  
  useEffect(() => {
    const unsub = useNodeOutputStore.subscribe((state) => {
      const activeEdges = useWorkflowStore.getState().workflows.find(w => w.id === useWorkflowStore.getState().activeWorkflowId)?.edges || [];
      
      Object.entries(state.versions).forEach(([key, version]) => {
        const lastVersion = lastVersionsRef.current[key] || 0;
        if (version > lastVersion) {
          const [nodeId, handleId] = key.split(":");
          
          const flowingEdges = activeEdges.filter(e => 
            e.source === nodeId && (!handleId || e.sourceHandle === handleId)
          );
          
          if (flowingEdges.length > 0) {
            setEdges((eds) => eds.map(e => {
              if (flowingEdges.some(fe => fe.id === e.id)) {
                return { ...e, className: "edge-flowing" };
              }
              return e;
            }));
            
            setTimeout(() => {
              setEdges((eds) => eds.map(e => {
                if (flowingEdges.some(fe => fe.id === e.id)) {
                  const { className, ...rest } = e;
                  return rest;
                }
                return e;
              }));
            }, 1000);
          }
          lastVersionsRef.current[key] = version;
        }
      });
    });
    
    return () => unsub();
  }, [setEdges]);

  const generateWorkflow = useCallback(() => {
    if (!backendConnected || !workflowInput.trim()) return;
    if (nodes.length > 0) {
      const ok = window.confirm(
        "This will replace your current workflow. Continue?"
      );
      if (!ok) return;
    }
    setGenerateLoading(true);
    setGenerateError(null);
    pipelineSocket.sendGenerateWorkflow(workflowInput.trim());
  }, [backendConnected, workflowInput, nodes.length]);

  const onConnect = useCallback(
    (params: Connection) => {
      if (!params.source || !params.target) return;
      const edgeId = `edge-${params.source}-${params.target}-${Date.now()}`;
      const newEdge: Edge = {
        id: edgeId,
        source: params.source,
        target: params.target,
        sourceHandle: params.sourceHandle,
        targetHandle: params.targetHandle,
        animated: true,
        style: { 
          stroke: "#4285F4", 
          strokeWidth: 4,
          filter: "drop-shadow(0 0 10px rgba(66, 133, 244, 0.5))"
        },
        zIndex: 1000,
      };
      
      setEdges((eds) => [...eds, newEdge]);
      console.log("Connection Established:", edgeId);
    },
    [setEdges]
  );

  const isValidConnection = useCallback((connection: Connection) => {
    return true;
  }, []);

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      const type = event.dataTransfer.getData("application/reactflow");
      if (!type || !reactFlowInstance || !reactFlowWrapper.current) return;

      const bounds = reactFlowWrapper.current.getBoundingClientRect();
      const position = reactFlowInstance.screenToFlowPosition({
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      });

      const newNode: Node = {
        id: getNewId(),
        type,
        position,
        data: {},
      };

      setNodes((nds) => nds.concat(newNode));
    },
    [reactFlowInstance, setNodes]
  );

  // ─── Workflow management ───

  const clearAllStores = useCallback(() => {
    useFrameStore.getState().clearAll();
    useAudioStore.getState().clearAll();
    useNodeOutputStore.getState().clearAll();
  }, []);

  const handleSwitchWorkflow = useCallback(
    (workflow: SavedWorkflow) => {
      if (workflow.id === activeWorkflowId) return;

      suppressAutosaveRef.current = true;
      prepareSwitch(activeWorkflowId!);

      setNodes([]);
      setEdges([]);

      setTimeout(() => {
        useNodeOutputStore.getState().clearAll();

        setActiveWorkflowId(workflow.id);
        setNodes(workflow.nodes);
        setEdges(workflow.edges);
        syncNodeIdCounter(workflow.nodes);

        completeSwitch();

        setTimeout(() => {
          suppressAutosaveRef.current = false;
        }, 200);
      }, 50);
    },
    [activeWorkflowId, setNodes, setEdges, setActiveWorkflowId]
  );

  const handleNewWorkflow = useCallback(() => {
    suppressAutosaveRef.current = true;

    if (activeWorkflowId) prepareSwitch(activeWorkflowId);

    setNodes([]);
    setEdges([]);

    setTimeout(() => {
      useNodeOutputStore.getState().clearAll();

      const existingCount = useWorkflowStore.getState().workflows.length;
      const name = `Pipeline ${existingCount + 1}`;

      createWorkflow(name, [], []);
      completeSwitch();

      setTimeout(() => {
        suppressAutosaveRef.current = false;
      }, 200);
    }, 50);
  }, [setNodes, setEdges, createWorkflow, activeWorkflowId]);

  const handleDeleteWorkflow = useCallback(
    (id: string) => {
      destroyWorkflowCaptures(id);

      const nextId = deleteWorkflow(id);

      if (id === activeWorkflowId) {
        suppressAutosaveRef.current = true;
        setNodes([]);
        setEdges([]);

        setTimeout(() => {
          clearAllStores();

          if (nextId) {
            const store = useWorkflowStore.getState();
            const wf = store.workflows.find((w) => w.id === nextId);
            if (wf) {
              setActiveWorkflowId(wf.id);
              setNodes(wf.nodes);
              setEdges(wf.edges);
              syncNodeIdCounter(wf.nodes);
            }
          } else {
            createWorkflow("Default Pipeline", defaultNodes, defaultEdges);
            setNodes(defaultNodes);
            setEdges(defaultEdges);
            syncNodeIdCounter(defaultNodes);
          }

          setTimeout(() => {
            suppressAutosaveRef.current = false;
          }, 200);
        }, 50);
      }
    },
    [activeWorkflowId, deleteWorkflow, setNodes, setEdges, clearAllStores, createWorkflow, setActiveWorkflowId]
  );

  const onAddNode = useCallback(
    (type: string) => {
      if (!reactFlowInstance) return;

      const { x, y, zoom } = reactFlowInstance.getViewport();
      const width = reactFlowWrapper.current?.offsetWidth || 1000;
      const height = reactFlowWrapper.current?.offsetHeight || 800;

      const position = reactFlowInstance.screenToFlowPosition({
        x: width / 2,
        y: height / 2,
      });

      const newNode: Node = {
        id: getNewId(),
        type,
        position,
        data: {},
      };

      setNodes((nds) => nds.concat(newNode));
    },
    [reactFlowInstance, setNodes]
  );

  const handleAutoWire = useCallback(() => {
    const cam = nodes.find(n => n.type === 'camera');
    const det = nodes.find(n => n.type === 'detection');
    const vlm = nodes.find(n => n.type === 'visualLlm');
    const actions = nodes.filter(n => n.type && (n.type.includes('Action') || n.type === 'logic'));
    
    setEdges(eds => {
      let newEdges = [...eds];
      const addIfMissing = (s: string, sh: string, t: string, th: string, color: string) => {
        if (!newEdges.find(e => e.source === s && e.target === t && e.targetHandle === th)) {
          newEdges.push({
            id: `edge-auto-${s}-${t}-${th}-${Date.now()}`,
            source: s,
            sourceHandle: sh,
            target: t,
            targetHandle: th,
            animated: true,
            style: { stroke: color, strokeWidth: 4, filter: `drop-shadow(0 0 8px ${color}80)` },
          });
        }
      };

      if (cam && det) addIfMissing(cam.id, 'camera', det.id, 'camera', '#4285F4');
      
      if (det && vlm) {
        addIfMissing(det.id, 'match', vlm.id, 'trigger', '#34A853');
        if (cam) addIfMissing(cam.id, 'camera', vlm.id, 'camera', '#4285F4');
      }

      if (vlm && actions.length > 0) {
        actions.forEach(act => addIfMissing(vlm.id, 'output', act.id, 'input', '#A855F7'));
      }

      return newEdges;
    });
    console.log("Full Pipeline Auto-Wired Successfully");
  }, [nodes, setEdges]);

  const handleNuclearReset = useCallback(() => {
    const clone = <T,>(obj: T): T => JSON.parse(JSON.stringify(obj));
    const freshNodes = clone(defaultNodes);
    const freshEdges = clone(defaultEdges);

    const store = useWorkflowStore.getState();
    store.nuclearReset("Default Pipeline", freshNodes, freshEdges);

    setNodes(freshNodes);
    setEdges(freshEdges);
    syncNodeIdCounter(freshNodes);
    console.log("System Reset Complete! Workspace reactively loaded.");
  }, [setNodes, setEdges]);

  useEffect(() => {
    const handleDeleteNode = (e: any) => {
      const idToDelete = e.detail?.id;
      if (idToDelete) {
        setNodes((nds) => nds.filter((n) => n.id !== idToDelete));
        setEdges((eds) => eds.filter((edge) => edge.source !== idToDelete && edge.target !== idToDelete));
      }
    };

    const handleOpenDocs = () => setDocsOpen(true);
    const handleOpenHelp = () => setHelpOpen(true);

    window.addEventListener("lumina:autowire", handleAutoWire);
    window.addEventListener("lumina:nuclear-reset", handleNuclearReset);
    window.addEventListener("lumina:delete-node", handleDeleteNode);
    window.addEventListener("lumina:open-docs", handleOpenDocs);
    window.addEventListener("lumina:open-help", handleOpenHelp);
    return () => {
      window.removeEventListener("lumina:autowire", handleAutoWire);
      window.removeEventListener("lumina:nuclear-reset", handleNuclearReset);
      window.removeEventListener("lumina:delete-node", handleDeleteNode);
      window.removeEventListener("lumina:open-docs", handleOpenDocs);
      window.removeEventListener("lumina:open-help", handleOpenHelp);
    };
  }, [handleAutoWire, handleNuclearReset, setEdges, setNodes]);

  const handleAddTemplate = useCallback((template: any) => {
    const store = useWorkflowStore.getState();
    store.createWorkflow(template.name, template.nodes, template.edges);
    window.location.reload();
  }, []);

  const nodesWithCallbacks = useMemo(() => {
    return nodes.map((n) => ({
      ...n,
      data: {
        ...n.data,
        onPin: () => handleTogglePin(n.id, n.type || "Node"),
        pinned: !!pinnedNodes.find((p) => p.id === n.id),
      },
    }));
  }, [nodes, pinnedNodes, handleTogglePin]);

  return (
    <div className="flex h-full w-full overflow-hidden transition-all duration-500 bg-[#030305] font-sans">
      {!isDashboard && (
        <Sidebar backendConnected={backendConnected} onAddNode={onAddNode} />
      )}

      <div className={`flex-1 relative transition-all duration-300 ${!isDashboard ? "ml-[240px]" : "ml-0"}`} ref={reactFlowWrapper}>
        {/* Top Header — Orchestrator Bar */}
        {!isDashboard && (
          <div
            className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-8 py-4 bg-[#030305]/80 backdrop-blur-xl border-b border-white/5 shadow-[0_4px_30px_rgba(0,0,0,0.4)]"
            style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
          >
            <div className="flex items-center gap-6 flex-1" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
              <div className="flex items-center gap-2 mr-4">
                <GitBranch size={16} className="text-[#4285F4]" />
                <span className="text-[10px] font-black tracking-[0.2em] text-white/40 uppercase">Lumina</span>
              </div>
              
              <div className="relative flex-1 max-w-xl">
                <Sparkles size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#4285F4]/50" />
                <input
                  type="text"
                  placeholder="Describe a pipeline to generate..."
                  value={workflowInput}
                  onChange={(e) => setWorkflowInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && generateWorkflow()}
                  disabled={!backendConnected || generateLoading}
                  className="nodrag w-full pl-10 pr-4 py-2 rounded-lg text-xs bg-white/5 border border-white/10 text-slate-200 placeholder-slate-600 focus:outline-none focus:border-[#4285F4]/30 transition-all"
                />
              </div>

              <button
                type="button"
                onClick={generateWorkflow}
                disabled={!backendConnected || generateLoading || !workflowInput.trim()}
                className="nodrag px-4 py-2 rounded-lg text-xs font-bold bg-[#4285F4]/10 border border-[#4285F4]/30 text-[#4285F4] hover:bg-[#4285F4]/20 transition-all disabled:opacity-30 cursor-pointer"
              >
                {generateLoading ? "Generating..." : "Generate Pipeline"}
              </button>
            </div>

            <div className="flex items-center gap-4" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
              <button 
                onClick={() => setVaultOpen(true)}
                className="nodrag px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/10 text-xs font-semibold text-slate-300 border border-white/5 transition-all flex items-center gap-1.5 cursor-pointer"
              >
                Vault Settings
              </button>
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-[9px] font-bold text-emerald-500 uppercase tracking-widest">NPU Active</span>
              </div>
            </div>
          </div>
        )}

        {generateError && (
          <div className="absolute top-11 left-4 right-4 z-20 nodrag px-3 py-2 rounded-md text-xs text-red-400 border border-red-500/30 bg-red-950/30">
            {generateError}
          </div>
        )}

        {/* Workflow panel toggle tab — right edge */}
        {!workflowPanelOpen && (
          <button
            onClick={() => setWorkflowPanelOpen(true)}
            className="absolute right-0 top-1/2 -translate-y-1/2 z-10 flex items-center gap-1.5 py-3 pl-2 pr-1 rounded-l-lg transition-colors hover:bg-[#1a1a25] cursor-pointer"
            style={{
              background: "#13131a",
              borderTop: "1px solid #282838",
              borderLeft: "1px solid #282838",
              borderBottom: "1px solid #282838",
            }}
            title="Open Workflows"
          >
            <FolderOpen size={14} className="text-slate-500" />
            <ChevronLeft size={12} className="text-slate-600" />
          </button>
        )}

        {/* AI Chat Toggle — right edge bottom */}
        {!aiChatOpen && !isDashboard && (
          <button
            onClick={() => setAiChatOpen(true)}
            className="absolute right-0 bottom-20 z-10 flex items-center gap-1.5 py-3 pl-2 pr-1 rounded-l-lg transition-colors hover:bg-purple-900/10 cursor-pointer"
            style={{
              background: "#13131a",
              borderTop: "1px solid #282838",
              borderLeft: "1px solid #282838",
              borderBottom: "1px solid #282838",
              borderColor: "rgba(168, 85, 247, 0.4)"
            }}
          >
            <Sparkles size={14} className="text-purple-400" />
          </button>
        )}


        {pinnedNodes.map(p => (
          <PreviewOverlay
            key={p.id}
            nodeId={p.id}
            label={p.label}
            onClose={() => handleTogglePin(p.id, p.label)}
          />
        ))}

        <ReactFlow
          nodes={nodesWithCallbacks}
          edges={edges}
          onNodesChange={isDashboard ? undefined : onNodesChange}
          onEdgesChange={isDashboard ? undefined : onEdgesChange}
          onConnect={isDashboard ? undefined : onConnect}
          isValidConnection={isValidConnection}
          onInit={setReactFlowInstance}
          onDrop={onDrop}
          onDragOver={onDragOver}
          nodeTypes={NODE_TYPES}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          snapToGrid
          snapGrid={[20, 20]}
          connectionRadius={100}
          noDragClassName="nodrag"
          noWheelClassName="nowheel"
          edgesUpdatable
          style={{ 
            background: isDashboard ? "#050508" : "#0d0d14",
            opacity: isDashboard ? 0.3 : 1,
            pointerEvents: isDashboard ? "none" : "auto"
          }}
          defaultEdgeOptions={{
            type: "smoothstep",
            animated: true,
            style: { strokeWidth: 2, cursor: "pointer", stroke: "#4285F4" },
            interactionWidth: 20,
          }}
          proOptions={{ hideAttribution: true }}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={20}
            size={1}
            color="#1a1a2e"
          />
          <Controls showInteractive={false} position="bottom-right" />
          
          <MiniMap
            nodeStrokeWidth={3}
            pannable
            zoomable
            position="bottom-right"
            style={{
              marginBottom: 50,
            }}
            maskColor="rgba(10, 10, 15, 0.8)"
            nodeColor={(node) => {
              const colors: Record<string, string> = {
                camera: "#4285F4",
                video: "#4285F4",
                detection: "#f97316",
                visualLlm: "#a855f7",
                logic: "#f59e0b",
                llm: "#3b82f6",
                soundAction: "#f97316",
                logAction: "#34A853",
                notifyAction: "#eab308",
                screenshotAction: "#06b6d4",
                webhookAction: "#8b5cf6",
                emailAction: "#3b82f6",
                smsAction: "#14b8a6",
                mic: "#FBBC05",
                audioDetect: "#8b5cf6",
                audioLlm: "#ec4899",
              };
              return colors[node.type || ""] || "#64748b";
            }}
          />
        </ReactFlow>
      </div>

      {/* Workflow Manager Panel */}
      <WorkflowPanel
        isOpen={workflowPanelOpen}
        onToggle={() => setWorkflowPanelOpen(false)}
        onSwitchWorkflow={handleSwitchWorkflow}
        onNewWorkflow={handleNewWorkflow}
        onDeleteWorkflow={handleDeleteWorkflow}
        onRenameWorkflow={renameWorkflow}
        activeWorkflowId={activeWorkflowId}
        workflows={workflows}
        canvasNodes={nodes}
        onAddTemplate={handleAddTemplate}
      />

      {/* Quick Actions Panel bottom center/left */}
      <div className="absolute left-[20px] bottom-4 z-50 flex items-center gap-3 nodrag">
        <button
          onClick={() => setIsDashboard(!isDashboard)}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border transition-all cursor-pointer text-[10px] font-black uppercase tracking-widest ${
            isDashboard 
              ? "bg-[#4285F4] text-white border-[#4285F4] shadow-lg shadow-[#4285F4]/20" 
              : "bg-[#13131a] text-slate-500 border-[#1e1e2e] hover:border-[#4285F4]/30 hover:text-slate-300"
          }`}
        >
          <LayoutDashboard size={14} />
          <span>
            {isDashboard ? "Exit Dashboard" : "Dashboard Mode"}
          </span>
        </button>

        {!isDashboard && (
          <>
            <button
              onClick={handleAutoWire}
              className="px-4 py-2.5 rounded-xl bg-[#4285F4]/10 border border-[#4285F4]/20 text-[#4285F4] text-[10px] font-black uppercase tracking-widest hover:bg-[#4285F4]/20 transition-all flex items-center gap-2 cursor-pointer"
            >
              <GitBranch size={12} />
              Auto-Wire
            </button>
            <button
              onClick={handleNuclearReset}
              className="px-4 py-2.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-[10px] font-black uppercase tracking-widest hover:bg-rose-500/30 transition-all flex items-center gap-2 cursor-pointer"
            >
              <X size={12} />
              Reset Workspace
            </button>

            <div className="h-4 w-[1px] bg-white/10 hidden md:block" />

            <span className="text-[10px] text-slate-500 font-sans hidden md:block select-none">
              Select + <kbd className="px-1 py-0.5 rounded bg-[#1e1e2e] text-slate-400 font-mono text-[9px]">Del</kbd> to remove nodes &amp; connections
            </span>
          </>
        )}
      </div>

      {aiChatOpen && (
        <div className="relative h-full flex-shrink-0 z-50">
          <AiChat />
          <button 
            onClick={() => setAiChatOpen(false)}
            className="absolute -left-3 top-1/2 -translate-y-1/2 bg-[#1e1e2e] border border-[#282838] p-1.5 rounded-full text-slate-500 hover:text-slate-200 shadow-2xl transition-all hover:scale-110 cursor-pointer"
          >
            <X size={12} />
          </button>
        </div>
      )}

      {isDashboard && <TelemetryHud />}
      {vaultOpen && <VaultSettings onClose={() => setVaultOpen(false)} />}

      {docsOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-[100] flex items-center justify-center p-6">
          <div className="glass max-w-3xl w-full rounded-[2rem] border border-white/10 overflow-hidden shadow-2xl bg-[#09090d]/90 flex flex-col max-h-[85vh]">
            <header className="px-8 py-6 border-b border-white/5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-cyan-500/10 rounded-xl text-cyan-400">
                  <BookOpen size={20} />
                </div>
                <div>
                  <h2 className="text-base font-bold text-white">Lumina Documentation</h2>
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-0.5">Privacy-First Visual AI Architecture</p>
                </div>
              </div>
              <button 
                onClick={() => setDocsOpen(false)}
                className="p-2 rounded-full bg-white/5 border border-white/5 text-slate-400 hover:text-white hover:bg-white/10 transition-all cursor-pointer"
              >
                <X size={16} />
              </button>
            </header>
            
            <div className="flex-1 overflow-y-auto p-8 space-y-6 scrollbar-none font-sans text-sm text-slate-300 leading-relaxed">
              <div>
                <h3 className="font-bold text-white mb-2 uppercase tracking-wider text-xs text-cyan-400">System Overview</h3>
                <p>Lumina is a privacy-first local workflow orchestrator. All visual, audio, and reasoning nodes execute purely inside your machine's hardware memory space. Zero files or live video feeds leave your device.</p>
              </div>

              <div>
                <h3 className="font-bold text-white mb-3 uppercase tracking-wider text-xs text-cyan-400">Core Intelligent Nodes</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5">
                    <span className="font-bold text-white text-xs block mb-1">Camera &amp; Video Input</span>
                    <p className="text-xs text-slate-400">Streams frames at custom configurable FPS boundaries into downstream detection structures.</p>
                  </div>
                  <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5">
                    <span className="font-bold text-white text-xs block mb-1">Object Detect</span>
                    <p className="text-xs text-slate-400">YOLOv8 deep learning model executing offline. Identifies 80+ standard object classes at microsecond latency thresholds.</p>
                  </div>
                  <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5">
                    <span className="font-bold text-white text-xs block mb-1">Visual LLM</span>
                    <p className="text-xs text-slate-400">Multimodal vision engine using Google Gemini 2.0 Flash (online) with automatic fallbacks to Moondream (100% on-device/offline).</p>
                  </div>
                  <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5">
                    <span className="font-bold text-white text-xs block mb-1">Audio Detect &amp; LLM</span>
                    <p className="text-xs text-slate-400">Continuous decibel level mapping + YamNet audio categorization with deep audio summary reasoning.</p>
                  </div>
                </div>
              </div>

              <div>
                <h3 className="font-bold text-white mb-2 uppercase tracking-wider text-xs text-cyan-400">Output Actions</h3>
                <p>Output nodes (Console Log, Custom Webhooks, Email Alerts, Twilio SMS) are activated by linking trigger edges. The logic gate allows matching conditions to restrict actions to specific events.</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {helpOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-[100] flex items-center justify-center p-6">
          <div className="glass max-w-lg w-full rounded-[2rem] border border-white/10 overflow-hidden shadow-2xl bg-[#09090d]/90 flex flex-col">
            <header className="px-8 py-6 border-b border-white/5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-amber-500/10 rounded-xl text-amber-400">
                  <HelpCircle size={20} />
                </div>
                <div>
                  <h2 className="text-base font-bold text-white">System Help</h2>
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-0.5">Quick Start &amp; Controls</p>
                </div>
              </div>
              <button 
                onClick={() => setHelpOpen(false)}
                className="p-2 rounded-full bg-white/5 border border-white/5 text-slate-400 hover:text-white hover:bg-white/10 transition-all cursor-pointer"
              >
                <X size={16} />
              </button>
            </header>
            
            <div className="p-8 space-y-5 font-sans text-xs text-slate-300 leading-relaxed">
              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <div className="w-5 h-5 rounded-full bg-amber-500/10 flex items-center justify-center text-amber-400 font-mono font-bold shrink-0">1</div>
                  <p><strong>Drag &amp; Drop Nodes:</strong> Use the left-hand sidebar to drag visual, audio, or logic components onto the infinite canvas.</p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-5 h-5 rounded-full bg-amber-500/10 flex items-center justify-center text-amber-400 font-mono font-bold shrink-0">2</div>
                  <p><strong>Connect Handles:</strong> Click and drag from output handles (colored dots) to input/trigger handles of other nodes.</p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-5 h-5 rounded-full bg-amber-500/10 flex items-center justify-center text-amber-400 font-mono font-bold shrink-0">3</div>
                  <p><strong>Remove Elements:</strong> Click to select any node or connection line, then press <kbd className="px-1 py-0.5 bg-white/5 border border-white/10 rounded font-mono text-[10px]">Backspace</kbd> or <kbd className="px-1 py-0.5 bg-white/5 border border-white/10 rounded font-mono text-[10px]">Delete</kbd>, or click the cross icon on the node's top shell.</p>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-5 h-5 rounded-full bg-amber-500/10 flex items-center justify-center text-amber-400 font-mono font-bold shrink-0">4</div>
                  <p><strong>Reset Workspace:</strong> If you ever want to clear all nodes and load the default synchronized pipeline, click the <strong>Reset Workspace</strong> action button at the bottom of the editor.</p>
                </div>
              </div>

              <div className="pt-4 border-t border-white/5 text-[10px] text-slate-500 uppercase tracking-wider text-center font-bold font-sans">
                Lumina Orchestrator version 1.0.0
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
