"use client";

import React, { useEffect, useState, useRef, useMemo } from "react";
import { Handle, Position, type NodeProps, useEdges } from "reactflow";
import { ScanSearch, Loader, CheckCircle, XCircle, Eye, EyeOff } from "lucide-react";
import NodeShell from "./NodeShell";
import { pipelineSocket } from "@/lib/websocket";
import { useFrameStore } from "@/lib/frameStore";
import { useNodeOutputStore } from "@/lib/nodeOutputStore";
import { useNodeData } from "@/lib/useNodeData";

interface Detection {
  label: string;
  confidence: number;
  bbox?: [number, number, number, number];
}

export default function DetectionNode({ id, selected, data }: NodeProps) {
  const [confidence, setConfidence] = useState<number>(
    data?.confidence ?? 45
  );
  const [interval, setInterval_] = useState<number>(data?.interval ?? 2);
  const [detections, setDetections] = useState<Detection[]>([]);
  const [processing, setProcessing] = useState(false);
  const [latencyMs, setLatencyMs] = useState(0);
  const [filterText, setFilterText] = useState<string>(data?.filterLabels ?? "");
  const [retrigger, setRetrigger] = useState(data?.retrigger ?? true);
  const [lastMatch, setLastMatch] = useState<boolean | null>(null);
  const [showBoxes, setShowBoxes] = useState(false);

  const processingRef = useRef(false);
  const lastOutputRef = useRef<string | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);

  const updateData = useNodeData(id);
  useEffect(() => {
    updateData({ confidence, interval, filterLabels: filterText, retrigger });
  }, [confidence, interval, filterText, retrigger, updateData]);

  const filterLabels = useMemo(() => {
    if (!filterText.trim()) return null;
    return filterText
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0);
  }, [filterText]);

  const edges = useEdges();

  const connectedCameraId = useMemo(() => {
    const incomingEdge = edges.find(
      (e) => e.target === id && e.targetHandle === "camera"
    );
    return incomingEdge?.source ?? null;
  }, [edges, id]);

  const filteredDetections = useMemo(() => {
    if (!filterLabels || filterLabels.length === 0) return detections;
    return detections.filter((d) =>
      filterLabels.some((f) => d.label.toLowerCase().includes(f))
    );
  }, [detections, filterLabels]);

  useEffect(() => {
    const handler = (payload: any) => {
      if (payload.node_id === id) {
        const dets: Detection[] = payload.detections || [];
        setDetections(dets);
        setLatencyMs(payload.latency_ms || 0);
        setProcessing(false);
        processingRef.current = false;
      }
    };
    pipelineSocket.on("detect_result", handler);
    return () => pipelineSocket.off("detect_result", handler);
  }, [id]);

  useEffect(() => {
    const matched = filteredDetections.length > 0;
    setLastMatch(matched);

    const outputText = matched
      ? filteredDetections.map((d) => `${d.label} ${(d.confidence * 100).toFixed(0)}%`).join(", ")
      : "nothing detected";

    if (!retrigger && outputText === lastOutputRef.current) return;
    lastOutputRef.current = outputText;

    const store = useNodeOutputStore.getState();
    if (matched) {
      store.setOutput(`${id}:match`, outputText);
    } else {
      store.setOutput(`${id}:no_match`, outputText);
    }
  }, [filteredDetections, id, retrigger]);

  useEffect(() => {
    if (!connectedCameraId) return;

    const detect = () => {
      const frame = useFrameStore.getState().getFrame(connectedCameraId);
      if (!frame || processingRef.current) return;
      processingRef.current = true;
      setProcessing(true);
      pipelineSocket.sendDetect(frame, id, confidence / 100);
    };

    const initialTimeout = setTimeout(detect, 500);
    const timer = setInterval(detect, interval * 1000);
    return () => {
      clearTimeout(initialTimeout);
      clearInterval(timer);
    };
  }, [connectedCameraId, interval, id, confidence]);

  const detectionsRef = useRef<Detection[]>([]);
  detectionsRef.current = filteredDetections;

  useEffect(() => {
    if (!showBoxes || !connectedCameraId) return;

    const canvas = overlayCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let drawing = false;

    const img = new Image();
    const drawFrame = () => {
      if (drawing) return;
      const frame = useFrameStore.getState().getFrame(connectedCameraId);
      if (!frame) return;

      drawing = true;
      img.onload = () => {
        const w = canvas.width;
        const h = canvas.height;
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);

        const dets = detectionsRef.current;
        for (const det of dets) {
          if (!det.bbox) continue;
          const [x1, y1, x2, y2] = det.bbox;
          const bx = x1 * w;
          const by = y1 * h;
          const bw = (x2 - x1) * w;
          const bh = (y2 - y1) * h;

          const color = det.confidence >= 0.75 ? "#10b981" : det.confidence >= 0.5 ? "#f59e0b" : "#ef4444";

          ctx.strokeStyle = color;
          ctx.lineWidth = 2;
          ctx.strokeRect(bx, by, bw, bh);

          const label = `${det.label} ${(det.confidence * 100).toFixed(0)}%`;
          ctx.font = "bold 11px monospace";
          const textWidth = ctx.measureText(label).width;
          ctx.fillStyle = color;
          ctx.fillRect(bx, by - 18, textWidth + 8, 18);

          ctx.fillStyle = "#000";
          ctx.fillText(label, bx + 4, by - 5);
        }
        drawing = false;
      };
      img.onerror = () => { drawing = false; };
      img.src = "data:image/jpeg;base64," + frame;
    };

    drawFrame();
    const timer = setInterval(drawFrame, 150);

    return () => clearInterval(timer);
  }, [showBoxes, connectedCameraId]);

  const confColor = (c: number) => {
    if (c >= 0.75) return "#10b981";
    if (c >= 0.5) return "#f59e0b";
    return "#ef4444";
  };

  return (
    <NodeShell
      accent="#f97316"
      title="Object Detect"
      icon={<ScanSearch size={16} />}
      status={processing ? "running" : detections.length > 0 ? "running" : "idle"}
      selected={selected}
      width={340}
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
          zIndex: 50,
        }}
      />

      <div className="flex items-center gap-2 mb-3">
        <span
          className="text-[10px] font-mono px-2.5 py-1 rounded-full"
          style={{
            background: "rgba(249, 115, 22, 0.15)",
            color: "#f97316",
            border: "1px solid rgba(249, 115, 22, 0.25)",
          }}
        >
          YOLOv8n &middot; ONNX
        </span>
        <span className="npu-badge text-[8px] font-black px-2 py-0.5 rounded-md uppercase tracking-wider">
          NPU Accelerated
        </span>
        {!connectedCameraId && (
          <span className="text-[10px] text-slate-500 ml-auto">
            No camera connected
          </span>
        )}
        {connectedCameraId && (
          <button
            onClick={() => setShowBoxes((v) => !v)}
            className="ml-auto flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-mono transition-colors nodrag cursor-pointer"
            style={{
              background: showBoxes ? "rgba(249, 115, 22, 0.25)" : "#1e1e2e",
              color: showBoxes ? "#f97316" : "#64748b",
              border: `1px solid ${showBoxes ? "rgba(249, 115, 22, 0.40)" : "#2a2a3a"}`,
            }}
            title={showBoxes ? "Hide bounding boxes" : "Show bounding boxes"}
          >
            {showBoxes ? <Eye size={11} /> : <EyeOff size={11} />}
            Boxes
          </button>
        )}
      </div>

      {showBoxes && connectedCameraId && (
        <div
          className="relative rounded-lg overflow-hidden mb-3"
          style={{ background: "#0a0a0f", aspectRatio: "16/9" }}
        >
          <canvas
            ref={overlayCanvasRef}
            width={640}
            height={360}
            className="w-full h-full object-cover"
          />
          {filteredDetections.length > 0 && (
            <div className="absolute top-1.5 left-1.5 bg-black/70 text-[9px] text-orange-400 px-1.5 py-0.5 rounded font-mono">
              {filteredDetections.length} object{filteredDetections.length !== 1 ? "s" : ""}
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-3 mb-2">
        <span className="text-xs text-slate-500 w-16 shrink-0">
          Confidence
        </span>
        <input
          type="range"
          min={10}
          max={95}
          value={confidence}
          onChange={(e) => setConfidence(Number(e.target.value))}
          className="flex-1 h-1.5 accent-orange-400 nodrag nowheel"
        />
        <span className="text-xs text-slate-400 font-mono w-10 text-right">
          {confidence}%
        </span>
      </div>

      <div className="flex items-center gap-3 mb-3">
        <span className="text-xs text-slate-500 w-16 shrink-0">Interval</span>
        <input
          type="range"
          min={1}
          max={30}
          value={interval}
          onChange={(e) => setInterval_(Number(e.target.value))}
          className="flex-1 h-1.5 accent-orange-400 nodrag nowheel"
        />
        <span className="text-xs text-slate-400 font-mono w-10 text-right">
          {interval}s
        </span>
      </div>

      <div className="mb-3">
        <span className="text-xs text-slate-500 block mb-1.5">
          Filter objects
        </span>
        <input
          type="text"
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          placeholder="e.g. person, car, dog"
          className="w-full bg-[#0a0a0f] border border-[#1e1e2e] rounded-lg px-3 py-2 text-sm text-slate-300 outline-none focus:border-orange-500/40 font-mono nodrag nowheel"
        />
      </div>

      <label className="flex items-center gap-2 mb-3 cursor-pointer nodrag select-none">
        <button
          onClick={() => setRetrigger(!retrigger)}
          className="w-8 h-[18px] rounded-full relative transition-colors nodrag cursor-pointer"
          style={{
            background: retrigger ? "rgba(249, 115, 22, 0.4)" : "#1e1e2e",
            border: `1px solid ${retrigger ? "rgba(249, 115, 22, 0.5)" : "#2a2a3a"}`,
          }}
        >
          <div
            className="absolute top-[2px] w-3 h-3 rounded-full transition-all"
            style={{
              background: retrigger ? "#f97316" : "#64748b",
              left: retrigger ? 14 : 2,
            }}
          />
        </button>
        <span className="text-[11px] text-slate-400 font-sans">
          Fire every detection cycle
        </span>
      </label>

      <div
        className="rounded-lg p-3 nodrag nowheel font-sans"
        style={{
          background: "#0a0a0f",
          minHeight: 50,
          maxHeight: 180,
          overflowY: "auto",
        }}
      >
        {processing && detections.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-orange-400">
            <Loader size={14} className="animate-spin" />
            Detecting objects...
          </div>
        ) : filteredDetections.length > 0 ? (
          <div className="space-y-1.5">
            {filteredDetections.map((d, i) => (
              <div
                key={`${d.label}-${i}`}
                className="flex items-center justify-between text-xs"
              >
                <span className="text-slate-300 capitalize">{d.label}</span>
                <span
                  className="font-mono"
                  style={{ color: confColor(d.confidence) }}
                >
                  {(d.confidence * 100).toFixed(0)}%
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-slate-600 text-center py-2">
            {connectedCameraId
              ? detections.length > 0 && filteredDetections.length === 0
                ? `No matches for "${filterText}" (${detections.length} filtered out)`
                : "No objects detected"
              : "Connect a camera to start detection"}
          </p>
        )}
      </div>

      {lastMatch !== null && (
        <div
          className="flex items-center gap-2 rounded-md px-3 py-2 mt-2 font-sans"
          style={{
            background: lastMatch ? "#10b98115" : "#ef444415",
            border: `1px solid ${lastMatch ? "#10b98125" : "#ef444425"}`,
          }}
        >
          {lastMatch ? (
            <CheckCircle size={14} className="text-emerald-400" />
          ) : (
            <XCircle size={14} className="text-red-400" />
          )}
          <span
            className="text-xs font-medium"
            style={{ color: lastMatch ? "#10b981" : "#ef4444" }}
          >
            {lastMatch ? "MATCH" : "NO MATCH"}
          </span>
          <span className="text-[10px] text-slate-500 ml-auto font-mono">
            {filteredDetections.length} object{filteredDetections.length !== 1 ? "s" : ""}
          </span>
        </div>
      )}

      {latencyMs > 0 && (
        <div className="mt-1 text-right">
          <span className="text-[10px] font-mono text-slate-500">
            {latencyMs.toFixed(0)}ms
          </span>
        </div>
      )}

      <Handle
        type="source"
        position={Position.Right}
        id="match"
        data-tooltip="match"
        style={{
          width: 12,
          height: 12,
          background: "#10b981",
          border: "3px solid #13131a",
          top: "40%",
          zIndex: 50,
        }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="no_match"
        data-tooltip="no match"
        style={{
          width: 12,
          height: 12,
          background: "#ef4444",
          border: "3px solid #13131a",
          top: "65%",
          zIndex: 50,
        }}
      />
    </NodeShell>
  );
}
