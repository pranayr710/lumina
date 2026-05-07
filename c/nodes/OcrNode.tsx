"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Handle, Position, type NodeProps, useEdges } from "reactflow";
import { Type, Scan, Loader } from "lucide-react";
import NodeShell from "./NodeShell";
import { pipelineSocket } from "@/l/websocket";
import { useFrameStore } from "@/l/frameStore";
import { useNodeOutputStore } from "@/l/nodeOutputStore";
import { useNodeData } from "@/l/useNodeData";
import { useUpstreamTrigger } from "@/l/useUpstreamTrigger";

export default function OcrNode({ id, selected, data }: NodeProps) {
  const [interval, setIntervalVal] = useState<number>(data?.interval || 0);
  const [output, setOutput] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  
  const updateData = useNodeData(id);
  useEffect(() => {
    updateData({ interval });
  }, [interval, updateData]);

  const edges = useEdges();
  const camEdge = edges.find(e => e.target === id && e.targetHandle === "camera");
  const sourceNodeId = camEdge?.source || null;

  const { sourceVersion: triggerVersion } = useUpstreamTrigger(id, "trigger");

  const runOcr = useCallback(() => {
    if (!sourceNodeId || processing) return;
    const frame = useFrameStore.getState().frames[sourceNodeId];
    if (!frame) return;

    setProcessing(true);
    const ocrPrompt = "Act as an OCR engine. Extract all visible text from this image. Format as plain text. If there is a license plate, serial number, or document, transcribe it exactly. Return ONLY the extracted text.";
    
    pipelineSocket.send("vlm_analyze", {
      node_id: id,
      prompt: ocrPrompt,
      image: frame
    });
  }, [id, sourceNodeId, processing]);

  useEffect(() => {
    if (interval <= 0) return;
    const timer = setInterval(runOcr, interval * 1000);
    return () => clearInterval(timer);
  }, [interval, runOcr]);

  useEffect(() => {
    if (triggerVersion > 0) runOcr();
  }, [triggerVersion, runOcr]);

  useEffect(() => {
    const unsub = pipelineSocket.on("vlm_result", (payload: any) => {
      if (payload.node_id === id) {
        setOutput(payload.analysis);
        setProcessing(false);
        useNodeOutputStore.getState().setOutput(id, payload.analysis);
      }
    });
    return () => unsub();
  }, [id]);

  return (
    <NodeShell
      accent="#a855f7"
      title="OCR / Text Extract"
      icon={<Type size={16} />}
      status={processing ? "running" : "idle"}
      selected={selected}
      width={320}
    >
      <Handle type="target" position={Position.Left} id="camera" style={{ top: "30%", background: "#4285F4" }} />
      <Handle type="target" position={Position.Left} id="trigger" style={{ top: "70%", background: "#FBBC05" }} />

      <div className="space-y-4 font-sans">
        <div>
          <div className="flex justify-between items-center mb-1.5 font-sans">
            <label className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Interval</label>
            <span className="text-[10px] font-mono text-purple-400">{interval > 0 ? `${interval}s` : "Manual only"}</span>
          </div>
          <input
            type="range"
            min={0}
            max={60}
            step={5}
            value={interval}
            onChange={(e) => setIntervalVal(parseInt(e.target.value))}
            className="w-full h-1.5 accent-purple-500 nodrag nowheel animate-pulse"
          />
        </div>

        <div className="bg-black/20 rounded-lg p-3 min-h-[80px] flex flex-col items-center justify-center border border-white/5 relative group font-sans">
          {processing ? (
            <div className="flex flex-col items-center gap-2 font-sans">
              <Loader size={20} className="animate-spin text-purple-500" />
              <span className="text-[10px] text-purple-400 animate-pulse font-sans">Extracting text...</span>
            </div>
          ) : output ? (
            <p className="text-xs text-slate-300 font-mono leading-relaxed text-center break-words w-full italic">
              "{output}"
            </p>
          ) : (
            <div className="text-center font-sans">
              <Scan size={24} className="text-slate-700 mx-auto mb-2 group-hover:text-purple-500/50 transition-colors" />
              <p className="text-[10px] text-slate-600 uppercase font-sans">Waiting for trigger</p>
            </div>
          )}
        </div>
      </div>

      <Handle type="source" position={Position.Right} id="output" className="w-3 h-3 bg-purple-500 border-2 border-[#13131a]" />
    </NodeShell>
  );
}
