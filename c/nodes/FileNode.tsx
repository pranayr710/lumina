"use client";

import React, { useState, useEffect } from "react";
import { Handle, Position, type NodeProps } from "reactflow";
import { FileOutput, FolderOpen, CheckCircle2 } from "lucide-react";
import NodeShell from "./NodeShell";
import { useUpstreamTrigger } from "@/l/useUpstreamTrigger";
import { pipelineSocket } from "@/l/websocket";
import { useNodeData } from "@/l/useNodeData";

export default function FileNode({ id, selected, data }: NodeProps) {
  const [filePath, setFilePath] = useState(data?.filePath || "logs/detections.csv");
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "running" | "error">("idle");

  const updateData = useNodeData(id);
  useEffect(() => {
    updateData({ filePath });
  }, [filePath, updateData]);

  const { sourceOutput, sourceVersion } = useUpstreamTrigger(id, "trigger");

  useEffect(() => {
    if (sourceVersion === 0 || !sourceOutput) return;

    setStatus("running");
    pipelineSocket.send("file_append", {
      path: filePath,
      content: sourceOutput
    });
  }, [sourceVersion, sourceOutput, filePath]);

  useEffect(() => {
    const unsub = pipelineSocket.on("file_result", (payload: any) => {
      if (payload.success) {
        setStatus("idle");
        setLastSaved(new Date().toLocaleTimeString());
      } else {
        setStatus("error");
      }
    });
    return () => unsub();
  }, []);

  return (
    <NodeShell
      accent="#64748b"
      title="File System Output"
      icon={<FileOutput size={16} />}
      status={status}
      selected={selected}
      width={320}
    >
      <Handle
        type="target"
        position={Position.Left}
        id="trigger"
        className="w-3 h-3 bg-slate-500 border-2 border-[#13131a]"
      />

      <div className="space-y-4 font-sans">
        <div>
          <label className="text-[10px] text-slate-500 uppercase font-bold tracking-wider mb-2 block font-sans">
            Target File Path
          </label>
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <input
                type="text"
                value={filePath}
                onChange={(e) => setFilePath(e.target.value)}
                className="w-full bg-[#0a0a0f] border border-[#282838] rounded-lg px-3 py-2 text-xs font-mono text-slate-300 outline-none focus:border-slate-500/50 nodrag font-sans"
              />
            </div>
            <div className="p-2 bg-slate-800/50 rounded-lg text-slate-500">
              <FolderOpen size={14} />
            </div>
          </div>
        </div>

        <div className="bg-black/20 rounded-lg p-3 border border-white/5 font-sans">
          <div className="flex items-center justify-between mb-2 font-sans">
             <span className="text-[10px] text-slate-500 uppercase">Status</span>
             {lastSaved && (
                <span className="text-[9px] text-emerald-500 flex items-center gap-1">
                  <CheckCircle2 size={10} />
                  Saved {lastSaved}
                </span>
             )}
          </div>
          <div className="text-[10px] text-slate-400 leading-relaxed font-mono truncate">
            {status === "running" ? "Writing to disk..." : status === "error" ? "Write failed!" : `Appends to: ${filePath}`}
          </div>
        </div>
        
        <p className="text-[9px] text-slate-600 italic font-sans">
          Files are saved relative to the backend workspace root.
        </p>
      </div>
    </NodeShell>
  );
}
