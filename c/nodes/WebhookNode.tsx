"use client";

import React, { useEffect, useState } from "react";
import { Handle, Position, type NodeProps } from "reactflow";
import { Webhook } from "lucide-react";
import NodeShell from "./NodeShell";
import { useUpstreamTrigger } from "@/l/useUpstreamTrigger";
import { useNodeData } from "@/l/useNodeData";

export default function WebhookNode({ id, selected, data }: NodeProps) {
  const [webhookUrl, setWebhookUrl] = useState(data?.webhookUrl || "");
  const [triggerCount, setTriggerCount] = useState(0);
  const [lastStatus, setLastStatus] = useState<number | "error" | null>(null);
  const [lastTime, setLastTime] = useState<string | null>(null);

  const { sourceOutput, sourceVersion } = useUpstreamTrigger(id, "trigger");

  const updateData = useNodeData(id);
  useEffect(() => {
    updateData({ webhookUrl });
  }, [webhookUrl, updateData]);

  useEffect(() => {
    if (!sourceOutput || sourceVersion === 0 || !webhookUrl) return;

    const timestamp = new Date().toISOString();
    setTriggerCount((c) => c + 1);

    fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: sourceOutput,
        timestamp,
        node_id: id,
      }),
    })
      .then((res) => {
        setLastStatus(res.status);
        setLastTime(new Date().toLocaleTimeString());
      })
      .catch(() => {
        setLastStatus("error");
        setLastTime(new Date().toLocaleTimeString());
      });
  }, [sourceVersion]);

  const statusColor =
    lastStatus === null
      ? "#64748b"
      : lastStatus === "error"
      ? "#ef4444"
      : lastStatus >= 200 && lastStatus < 300
      ? "#10b981"
      : "#f59e0b";

  return (
    <NodeShell
      accent="#8b5cf6"
      title="Webhook POST"
      icon={<Webhook size={16} />}
      status={triggerCount > 0 ? "running" : "idle"}
      selected={selected}
      width={340}
    >
      <Handle
        type="target"
        position={Position.Left}
        id="trigger"
        data-tooltip="trigger"
        style={{ background: "#FBBC05", border: "2px solid #13131a" }}
      />

      <div className="mb-3 font-sans">
        <span className="text-xs text-slate-500 block mb-1.5 font-sans">POST URL</span>
        <input
          type="text"
          value={webhookUrl}
          onChange={(e) => setWebhookUrl(e.target.value)}
          className="w-full bg-[#0a0a0f] border border-[#1e1e2e] rounded-lg px-3 py-2 text-sm text-slate-300 outline-none focus:border-violet-500/40 font-mono nodrag nowheel"
          placeholder="https://..."
        />
      </div>

      {lastStatus !== null && (
        <div
          className="flex items-center gap-2 rounded-md px-3 py-2 mb-3 font-sans"
          style={{
            background: statusColor + "15",
            border: `1px solid ${statusColor}25`,
          }}
        >
          <div
            className="w-2 h-2 rounded-full"
            style={{ background: statusColor }}
          />
          <span className="text-xs font-mono" style={{ color: statusColor }}>
            {lastStatus === "error" ? "Error" : `${lastStatus}`}
          </span>
          {lastTime && (
            <span className="text-[10px] text-slate-500 ml-auto font-mono font-sans">
              {lastTime}
            </span>
          )}
        </div>
      )}

      {!webhookUrl && (
        <div className="rounded-lg p-3 font-sans" style={{ background: "#0a0a0f" }}>
          <p className="text-xs text-slate-600 text-center font-sans">
            Enter a URL to send POST requests
          </p>
        </div>
      )}

      <div className="mt-3 text-right font-sans">
        <span className="text-xs font-mono text-violet-500/70">{triggerCount} triggers</span>
      </div>
    </NodeShell>
  );
}
