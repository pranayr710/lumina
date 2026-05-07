"use client";

import React, { useEffect, useState, useRef, useMemo, useCallback } from "react";
import { Handle, Position, type NodeProps, useEdges } from "reactflow";
import { Zap, Loader, Radio } from "lucide-react";
import NodeShell from "./NodeShell";
import { pipelineSocket } from "@/l/websocket";
import { useFrameStore } from "@/l/frameStore";
import { useNodeOutputStore } from "@/l/nodeOutputStore";
import { useNodeData } from "@/l/useNodeData";

export default function GeminiLiveNode({ id, selected, data }: NodeProps) {
  const [systemPrompt, setSystemPrompt] = useState<string>(
    data?.system_prompt || "Analyze each frame in real-time. Describe what you see and note any changes."
  );
  const [interval, setInterval_] = useState<number>(data?.interval || 3);
  const [response, setResponse] = useState<string | null>(null);
  const [active, setActive] = useState(false);
  const [latencyMs, setLatencyMs] = useState(0);
  const [sessionMode, setSessionMode] = useState<string>("—");

  const promptRef = useRef(systemPrompt);
  const activeRef = useRef(false);
  const sessionStartedRef = useRef(false);

  const updateData = useNodeData(id);
  useEffect(() => { updateData({ system_prompt: systemPrompt, interval }); }, [systemPrompt, interval, updateData]);
  useEffect(() => { promptRef.current = systemPrompt; }, [systemPrompt]);

  const edges = useEdges();
  const connectedCameraId = useMemo(() => {
    return edges.find((e) => e.target === id && e.targetHandle === "camera")?.source ?? null;
  }, [edges, id]);

  // Listen for live responses
  useEffect(() => {
    const handler = (d: any) => {
      if (d.node_id !== id) return;
      setResponse(d.text);
      setLatencyMs(d.latency_ms || 0);
      setActive(false);
      activeRef.current = false;
      useNodeOutputStore.getState().setOutput(id, d.text || "");
    };
    const startedHandler = (d: any) => {
      if (d.node_id !== id) return;
      setSessionMode(d.ok ? "live" : "error");
    };
    pipelineSocket.on("gemini_live_response", handler);
    pipelineSocket.on("gemini_live_started", startedHandler);
    return () => {
      pipelineSocket.off("gemini_live_response", handler);
      pipelineSocket.off("gemini_live_started", startedHandler);
    };
  }, [id]);

  const startSession = useCallback(() => {
    if (sessionStartedRef.current) return;
    sessionStartedRef.current = true;
    pipelineSocket.send("gemini_live_start", {
      node_id: id,
      system_prompt: promptRef.current,
    });
  }, [id]);

  const stopSession = useCallback(() => {
    sessionStartedRef.current = false;
    pipelineSocket.send("gemini_live_stop", { node_id: id });
    setSessionMode("—");
  }, [id]);

  const sendFrame = useCallback(() => {
    if (!connectedCameraId || activeRef.current) return;
    const frame = useFrameStore.getState().getFrame(connectedCameraId);
    if (!frame) return;
    activeRef.current = true;
    setActive(true);
    pipelineSocket.send("gemini_live_frame", {
      node_id: id,
      image: frame,
      prompt: promptRef.current,
    });
  }, [connectedCameraId, id]);

  // Auto-start session when camera is connected
  useEffect(() => {
    if (connectedCameraId && !sessionStartedRef.current) {
      startSession();
    }
    return () => {
      if (sessionStartedRef.current) stopSession();
    };
  }, [connectedCameraId, startSession, stopSession]);

  // Periodic frame sending
  useEffect(() => {
    if (!connectedCameraId) return;
    const timer = setInterval(sendFrame, interval * 1000);
    return () => clearInterval(timer);
  }, [connectedCameraId, interval, sendFrame]);

  const modeColor = sessionMode === "live" ? "#FBBC05" : sessionMode === "error" ? "#ef4444" : "#334155";
  const modeLabel = sessionMode === "live" ? "Live Stream" : sessionMode === "error" ? "Error" : "Standard API";

  return (
    <NodeShell
      accent="#FBBC05"
      title="Gemini Live"
      icon={<Zap size={16} />}
      status={active ? "running" : response ? "running" : "idle"}
      selected={selected}
      width={420}
      id={id}
      inferenceMode="gemini"
    >
      <Handle
        type="target" position={Position.Left} id="camera"
        style={{ width: 12, height: 12, background: "#4285F4", border: "3px solid #13131a", top: "35%", zIndex: 50 }}
      />
      <Handle
        type="target" position={Position.Left} id="audio"
        style={{ width: 12, height: 12, background: "#FBBC05", border: "3px solid #13131a", top: "55%", zIndex: 50 }}
      />

      {/* Mode badge */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <span
          className="text-[10px] font-mono px-2.5 py-1 rounded-full flex items-center gap-1.5"
          style={{ background: "rgba(251,188,5,0.15)", color: "#FBBC05", border: "1px solid rgba(251,188,5,0.25)" }}
        >
          <Radio size={10} className={sessionMode === "live" ? "animate-pulse" : ""} />
          {modeLabel}
        </span>
        {!connectedCameraId && (
          <span className="text-[10px] text-slate-500 ml-auto">No camera connected</span>
        )}
      </div>

      {/* Interval slider */}
      <div className="flex items-center gap-3 mb-3">
        <span className="text-xs text-slate-500 w-16 shrink-0">Interval</span>
        <input
          type="range" min={1} max={30} value={interval}
          onChange={(e) => setInterval_(Number(e.target.value))}
          className="flex-1 h-1.5 accent-yellow-400 nodrag nowheel"
        />
        <span className="text-xs text-slate-400 font-mono w-8 text-right">{interval}s</span>
      </div>

      <textarea
        value={systemPrompt}
        onChange={(e) => setSystemPrompt(e.target.value)}
        rows={3}
        className="w-full bg-[#0a0a0f] border border-[#1e1e2e] rounded-lg px-3 py-2.5 text-sm text-slate-300 outline-none focus:border-yellow-400/40 resize-none leading-relaxed mb-3 nodrag nowheel font-sans"
        placeholder="System prompt for continuous analysis..."
      />

      {/* Controls */}
      <div className="flex gap-2 mb-3">
        <button
          onClick={startSession}
          disabled={sessionStartedRef.current}
          className="flex-1 py-1.5 rounded-md text-xs font-medium nodrag cursor-pointer disabled:opacity-30 transition-colors"
          style={{ background: "rgba(251,188,5,0.15)", color: "#FBBC05", border: "1px solid rgba(251,188,5,0.25)" }}
        >
          Start Session
        </button>
        <button
          onClick={stopSession}
          className="flex-1 py-1.5 rounded-md text-xs font-medium nodrag cursor-pointer transition-colors"
          style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.2)" }}
        >
          Stop
        </button>
      </div>

      {/* Response output */}
      <div
        className="rounded-lg p-3 nodrag nowheel font-sans"
        style={{ background: "#0a0a0f", minHeight: 60, maxHeight: 180, overflowY: "auto" }}
      >
        {active && !response ? (
          <div className="flex items-center gap-2 text-sm text-yellow-400">
            <Loader size={14} className="animate-spin" />
            Analyzing...
          </div>
        ) : response ? (
          <p className="text-sm text-slate-300 leading-relaxed">{response}</p>
        ) : (
          <p className="text-xs text-slate-600 text-center py-3">
            Connect a camera to begin real-time analysis
          </p>
        )}
      </div>

      {latencyMs > 0 && (
        <div className="mt-2 flex items-center justify-between">
          <span className="text-[10px] text-slate-600">
            {sessionMode === "live" ? "Bidirectional stream" : "Per-frame API"}
          </span>
          <span className="text-[10px] font-mono text-slate-500">{latencyMs.toFixed(0)}ms</span>
        </div>
      )}

      <Handle
        type="source" position={Position.Right} id="response"
        style={{ width: 12, height: 12, background: "#FBBC05", border: "3px solid #13131a", zIndex: 50 }}
      />
    </NodeShell>
  );
}
