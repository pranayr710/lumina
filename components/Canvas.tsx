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
import { FolderOpen, ChevronLeft, GitBranch, Sparkles, X, LayoutDashboard, HelpCircle, BookOpen, Download, Eye, EyeOff, Shield, Play, Square, Calendar, Clock, Undo2, Redo2 } from "lucide-react";
import { exportToN8n } from "@/lib/exportN8n";
import { exportToNodeRed } from "@/lib/exportNodeRed";
import Sidebar from "./Sidebar";
import WorkflowPanel from "./WorkflowPanel";
import { NODE_TYPES } from "@/lib/reactFlowTypes";
import PreviewOverlay from "./PreviewOverlay";
import AiChat from "./AiChat";
import VaultSettings from "./VaultSettings";
import ContextMenu from "./ContextMenu";
import ScheduleModal, { type ScheduleConfig } from "./ScheduleModal";
import ReplayPanel from "./ReplayPanel";
import { pipelineSocket } from "@/lib/websocket";
import { useWorkflowStore, type SavedWorkflow } from "@/lib/workflowStore";
import { useFrameStore } from "@/lib/frameStore";
import { useAudioStore } from "@/lib/audioStore";
import { useNodeOutputStore } from "@/lib/nodeOutputStore";
import { useTelemetryStore } from "@/lib/telemetryStore";
import { useHistoryStore } from "@/lib/historyStore";
import { usePipelineControlStore } from "@/lib/pipelineControlStore";
import TelemetryHud from "./TelemetryHud";
import {
  prepareSwitch,
  completeSwitch,
  destroyWorkflowCaptures,
} from "@/lib/captureRegistry";

const VALID_NODE_TYPES = new Set<string>(Object.keys(NODE_TYPES));

const ACTION_NODE_TYPES = new Set([
  "logAction","emailAction","smsAction","slackAction","discordAction",
  "webhookAction","mqttAction","googleSheetsAction","screenshotAction",
  "notifyAction","speakAction","soundAction","fileAction",
]);

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
    onEdgesChangeOriginal(changes);
  }, [onEdgesChangeOriginal]);
  
  const [backendConnected, setBackendConnected] = useState(false);
  const [workflowInput, setWorkflowInput] = useState("");
  const [generateLoading, setGenerateLoading] = useState(false);
  const generateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [workflowPanelOpen, setWorkflowPanelOpen] = useState(false);
  const [vaultOpen, setVaultOpen] = useState(false);
  const [aiChatOpen, setAiChatOpen] = useState(false);
  const [docsOpen, setDocsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [pipelineResult, setPipelineResult] = useState<{
    timestamp: string;
    detection_output: string;
    vlm_analysis: string;
    image: string;
    latency_ms: number;
  } | null>(null);
  const [showPipelinePanel, setShowPipelinePanel] = useState(true);
  const [showPrivacyHud, setShowPrivacyHud] = useState(false);
  const [aiWireLoading, setAiWireLoading] = useState(false);
  const [aiWireDialogOpen, setAiWireDialogOpen] = useState(false);
  const [aiWireDescription, setAiWireDescription] = useState("");
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; nodeId: string } | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [replayOpen, setReplayOpen] = useState(false);
  const [scheduleConfig, setScheduleConfig] = useState<ScheduleConfig | null>(null);
  const scheduleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copiedNodesRef = useRef<Node[]>([]);
  const isUndoingRef = useRef(false);
  const [edgeLabels, setEdgeLabels] = useState<Record<string, string>>({});
  const edgeLabelThrottle = useRef<ReturnType<typeof setTimeout> | null>(null);

  const historyPush = useHistoryStore(s => s.push);
  const historyUndo = useHistoryStore(s => s.undo);
  const historyRedo = useHistoryStore(s => s.redo);
  const canUndo = useHistoryStore(s => s.canUndo);
  const canRedo = useHistoryStore(s => s.canRedo);
  const historyClear = useHistoryStore(s => s.clear);

  const pipelineRunning = usePipelineControlStore(s => s.isRunning);
  const togglePipeline = usePipelineControlStore(s => s.toggle);

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

  // ─── History push (debounced, skipped during undo/redo) ───
  const historyDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!initializedRef.current) return;
    if (isUndoingRef.current) return;
    if (historyDebounce.current) clearTimeout(historyDebounce.current);
    historyDebounce.current = setTimeout(() => { historyPush(nodes, edges); }, 400);
    return () => { if (historyDebounce.current) clearTimeout(historyDebounce.current); };
  }, [nodes, edges]);

  // ─── Keyboard shortcuts ───
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const inInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;

      // Ctrl/Cmd shortcuts
      const ctrl = e.ctrlKey || e.metaKey;

      if (ctrl && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        if (!canUndo()) return;
        isUndoingRef.current = true;
        const snap = historyUndo();
        if (snap) { setNodes(snap.nodes); setEdges(snap.edges); }
        setTimeout(() => { isUndoingRef.current = false; }, 50);
        return;
      }
      if (ctrl && (e.key === "y" || (e.key === "z" && e.shiftKey))) {
        e.preventDefault();
        if (!canRedo()) return;
        isUndoingRef.current = true;
        const snap = historyRedo();
        if (snap) { setNodes(snap.nodes); setEdges(snap.edges); }
        setTimeout(() => { isUndoingRef.current = false; }, 50);
        return;
      }
      if (ctrl && e.key === "d") {
        e.preventDefault();
        duplicateSelectedNodes();
        return;
      }
      if (ctrl && e.key === "a" && !inInput) {
        e.preventDefault();
        setNodes(nds => nds.map(n => ({ ...n, selected: true })));
        return;
      }
      if (ctrl && e.key === "c" && !inInput) {
        copiedNodesRef.current = nodes.filter(n => n.selected);
        return;
      }
      if (ctrl && e.key === "v" && !inInput) {
        e.preventDefault();
        pasteNodes();
        return;
      }
      if (e.key === " " && !inInput) {
        e.preventDefault();
        reactFlowInstance?.fitView({ padding: 0.15, duration: 400 });
        return;
      }
      if (e.key === "Escape") {
        setContextMenu(null);
        setAiWireDialogOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nodes, edges, canUndo, canRedo, reactFlowInstance]);

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
      if (generateTimerRef.current) { clearTimeout(generateTimerRef.current); generateTimerRef.current = null; }
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
        // Backend nodes have no position — lay them out like generatedHandler
        const spacing = 380;
        const laidOut: Node[] = (payload.new_workflow.nodes || [])
          .filter((n: any) => VALID_NODE_TYPES.has(n.type))
          .map((n: any, i: number) => ({
            id: n.id,
            type: n.type,
            position: n.position ?? { x: 50 + i * spacing, y: 200 },
            data: n.data || {},
          }));
        const ids = new Set(laidOut.map((n) => n.id));
        const wired: Edge[] = (payload.new_workflow.edges || [])
          .filter((e: any) => ids.has(e.source) && ids.has(e.target))
          .map((e: any, i: number) => ({
            id: e.id || `e-chat-${e.source}-${e.target}-${i}`,
            source: e.source,
            target: e.target,
            sourceHandle: e.sourceHandle,
            targetHandle: e.targetHandle,
            animated: true,
            style: { stroke: "rgba(66, 133, 244, 0.4)" },
          }));
        setNodes(laidOut);
        setEdges(wired);
        syncNodeIdCounter(laidOut);
        setTimeout(() => { suppressAutosaveRef.current = false; }, 500);
      }
    };

    const autoConnectHandler = (data: {
      edges?: { source: string; target: string; sourceHandle?: string; targetHandle?: string; id?: string }[];
    }) => {
      setAiWireLoading(false);   // clear on actual response — no hardcoded timeout needed
      setAiWireDescription("");
      if (data.edges?.length) {
        setEdges((eds) => {
          const existingPairs = new Set(eds.map((e) => `${e.source}-${e.target}`));
          const newEdges = (data.edges || [])
            .filter((e) => !existingPairs.has(`${e.source}-${e.target}`))
            .map((e, i) => ({
              id: e.id || `e-auto-${e.source}-${e.target}-${Date.now()}-${i}`,
              source: e.source,
              target: e.target,
              sourceHandle: e.sourceHandle,
              targetHandle: e.targetHandle,
              animated: true,
              style: { stroke: "#4285F4", strokeWidth: 3, filter: "drop-shadow(0 0 8px rgba(66,133,244,0.5))" },
            }));
          return [...eds, ...newEdges];
        });
      }
    };

    pipelineSocket.on("workflow_generated", generatedHandler);
    pipelineSocket.on("chat_result", chatHandler);
    pipelineSocket.on("auto_connect_result", autoConnectHandler);

    // Live Node-RED pipeline results
    const pipelineResultHandler = (data: any) => {
      setPipelineResult({
        timestamp: data.timestamp || new Date().toLocaleTimeString(),
        detection_output: data.detection_output || "",
        vlm_analysis: data.vlm_analysis || "",
        image: data.image || "",
        latency_ms: data.latency_ms || 0,
      });
      setShowPipelinePanel(true);
    };
    pipelineSocket.on("pipeline_result", pipelineResultHandler);

    return () => {
      pipelineSocket.off("status", statusHandler);
      pipelineSocket.off("workflow_generated", generatedHandler);
      pipelineSocket.off("chat_result", chatHandler);
      pipelineSocket.off("auto_connect_result", autoConnectHandler);
      pipelineSocket.off("pipeline_result", pipelineResultHandler);
      pipelineSocket.disconnect();
    };
  }, [setNodes, setEdges]);

  // ─── Edge data labels (throttled) ───
  useEffect(() => {
    const unsub = useNodeOutputStore.subscribe((state) => {
      if (edgeLabelThrottle.current) return;
      edgeLabelThrottle.current = setTimeout(() => {
        edgeLabelThrottle.current = null;
        const newLabels: Record<string, string> = {};
        edges.forEach(e => {
          const key = `${e.source}:${e.sourceHandle}`;
          const val = state.outputs[key] || state.outputs[e.source];
          if (val) {
            let label = val.toString().trim();
            try { const obj = JSON.parse(label); label = Object.values(obj)[0] as string || label; } catch {}
            newLabels[e.id] = label.slice(0, 22) + (label.length > 22 ? "…" : "");
          }
        });
        setEdgeLabels(newLabels);
      }, 800);
    });
    return () => unsub();
  }, [edges]);

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
    // Local models run on CPU — a complex pipeline can take ~90s. Guard against
    // a lost/slow response (e.g. socket reconnect) so it never sticks forever.
    if (generateTimerRef.current) clearTimeout(generateTimerRef.current);
    generateTimerRef.current = setTimeout(() => {
      setGenerateLoading(false);
      setGenerateError("Generation timed out. The local model can be slow on CPU — please try again.");
    }, 200000);
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

  const duplicateSelectedNodes = useCallback(() => {
    const selected = nodes.filter(n => n.selected);
    if (!selected.length) return;
    const offset = 40;
    const clones: Node[] = selected.map(n => ({
      ...JSON.parse(JSON.stringify(n)),
      id: `node-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      position: { x: n.position.x + offset, y: n.position.y + offset },
      selected: false,
    }));
    setNodes(nds => [...nds.map(n => ({ ...n, selected: false })), ...clones]);
  }, [nodes, setNodes]);

  const pasteNodes = useCallback(() => {
    const toPaste = copiedNodesRef.current;
    if (!toPaste.length) return;
    const clones: Node[] = toPaste.map(n => ({
      ...JSON.parse(JSON.stringify(n)),
      id: `node-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      position: { x: n.position.x + 60, y: n.position.y + 60 },
      selected: true,
    }));
    setNodes(nds => [...nds.map(n => ({ ...n, selected: false })), ...clones]);
  }, [setNodes]);

  const handleNodeContextMenu = useCallback((e: React.MouseEvent, node: Node) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, nodeId: node.id });
  }, []);

  const handleApplySchedule = useCallback((cfg: ScheduleConfig) => {
    setScheduleConfig(cfg);
    if (scheduleTimerRef.current) clearInterval(scheduleTimerRef.current as any);

    const startPipeline = () => {
      usePipelineControlStore.getState().start();
      if (cfg.duration > 0) {
        setTimeout(() => usePipelineControlStore.getState().stop(), cfg.duration * 60 * 1000);
      }
    };

    if (cfg.type === "interval") {
      startPipeline();
      scheduleTimerRef.current = setInterval(startPipeline, cfg.interval * 60 * 1000) as any;
    } else if (cfg.type === "daily") {
      const [h, m] = cfg.time.split(":").map(Number);
      const now = new Date();
      const target = new Date(); target.setHours(h, m, 0, 0);
      if (target <= now) target.setDate(target.getDate() + 1);
      const delay = target.getTime() - now.getTime();
      scheduleTimerRef.current = setTimeout(() => {
        startPipeline();
        scheduleTimerRef.current = setInterval(startPipeline, 24 * 60 * 60 * 1000) as any;
      }, delay) as any;
    } else if (cfg.type === "once" && cfg.startAt) {
      const delay = new Date(cfg.startAt).getTime() - Date.now();
      if (delay > 0) scheduleTimerRef.current = setTimeout(startPipeline, delay) as any;
    }
  }, []);

  const handleClearSchedule = useCallback(() => {
    setScheduleConfig(null);
    if (scheduleTimerRef.current) clearInterval(scheduleTimerRef.current as any);
    scheduleTimerRef.current = null;
  }, []);

  const handleExportN8n = useCallback(async () => {
    if (!nodes.length) return;
    setExportLoading(true);
    setExportError(null);
    try {
      await exportToN8n(nodes, edges);
    } catch (err: any) {
      setExportError(err?.message || "Export failed");
      setTimeout(() => setExportError(null), 4000);
    } finally {
      setExportLoading(false);
    }
  }, [nodes, edges]);

  const handleExportNodeRed = useCallback(async () => {
    if (!nodes.length) return;
    setExportLoading(true);
    setExportError(null);
    try {
      await exportToNodeRed(nodes, edges);
    } catch (err: any) {
      setExportError(err?.message || "Node-RED export failed");
      setTimeout(() => setExportError(null), 4000);
    } finally {
      setExportLoading(false);
    }
  }, [nodes, edges]);

  const handleAiAutoWire = useCallback(() => {
    if (nodes.length < 2) return;
    setAiWireDialogOpen(true);
  }, [nodes.length]);

  const confirmAiAutoWire = useCallback(() => {
    if (!backendConnected) return;
    setAiWireDialogOpen(false);
    setAiWireLoading(true);
    pipelineSocket.send("auto_connect", {
      nodes: nodes.map((n) => ({ id: n.id, type: n.type })),
      existing_edges: edges.map((e) => ({ source: e.source, target: e.target })),
      description: aiWireDescription.trim(),
    });
    // aiWireLoading is cleared by autoConnectHandler when the response arrives.
    // Safety fallback matches the backend's 180s local-LLM timeout (gemma3 on
    // CPU can take ~80s just to load) plus a little margin.
    setTimeout(() => setAiWireLoading(false), 200000);
  }, [backendConnected, nodes, edges, aiWireDescription]);

  const handleAutoWire = useCallback(() => {
    setEdges(eds => {
      let idCounter = Date.now();
      // Track already-used source handles so each output connects to exactly ONE target
      const usedSrcHandles = new Set(eds.map(e => `${e.source}:${e.sourceHandle}`));
      const result = [...eds];

      // Sort nodes left→right so Quick Wire chains in visual pipeline order
      const sorted = [...nodes].sort((a, b) => a.position.x - b.position.x);

      const addEdge = (s: string, sh: string, t: string, th: string, color: string) => {
        const srcKey = `${s}:${sh}`;
        if (usedSrcHandles.has(srcKey)) return false;
        usedSrcHandles.add(srcKey);
        result.push({
          id: `qw-${idCounter++}`,
          source: s, sourceHandle: sh,
          target: t, targetHandle: th,
          animated: true,
          style: { stroke: color, strokeWidth: 3, filter: `drop-shadow(0 0 8px ${color}60)` },
        });
        return true;
      };

      // Returns the primary output handle + color for a node type
      const srcHandle = (type: string): [string, string] => {
        if (type === "camera") return ["camera", "#4285F4"];
        if (type === "video" || type === "ipCamera") return ["frames", "#4285F4"];
        if (type === "mic" || type === "audioFile") return ["audio", "#FBBC05"];
        if (type === "detection" || type === "audioDetect") return ["match", "#34A853"];
        if (type === "visualLlm" || type === "geminiLive" || type === "audioLlm") return ["response", "#A855F7"];
        if (type === "logic") return ["match", "#4285F4"];
        return ["output", "#3B82F6"]; // llm, script, debounce, toolUse, whisperStt, pose, faceMatch, ocr, merge
      };

      // Returns the correct target handle for a given target type + incoming handle
      const tgtHandle = (tgtType: string, incomingHandle: string): string | null => {
        const VISUAL_INPUTS = ["camera", "frames"];
        const AUDIO_INPUTS = ["audio"];
        const DATA_INPUTS = ["match", "output", "response"];

        if (VISUAL_INPUTS.includes(incomingHandle)) {
          // Visual frame → visual analysis nodes
          const visualTargets = ["detection","pose","faceMatch","ocr","visualLlm","geminiLive","screenshotAction"];
          if (visualTargets.includes(tgtType)) return "camera";
        }
        if (AUDIO_INPUTS.includes(incomingHandle)) {
          const audioTargets = ["audioDetect","audioLlm","whisperStt","geminiLive"];
          if (audioTargets.includes(tgtType)) return "audio";
        }
        if (DATA_INPUTS.includes(incomingHandle) || incomingHandle === "output") {
          if (tgtType === "logic") return "input";
          if (["llm","script","debounce","toolUse","audioLlm"].includes(tgtType)) return "input";
          if (["visualLlm","geminiLive"].includes(tgtType)) return "trigger";
          if (ACTION_NODE_TYPES.has(tgtType)) return "trigger";
        }
        // Fallback: match/output/response → action trigger
        if (ACTION_NODE_TYPES.has(tgtType)) return "trigger";
        return null;
      };

      for (let i = 0; i < sorted.length; i++) {
        const src = sorted[i];
        const [sh, color] = srcHandle(src.type || "");
        // Find the nearest successor (by position) that accepts this output
        for (let j = i + 1; j < sorted.length; j++) {
          const tgt = sorted[j];
          const th = tgtHandle(tgt.type || "", sh);
          if (!th) continue;
          const added = addEdge(src.id, sh, tgt.id, th, color);
          if (added) break; // one connection per source handle
        }
      }

      return result;
    });
  }, [nodes, setEdges]);

  const handleNuclearReset = useCallback(() => {
    const clone = <T,>(obj: T): T => JSON.parse(JSON.stringify(obj));
    const freshNodes = clone(defaultNodes);
    const freshEdges = clone(defaultEdges);

    const store = useWorkflowStore.getState();
    store.nuclearReset("Default Pipeline", freshNodes, freshEdges);

    historyClear();
    setNodes(freshNodes);
    setEdges(freshEdges);
    syncNodeIdCounter(freshNodes);
  }, [setNodes, setEdges, historyClear]);

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

  const edgesWithLabels = useMemo(() => {
    return edges.map(e => {
      const lbl = edgeLabels[e.id];
      if (!lbl) return e;
      return {
        ...e,
        label: lbl,
        labelStyle: { fill: "#94a3b8", fontSize: 9, fontFamily: "monospace" },
        labelBgStyle: { fill: "#09090d", fillOpacity: 0.85 },
        labelBgPadding: [4, 3] as [number, number],
        labelBgBorderRadius: 4,
      };
    });
  }, [edges, edgeLabels]);

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
            <div className="flex items-center gap-6 flex-1 min-w-0" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
              <div className="flex items-center gap-2 mr-4">
                <GitBranch size={16} className="text-[#4285F4]" />
                <span className="text-[10px] font-black tracking-[0.2em] text-white/40 uppercase">Lumina</span>
              </div>
              
              <div className="relative flex-1 min-w-0 max-w-xl">
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

            <div className="flex items-center gap-2 flex-shrink-0 flex-nowrap" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
              {/* Undo / Redo */}
              <button onClick={() => { isUndoingRef.current = true; const s = historyUndo(); if (s) { setNodes(s.nodes); setEdges(s.edges); } setTimeout(() => { isUndoingRef.current = false; }, 50); }}
                disabled={!canUndo()}
                className="nodrag p-1.5 rounded-lg bg-white/5 border border-white/5 text-slate-400 hover:text-white hover:bg-white/10 transition-all cursor-pointer disabled:opacity-25" title="Undo (Ctrl+Z)">
                <Undo2 size={13} />
              </button>
              <button onClick={() => { isUndoingRef.current = true; const s = historyRedo(); if (s) { setNodes(s.nodes); setEdges(s.edges); } setTimeout(() => { isUndoingRef.current = false; }, 50); }}
                disabled={!canRedo()}
                className="nodrag p-1.5 rounded-lg bg-white/5 border border-white/5 text-slate-400 hover:text-white hover:bg-white/10 transition-all cursor-pointer disabled:opacity-25" title="Redo (Ctrl+Y)">
                <Redo2 size={13} />
              </button>

              <div className="w-px h-4 bg-white/10 mx-1" />

              {/* Run / Stop */}
              <button onClick={togglePipeline}
                className={`nodrag px-3 py-1.5 rounded-full text-xs font-bold border transition-all flex items-center gap-1.5 cursor-pointer ${
                  pipelineRunning
                    ? "bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/20"
                    : "bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20"
                }`} title={pipelineRunning ? "Stop pipeline" : "Start pipeline"}>
                {pipelineRunning ? <><Square size={11} fill="currentColor" /> Stop</> : <><Play size={11} fill="currentColor" /> Run</>}
              </button>

              {/* Schedule */}
              <button onClick={() => setScheduleOpen(true)}
                className={`nodrag px-3 py-1.5 rounded-full text-xs font-semibold border transition-all flex items-center gap-1.5 cursor-pointer ${
                  scheduleConfig ? "bg-amber-500/10 border-amber-500/30 text-amber-400" : "bg-white/5 border-white/5 text-slate-400 hover:bg-white/10"
                }`} title="Schedule pipeline">
                <Calendar size={12} />
                {scheduleConfig ? "Scheduled" : "Schedule"}
              </button>

              {/* Replay */}
              <button onClick={() => setReplayOpen(true)}
                className="nodrag px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/10 text-xs font-semibold text-slate-400 border border-white/5 transition-all flex items-center gap-1.5 cursor-pointer" title="Replay past events">
                <Clock size={12} />
                Replay
              </button>

              <div className="w-px h-4 bg-white/10 mx-1" />

              {/* Exports */}
              <button onClick={handleExportN8n} disabled={exportLoading || !nodes.length}
                className="nodrag px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/10 text-xs font-semibold text-slate-300 border border-white/5 transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-40" title="Export as n8n workflow JSON">
                <Download size={12} />
                {exportLoading ? "…" : "n8n"}
              </button>
              <button onClick={handleExportNodeRed} disabled={exportLoading || !nodes.length}
                className="nodrag px-3 py-1.5 rounded-full bg-red-500/10 hover:bg-red-500/20 text-xs font-semibold text-red-400 border border-red-500/20 transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-40" title="Export as Node-RED flow JSON">
                <Download size={12} />
                {exportLoading ? "…" : "Node-RED"}
              </button>

              {/* Privacy */}
              <button onClick={() => setShowPrivacyHud(v => !v)}
                className={`nodrag px-3 py-1.5 rounded-full text-xs font-semibold border transition-all flex items-center gap-1.5 cursor-pointer ${
                  showPrivacyHud ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400" : "bg-white/5 border-white/5 text-slate-400 hover:bg-white/10"
                }`} title="Privacy indicators">
                <Shield size={12} />
              </button>

              <button onClick={() => setVaultOpen(true)}
                className="nodrag px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/10 text-xs font-semibold text-slate-300 border border-white/5 transition-all flex items-center gap-1.5 cursor-pointer">
                Vault
              </button>

              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-[9px] font-bold text-emerald-500 uppercase tracking-widest">NPU</span>
              </div>
            </div>
          </div>
        )}

        {(generateError || exportError) && (
          <div className="absolute top-16 left-4 right-4 z-20 nodrag px-3 py-2 rounded-md text-xs text-red-400 border border-red-500/30 bg-red-950/30">
            {generateError || exportError}
          </div>
        )}

        {/* Privacy HUD legend */}
        {showPrivacyHud && (
          <div
            className="absolute top-16 right-4 z-20 nodrag px-4 py-3 rounded-xl border border-white/10 bg-[#09090d]/95 backdrop-blur-xl shadow-2xl"
            style={{ minWidth: 220 }}
          >
            <p className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-500 mb-2">Data Residency</p>
            {[
              { color: "#4285F4", label: "INPUT", desc: "Data source — local only" },
              { color: "#34A853", label: "LOCAL", desc: "On-device inference" },
              { color: "#FBBC05", label: "GEMINI", desc: "Google Gemini API" },
              { color: "#f97316", label: "CLOUD", desc: "External service" },
            ].map(({ color, label, desc }) => (
              <div key={label} className="flex items-center gap-2 mb-1.5">
                <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color, boxShadow: `0 0 4px ${color}80` }} />
                <span className="text-[9px] font-bold w-12" style={{ color }}>{label}</span>
                <span className="text-[9px] text-slate-500">{desc}</span>
              </div>
            ))}
          </div>
        )}

        {/* ── Live Node-RED Pipeline Results Panel ─────────────────────── */}
        {showPipelinePanel && pipelineResult && (
          <div className="absolute bottom-6 left-6 z-30 nodrag w-80 rounded-2xl border border-white/10 bg-[#09090d]/95 backdrop-blur-xl shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 bg-red-500/5">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.8)] animate-pulse" />
                <span className="text-[10px] font-black uppercase tracking-[0.18em] text-red-400">Node-RED Live</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[9px] text-slate-600">{pipelineResult.timestamp}</span>
                <button onClick={() => setShowPipelinePanel(false)} className="text-slate-600 hover:text-slate-400 cursor-pointer">
                  <X size={12} />
                </button>
              </div>
            </div>

            {/* Snapshot image */}
            {pipelineResult.image && (
              <div className="relative bg-black/40">
                <img
                  src={pipelineResult.image}
                  alt="Pipeline snapshot"
                  className="w-full h-40 object-cover opacity-90"
                  style={{ imageRendering: "auto" }}
                />
                <div className="absolute inset-0 bg-gradient-to-t from-[#09090d]/80 via-transparent to-transparent" />
                {pipelineResult.detection_output && (
                  <div className="absolute bottom-2 left-2 right-2 flex flex-wrap gap-1">
                    {pipelineResult.detection_output.split(",").map((d, i) => d.trim() && (
                      <span key={i} className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-[#4285F4]/80 text-white">
                        {d.trim()}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* VLM analysis */}
            <div className="px-4 py-3">
              <p className="text-[9px] font-black uppercase tracking-[0.15em] text-slate-600 mb-1.5">moondream analysis</p>
              <p className="text-[11px] text-slate-300 leading-relaxed">
                {pipelineResult.vlm_analysis || "Waiting for analysis…"}
              </p>
            </div>

            {/* Stats footer */}
            <div className="px-4 py-2.5 border-t border-white/5 flex items-center justify-between bg-black/20">
              <div className="flex items-center gap-3">
                <span className="text-[9px] text-slate-600">
                  detect: <span className="text-slate-400">{pipelineResult.detection_output || "—"}</span>
                </span>
              </div>
              <span className="text-[9px] text-slate-600">
                {pipelineResult.latency_ms > 0 ? `${(pipelineResult.latency_ms / 1000).toFixed(1)}s` : ""}
              </span>
            </div>
          </div>
        )}

        {/* Pipeline result trigger button (when panel is closed) */}
        {!showPipelinePanel && pipelineResult && (
          <button
            onClick={() => setShowPipelinePanel(true)}
            className="nodrag absolute bottom-6 left-6 z-30 flex items-center gap-2 px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-all cursor-pointer"
          >
            <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
            <span className="text-[10px] font-bold">Node-RED result</span>
          </button>
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
          edges={edgesWithLabels}
          onNodesChange={isDashboard ? undefined : onNodesChange}
          onEdgesChange={isDashboard ? undefined : onEdgesChange}
          onConnect={isDashboard ? undefined : onConnect}
          onNodeContextMenu={isDashboard ? undefined : handleNodeContextMenu}
          onPaneClick={() => setContextMenu(null)}
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
                ipCamera: "#4285F4",
                detection: "#f97316",
                pose: "#f97316",
                faceMatch: "#f97316",
                ocr: "#f97316",
                visualLlm: "#a855f7",
                geminiLive: "#FBBC05",
                toolUse: "#6366F1",
                logic: "#f59e0b",
                llm: "#3b82f6",
                soundAction: "#f97316",
                logAction: "#34A853",
                notifyAction: "#eab308",
                screenshotAction: "#06b6d4",
                webhookAction: "#8b5cf6",
                emailAction: "#3b82f6",
                smsAction: "#14b8a6",
                slackAction: "#4A154B",
                discordAction: "#5865F2",
                mic: "#FBBC05",
                audioDetect: "#8b5cf6",
                audioLlm: "#ec4899",
                whisperStt: "#10b981",
                timer: "#64748b",
                debounce: "#64748b",
                merge: "#64748b",
                script: "#f59e0b",
                mqttAction: "#059669",
                googleSheetsAction: "#34A853",
                speakAction: "#06b6d4",
                fileAction: "#64748b",
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
              onClick={handleAiAutoWire}
              disabled={!backendConnected || aiWireLoading || nodes.length < 2}
              className="px-4 py-2.5 rounded-xl bg-[#4285F4]/10 border border-[#4285F4]/20 text-[#4285F4] text-[10px] font-black uppercase tracking-widest hover:bg-[#4285F4]/20 transition-all flex items-center gap-2 cursor-pointer disabled:opacity-40"
              title="AI-powered auto-connect using Gemini/Gemma3"
            >
              <Sparkles size={12} />
              {aiWireLoading ? "Wiring..." : "AI Auto-Wire"}
            </button>
            <button
              onClick={handleAutoWire}
              className="px-4 py-2.5 rounded-xl bg-slate-800/50 border border-white/5 text-slate-400 text-[10px] font-black uppercase tracking-widest hover:bg-slate-700/50 transition-all flex items-center gap-2 cursor-pointer"
              title="Rule-based fast auto-connect"
            >
              <GitBranch size={12} />
              Quick Wire
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

      {/* Right-click context menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          nodeId={contextMenu.nodeId}
          nodePinned={!!pinnedNodes.find(p => p.id === contextMenu.nodeId)}
          onDuplicate={() => {
            const node = nodes.find(n => n.id === contextMenu.nodeId);
            if (node) {
              const clone = { ...JSON.parse(JSON.stringify(node)), id: `node-${Date.now()}`, position: { x: node.position.x + 40, y: node.position.y + 40 }, selected: false };
              setNodes(nds => [...nds, clone]);
            }
          }}
          onDelete={() => {
            setNodes(nds => nds.filter(n => n.id !== contextMenu.nodeId));
            setEdges(eds => eds.filter(e => e.source !== contextMenu.nodeId && e.target !== contextMenu.nodeId));
          }}
          onPin={() => {
            const node = nodes.find(n => n.id === contextMenu.nodeId);
            if (node) handleTogglePin(node.id, node.type || "Node");
          }}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* Schedule modal */}
      {scheduleOpen && (
        <ScheduleModal
          pipelineName={useWorkflowStore.getState().workflows.find(w => w.id === activeWorkflowId)?.name ?? "Pipeline"}
          activeSchedule={scheduleConfig}
          onSchedule={handleApplySchedule}
          onClear={handleClearSchedule}
          onClose={() => setScheduleOpen(false)}
        />
      )}

      {/* Replay panel */}
      {replayOpen && <ReplayPanel onClose={() => setReplayOpen(false)} />}

      {/* AI Auto-Wire Description Dialog */}
      {aiWireDialogOpen && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-md z-[100] flex items-center justify-center p-6">
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#09090d]/95 shadow-2xl overflow-hidden">
            <div className="px-6 py-5 border-b border-white/5 flex items-center gap-3">
              <div className="p-2 rounded-xl bg-[#4285F4]/10 text-[#4285F4]">
                <Sparkles size={16} />
              </div>
              <div>
                <h2 className="text-sm font-bold text-white">AI Auto-Wire</h2>
                <p className="text-[10px] text-slate-500 mt-0.5">Describe how you want the nodes connected</p>
              </div>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div className="text-[11px] text-slate-400 bg-white/[0.03] rounded-xl p-3 border border-white/5">
                <p className="font-semibold text-slate-300 mb-1">Nodes on canvas:</p>
                <p className="text-slate-500 leading-relaxed">
                  {nodes.map(n => n.type).join(" → ")}
                </p>
              </div>
              <textarea
                autoFocus
                value={aiWireDescription}
                onChange={(e) => setAiWireDescription(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) confirmAiAutoWire(); }}
                placeholder={`e.g. "camera feeds face match, then if matched run object detection, then log results"`}
                rows={3}
                className="nodrag w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-[#4285F4]/40 resize-none transition-all"
              />
              <p className="text-[10px] text-slate-600">
                Leave blank to let the AI decide based on node types alone. Press Ctrl+Enter to confirm.
                Local models (Ollama) may take 1–3 minutes on first use while the model loads.
              </p>
            </div>
            <div className="px-6 py-4 border-t border-white/5 flex items-center justify-end gap-3">
              <button
                onClick={() => { setAiWireDialogOpen(false); setAiWireDescription(""); }}
                className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-400 hover:text-slate-200 hover:bg-white/5 transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={confirmAiAutoWire}
                disabled={!backendConnected}
                className="px-5 py-2 rounded-lg text-xs font-bold bg-[#4285F4] text-white hover:bg-[#3367d6] transition-all disabled:opacity-40 cursor-pointer flex items-center gap-2"
              >
                <Sparkles size={12} />
                {backendConnected ? "Wire with AI" : "Backend Offline"}
              </button>
            </div>
          </div>
        </div>
      )}

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
