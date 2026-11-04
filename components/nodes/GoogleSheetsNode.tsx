"use client";

import React, { useState, useEffect } from "react";
import { Handle, Position, type NodeProps } from "reactflow";
import { Table, Database } from "lucide-react";
import NodeShell from "./NodeShell";
import { useUpstreamTrigger } from "@/lib/useUpstreamTrigger";
import { pipelineSocket } from "@/lib/websocket";
import { useNodeData } from "@/lib/useNodeData";

export default function GoogleSheetsNode({ id, selected, data }: NodeProps) {
  const [spreadsheetId, setSpreadsheetId] = useState(data.spreadsheetId || "");
  const [range, setRange] = useState(data.range || "Sheet1!A1");
  const [status, setStatus] = useState<"idle" | "running" | "error">("idle");

  const updateData = useNodeData(id);
  useEffect(() => {
    updateData({ spreadsheetId, range });
  }, [spreadsheetId, range, updateData]);

  const { sourceOutput, sourceVersion } = useUpstreamTrigger(id, "trigger");

  useEffect(() => {
    if (sourceVersion > 0 && sourceOutput && spreadsheetId) {
      setStatus("running");
      pipelineSocket.send("gsheets_append", {
        spreadsheet_id: spreadsheetId,
        range,
        values: [[new Date().toLocaleString(), sourceOutput]],
        node_id: id
      });
    }
  }, [sourceVersion, sourceOutput, spreadsheetId, range, id]);

  useEffect(() => {
    const unsub = pipelineSocket.on("gsheets_result", (payload: any) => {
      if (payload.node_id === id) {
        setStatus(payload.ok ? "idle" : "error");
      }
    });
    return () => unsub();
  }, [id]);

  return (
    <NodeShell
      accent="#34A853"
      title="Google Sheets"
      icon={<Table size={16} />}
      status={status}
      selected={selected}
      width={320}
    >
      <Handle type="target" position={Position.Left} id="trigger" className="w-3 h-3 bg-[#34A853] border-2 border-[#13131a]" />

      <div className="space-y-4 font-sans">
        <div>
          <label className="text-[10px] text-slate-500 uppercase font-bold tracking-wider mb-1.5 block font-sans">Spreadsheet ID</label>
          <input
            type="text"
            value={spreadsheetId}
            onChange={(e) => setSpreadsheetId(e.target.value)}
            placeholder="1BxiMVs0XRA5nFMdKvBdBJHgmV7..."
            className="w-full bg-[#0a0a0f] border border-[#1e1e2e] rounded-lg px-3 py-1.5 text-xs text-slate-300 outline-none focus:border-[#34A853]/50 nodrag"
          />
        </div>
        <div>
          <label className="text-[10px] text-slate-500 uppercase font-bold tracking-wider mb-1.5 block font-sans">Range</label>
          <input
            type="text"
            value={range}
            onChange={(e) => setRange(e.target.value)}
            placeholder="Sheet1!A:B"
            className="w-full bg-[#0a0a0f] border border-[#1e1e2e] rounded-lg px-3 py-1.5 text-xs text-slate-300 outline-none focus:border-[#34A853]/50 nodrag"
          />
        </div>

        <div className="p-3 rounded-lg bg-[#34A853]/5 border border-[#34A853]/10 flex items-center gap-3 font-sans">
           <Database size={16} className="text-[#34A853]" />
           <p className="text-[10px] text-slate-400 leading-tight font-sans">Appends data as a new row in your cloud spreadsheet.</p>
        </div>
      </div>
    </NodeShell>
  );
}
