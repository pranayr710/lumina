"use client";

import React, { useEffect, useState, useRef, useMemo, useCallback } from "react";
import { Handle, Position, type NodeProps, useEdges } from "reactflow";
import { Eye, Loader } from "lucide-react";
import NodeShell from "./NodeShell";
import { pipelineSocket } from "@/l/websocket";
import { useFrameStore } from "@/l/frameStore";
import { useNodeOutputStore } from "@/l/nodeOutputStore";
import { useNodeData } from "@/l/useNodeData";

export default function VisualLlmNode({ id, selected, data }: NodeProps) {
  const [prompt, setPrompt] = useState<string>(
    data?.prompt || "Describe what you see. If there is any safety concern, explain it."
  );
  const [interval, setInterval_] = useState<number>(data?.interval || 10);
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [latencyMs, setLatencyMs] = useState(0);

  const promptRef = useRef(prompt);
  const processingRef = useRef(false);
  const lastTriggerVersionRef = useRef(0);

  const updateData = useNodeData(id);
  useEffect(() => {
    updateData({ prompt, interval });
  }, [prompt, interval, updateData]);

  useEffect(() => {
    promptRef.current = prompt;
  }, [prompt]);

  const edges = useEdges();

  const connectedCameraId = useMemo(() => {
    const incomingEdge = edges.find(
      (e) => e.target === id && e.targetHandle === "camera"
    );
    return incomingEdge?.source ?? null;
  }, [edges, id]);

  const { triggerNodeId, triggerHandle } = useMemo(() => {
    const incomingEdge = edges.find(
      (e) => e.target === id && e.targetHandle === "trigger"
    );
    return {
      triggerNodeId: incomingEdge?.source ?? null,
      triggerHandle: incomingEdge?.sourceHandle ?? null,
    };
  }, [edges, id]);

  const FRAME_HANDLES = new Set(["frames"]);
  const isValidTrigger = triggerNodeId !== null && !FRAME_HANDLES.has(triggerHandle ?? "");

  const triggerKey = useMemo(() => {
    if (!isValidTrigger || !triggerNodeId) return null;
    if (triggerHandle && triggerHandle !== "response" && triggerHandle !== "output" && triggerHandle !== "detections") {
      return `${triggerNodeId}:${triggerHandle}`;
    }
    return triggerNodeId;
  }, [triggerNodeId, triggerHandle, isValidTrigger]);

  const triggerVersion = useNodeOutputStore(
    (state) => (triggerKey ? (state.versions[triggerKey] ?? 0) : 0)
  );

  useEffect(() => {
    const handler = (data: any) => {
      if (data.node_id === id) {
        setAnalysis(data.analysis);
        setLatencyMs(data.latency_ms || 0);
        setProcessing(false);
        processingRef.current = false;
        useNodeOutputStore.getState().setOutput(id, data.analysis || "");
      }
    };
    pipelineSocket.on("vlm_result", handler);
    return () => pipelineSocket.off("vlm_result", handler);
  }, [id]);

  const fireAnalysis = useCallback(() => {
    if (!connectedCameraId) return;
    const frame = useFrameStore.getState().getFrame(connectedCameraId);
    if (!frame || processingRef.current) return;
    processingRef.current = true;
    setProcessing(true);
    pipelineSocket.sendVlmAnalyze(frame, promptRef.current, id);
  }, [connectedCameraId, id]);

  useEffect(() => {
    if (isValidTrigger) return;
    if (!connectedCameraId || !prompt.trim()) return;

    const initialTimeout = setTimeout(fireAnalysis, 500);
    const timer = setInterval(fireAnalysis, interval * 1000);
    return () => {
      clearTimeout(initialTimeout);
      clearInterval(timer);
    };
  }, [connectedCameraId, interval, prompt, isValidTrigger, fireAnalysis]);

  useEffect(() => {
    if (!isValidTrigger) return;
    if (!connectedCameraId || !prompt.trim()) return;
    if (triggerVersion === 0) return;

    if (triggerVersion === lastTriggerVersionRef.current) return;
    lastTriggerVersionRef.current = triggerVersion;

    const timeout = setTimeout(fireAnalysis, 200);
    return () => clearTimeout(timeout);
  }, [triggerVersion, isValidTrigger, connectedCameraId, prompt, fireAnalysis]);

  const manualAnalyze = useCallback(() => {
    fireAnalysis();
  }, [fireAnalysis]);

  return (
    <NodeShell
      accent="#A855F7"
      title="Visual LLM"
      icon={<Eye size={16} />}
      status={processing ? "running" : analysis ? "running" : "idle"}
      selected={selected}
      width={420}
      id={id}
    >
      <Handle
        type="target"
        position={Position.Left}
        id="camera"
        data-tooltip="camera"
        style={{
          width: 12,
          height: 12,
          background: "#4285F4",
          border: "3px solid #13131a",
          top: "35%",
          zIndex: 50,
        }}
      />

      <Handle
        type="target"
        position={Position.Left}
        id="trigger"
        data-tooltip="trigger"
        style={{
          width: 12,
          height: 12,
          background: "#34A853",
          border: "3px solid #13131a",
          top: "55%",
          zIndex: 50,
        }}
      />

      <div className="flex items-center gap-2 mb-3">
        <span
          className="text-[10px] font-mono px-2.5 py-1 rounded-full"
          style={{
            background: "rgba(168, 85, 247, 0.15)",
            color: "#A855F7",
            border: "1px solid rgba(168, 85, 247, 0.25)",
          }}
        >
          Gemini Preferred
        </span>
        <span
          className="text-[10px] font-mono px-2 py-1 rounded-full"
          style={{
            background: "rgba(52, 168, 83, 0.15)",
            color: "#34A853",
            border: "1px solid rgba(52, 168, 83, 0.25)",
          }}
        >
          ON-DEVICE FALLBACK
        </span>
        {!connectedCameraId && (
          <span className="text-[10px] text-slate-500 ml-auto">
            No camera connected
          </span>
        )}
      </div>

      {isValidTrigger && (
        <div
          className="flex items-center gap-2 rounded-md px-2.5 py-1.5 mb-3 text-[10px] font-sans"
          style={{
            background: "rgba(52, 168, 83, 0.1)",
            border: "1px solid rgba(52, 168, 83, 0.2)",
            color: "#34A853",
          }}
        >
          <div
            className="w-1.5 h-1.5 rounded-full"
            style={{ background: "#34A853", boxShadow: "0 0 4px #34A853" }}
          />
          Trigger-gated — fires only when trigger updates
        </div>
      )}

      {!isValidTrigger && (
        <div className="flex items-center gap-3 mb-3">
          <span className="text-xs text-slate-500 w-16 shrink-0">Interval</span>
          <input
            type="range"
            min={5}
            max={120}
            value={interval}
            onChange={(e) => setInterval_(Number(e.target.value))}
            className="flex-1 h-1.5 accent-purple-400 nodrag nowheel"
          />
          <span className="text-xs text-slate-400 font-mono w-8 text-right">
            {interval}s
          </span>
        </div>
      )}

      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={3}
        className="w-full bg-[#0a0a0f] border border-[#1e1e2e] rounded-lg px-3 py-2.5 text-sm text-slate-300 outline-none focus:border-[#A855F7]/40 resize-none leading-relaxed mb-3 nodrag nowheel font-sans"
        placeholder="What should the AI look for?"
      />

      <button
        onClick={manualAnalyze}
        disabled={processing || !connectedCameraId}
        className="w-full flex items-center justify-center gap-2 py-2 rounded-md text-xs font-medium transition-colors mb-3 nodrag disabled:opacity-30 cursor-pointer"
        style={{
          background: "rgba(168, 85, 247, 0.15)",
          color: "#A855F7",
          border: "1px solid rgba(168, 85, 247, 0.25)",
        }}
      >
        {processing ? (
          <>
            <Loader size={12} className="animate-spin" />
            Analyzing...
          </>
        ) : (
          "Analyze Now"
        )}
      </button>

      <div
        className="rounded-lg p-3 nodrag nowheel font-sans"
        style={{
          background: "#0a0a0f",
          minHeight: 60,
          maxHeight: 200,
          overflowY: "auto",
        }}
      >
        {processing && !analysis ? (
          <div className="flex items-center gap-2 text-sm text-purple-400">
            <Loader size={14} className="animate-spin" />
            Analyzing frame...
          </div>
        ) : analysis ? (
          <p className="text-sm text-slate-300 leading-relaxed">{analysis}</p>
        ) : (
          <p className="text-xs text-slate-600 text-center py-3">
            Connect a camera and set your prompt
          </p>
        )}
      </div>

      {latencyMs > 0 && (
        <div className="mt-2 text-right">
          <span className="text-[10px] font-mono text-slate-500">
            {latencyMs.toFixed(0)}ms
          </span>
        </div>
      )}

      <Handle
        type="source"
        position={Position.Right}
        id="response"
        data-tooltip="response"
        style={{
          width: 12,
          height: 12,
          background: "#A855F7",
          border: "3px solid #13131a",
          zIndex: 50,
        }}
      />
    </NodeShell>
  );
}
