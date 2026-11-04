"use client";

import React, { useState, useEffect } from "react";
import { Handle, Position, type NodeProps } from "reactflow";
import { MessageSquare, ShieldCheck } from "lucide-react";
import NodeShell from "./NodeShell";
import { useUpstreamTrigger } from "@/lib/useUpstreamTrigger";
import { pipelineSocket } from "@/lib/websocket";
import { useNodeData } from "@/lib/useNodeData";

export default function DiscordNode({ id, selected, data }: NodeProps) {
  const [webhookUrl, setWebhookUrl] = useState(data.webhookUrl || "");
  const [username, setUsername] = useState(data.username || "Lumina Bot");
  const [status, setStatus] = useState<"idle" | "running" | "error">("idle");

  const updateData = useNodeData(id);
  useEffect(() => {
    updateData({ webhookUrl, username });
  }, [webhookUrl, username, updateData]);

  const { sourceOutput, sourceVersion } = useUpstreamTrigger(id, "trigger");

  useEffect(() => {
    if (sourceVersion > 0 && sourceOutput && webhookUrl) {
      setStatus("running");
      pipelineSocket.send("discord_notify", {
        webhook_url: webhookUrl,
        username,
        content: sourceOutput,
        node_id: id
      });
    }
  }, [sourceVersion, sourceOutput, webhookUrl, username, id]);

  useEffect(() => {
    const unsub = pipelineSocket.on("discord_sent", (payload: any) => {
      if (payload.node_id === id) {
        setStatus(payload.ok ? "idle" : "error");
      }
    });
    return () => unsub();
  }, [id]);

  return (
    <NodeShell
      accent="#5865F2"
      title="Discord Alert"
      icon={<MessageSquare size={16} />}
      status={status}
      selected={selected}
      width={320}
    >
      <Handle type="target" position={Position.Left} id="trigger" className="w-3 h-3 bg-[#5865F2] border-2 border-[#13131a]" />

      <div className="space-y-4 font-sans">
        <div>
          <label className="text-[10px] text-slate-500 uppercase font-bold tracking-wider mb-1.5 block">Webhook URL</label>
          <input
            type="password"
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            placeholder="https://discord.com/api/webhooks/..."
            className="w-full bg-[#0a0a0f] border border-[#1e1e2e] rounded-lg px-3 py-1.5 text-xs text-slate-300 outline-none focus:border-[#5865F2]/50 nodrag"
          />
        </div>
        <div>
          <label className="text-[10px] text-slate-500 uppercase font-bold tracking-wider mb-1.5 block">Bot Username</label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full bg-[#0a0a0f] border border-[#1e1e2e] rounded-lg px-3 py-1.5 text-xs text-slate-300 outline-none focus:border-[#5865F2]/50 nodrag"
          />
        </div>

        <div className="p-3 rounded-lg bg-[#5865F2]/5 border border-[#5865F2]/10 flex items-center gap-3">
           <ShieldCheck size={16} className="text-[#5865F2]" />
           <p className="text-[10px] text-slate-400 leading-tight">Ready to relay triggers to your Discord channel.</p>
        </div>
      </div>
    </NodeShell>
  );
}
