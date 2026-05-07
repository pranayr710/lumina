"use client";

import React, { useEffect, useState } from "react";
import { Handle, Position, type NodeProps } from "reactflow";
import { FileText, Download, Trash2 } from "lucide-react";
import NodeShell from "./NodeShell";
import { useUpstreamTrigger } from "@/l/useUpstreamTrigger";

export default function LogNode({ id, selected }: NodeProps) {
  const [logs, setLogs] = useState<string[]>([]);
  const [triggerCount, setTriggerCount] = useState(0);

  const { sourceOutput, sourceVersion } = useUpstreamTrigger(id, "trigger");

  useEffect(() => {
    if (!sourceOutput || sourceVersion === 0) return;
    const timestamp = new Date().toLocaleTimeString();
    setTriggerCount((c) => c + 1);
    setLogs((prev) => [`[${timestamp}] ${sourceOutput}`, ...prev].slice(0, 100));
  }, [sourceVersion]);

  const exportCSV = () => {
    if (logs.length === 0) return;
    const header = "timestamp,message\n";
    const rows = logs
      .map((log) => {
        const bracketEnd = log.indexOf("] ");
        const ts = bracketEnd > 0 ? log.slice(1, bracketEnd) : "";
        const msg = bracketEnd > 0 ? log.slice(bracketEnd + 2) : log;
        return `"${ts}","${msg.replace(/"/g, '""')}"`;
      })
      .join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `lumina-log-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <NodeShell
      accent="#34A853"
      title="Console Log"
      icon={<FileText size={16} />}
      status={triggerCount > 0 ? "running" : "idle"}
      selected={selected}
      width={380}
      id={id}
    >
      <Handle
        type="target"
        position={Position.Left}
        id="trigger"
        data-tooltip="trigger"
        style={{
          width: 14,
          height: 14,
          background: "#f59e0b",
          border: "3px solid #13131a",
          zIndex: 50,
        }}
      />

      <div className="flex gap-2 mb-3 font-sans">
        <button
          onClick={exportCSV}
          disabled={logs.length === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors nodrag disabled:opacity-40 cursor-pointer"
          style={{ background: "rgba(52, 168, 83, 0.15)", color: "#34A853", border: "1px solid rgba(52, 168, 83, 0.25)" }}
        >
          <Download size={12} />
          Export CSV
        </button>
        <button
          onClick={() => { setLogs([]); setTriggerCount(0); }}
          disabled={logs.length === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors nodrag disabled:opacity-40 cursor-pointer"
          style={{ background: "#ef444415", color: "#ef4444", border: "1px solid #ef444425" }}
        >
          <Trash2 size={12} />
          Clear
        </button>
      </div>

      <div
        className="rounded-lg p-3 space-y-1 nodrag nowheel font-sans"
        style={{
          background: "#0a0a0f",
          minHeight: 120,
          maxHeight: 300,
          overflowY: "auto",
        }}
      >
        {logs.length === 0 ? (
          <p className="text-sm text-slate-600 text-center py-4">
            No triggers yet
          </p>
        ) : (
          logs.map((log, i) => (
            <p
              key={i}
              className="text-sm text-slate-300 font-mono leading-relaxed"
              style={{ wordBreak: "break-word" }}
            >
              {log}
            </p>
          ))
        )}
      </div>

      <div className="mt-3 text-right">
        <span className="text-xs font-mono text-emerald-500/70">{triggerCount} triggers</span>
      </div>
    </NodeShell>
  );
}
