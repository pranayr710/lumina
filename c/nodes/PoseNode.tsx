"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Handle, Position, type NodeProps, useEdges } from "reactflow";
import { Accessibility, ShieldAlert } from "lucide-react";
import NodeShell from "./NodeShell";
import { pipelineSocket } from "@/l/websocket";
import { useFrameStore } from "@/l/frameStore";
import { useNodeOutputStore } from "@/l/nodeOutputStore";
import { useNodeData } from "@/l/useNodeData";

export default function PoseNode({ id, selected, data }: NodeProps) {
  const [confidence, setConfidence] = useState(data.confidence || 45);
  const [interval, setIntervalVal] = useState(data.interval || 2);
  const [isFall, setIsFall] = useState(false);
  const [latencyMs, setLatencyMs] = useState(0);

  const updateData = useNodeData(id);
  useEffect(() => {
    updateData({ confidence, interval });
  }, [confidence, interval, updateData]);

  const edges = useEdges();
  const camEdge = edges.find(e => e.target === id && e.targetHandle === "camera");
  const sourceNodeId = camEdge?.source || null;

  const runPose = useCallback(() => {
    if (!sourceNodeId) return;
    const frame = useFrameStore.getState().frames[sourceNodeId];
    if (!frame) return;

    pipelineSocket.send("pose_detect", {
      node_id: id,
      image: frame,
      confidence: confidence / 100
    });
  }, [id, sourceNodeId, confidence]);

  useEffect(() => {
    const timer = setInterval(runPose, interval * 1000);
    return () => clearInterval(timer);
  }, [interval, runPose]);

  useEffect(() => {
    const unsub = pipelineSocket.on("pose_result", (payload: any) => {
      if (payload.node_id === id) {
        setIsFall(payload.is_fall);
        setLatencyMs(payload.latency_ms || 0);
        
        const result = payload.is_fall ? "fall_detected" : "safe";
        useNodeOutputStore.getState().setOutput(id, result);
        
        if (payload.is_fall) {
            useNodeOutputStore.getState().setOutput(`${id}:fall`, "FALL DETECTED");
        }
      }
    });
    return () => unsub();
  }, [id]);

  return (
    <NodeShell
      accent="#34A853"
      title="Pose / Safety"
      icon={<Accessibility size={16} />}
      status={isFall ? "error" : "idle"}
      selected={selected}
      width={300}
    >
      <Handle type="target" position={Position.Left} id="camera" className="w-3 h-3 bg-[#4285F4] border-2 border-[#13131a]" />

      <div className="space-y-4 font-sans">
        <div>
          <div className="flex justify-between items-center mb-1.5 font-sans">
            <label className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Confidence</label>
            <span className="text-[10px] font-mono text-teal-400">{confidence}%</span>
          </div>
          <input
            type="range"
            min={10}
            max={95}
            value={confidence}
            onChange={(e) => setConfidence(parseInt(e.target.value))}
            className="w-full h-1.5 accent-teal-500 nodrag nowheel"
          />
        </div>

        <div>
          <div className="flex justify-between items-center mb-1.5 font-sans">
            <label className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Interval</label>
            <span className="text-[10px] font-mono text-teal-400">{interval}s</span>
          </div>
          <input
            type="range"
            min={1}
            max={10}
            value={interval}
            onChange={(e) => setIntervalVal(parseInt(e.target.value))}
            className="w-full h-1.5 accent-teal-500 nodrag nowheel"
          />
        </div>

        <div className={`p-4 rounded-xl flex items-center gap-4 transition-colors font-sans ${isFall ? "bg-red-500/10 border border-red-500/20" : "bg-black/20 border border-white/5"}`}>
          <div className={`p-2 rounded-lg ${isFall ? "bg-red-500 text-white animate-pulse" : "bg-slate-800 text-slate-500"}`}>
            {isFall ? <ShieldAlert size={20} /> : <Accessibility size={20} />}
          </div>
          <div>
            <p className={`text-[10px] font-bold uppercase tracking-wider ${isFall ? "text-red-400" : "text-slate-500"}`}>
              {isFall ? "Potential Fall Detected" : "Status: Normal"}
            </p>
            {latencyMs > 0 && <p className="text-[9px] font-mono text-slate-600">{latencyMs}ms latency</p>}
          </div>
        </div>
      </div>

      <Handle type="source" position={Position.Right} id="output" className="w-3 h-3 bg-teal-500 border-2 border-[#13131a]" />
      <Handle type="source" position={Position.Right} id="fall" style={{ top: "80%", background: "#ef4444", border: "2px solid #13131a" }} />
    </NodeShell>
  );
}
