"use client";

import React, { useState, useEffect } from "react";
import { Handle, Position, type NodeProps } from "reactflow";
import { Hash, Slack, Shield } from "lucide-react";
import NodeShell from "./NodeShell";
import { useUpstreamTrigger } from "@/l/useUpstreamTrigger";
import { pipelineSocket } from "@/l/websocket";
import { useNodeData } from "@/l/useNodeData";

export default function SlackNode({ id, selected, data }: NodeProps) {
  const [webhookUrl, setWebhookUrl] = useState(data.webhookUrl || "");
  const [channel, setChannel] = useState(data.channel || "#general");
  const [status, setStatus] = useState<"idle" | "running" | "error">("idle");

  const updateData = useNodeData(id);
  useEffect(() => {
    updateData({ webhookUrl, channel });
  }, [webhookUrl, channel, updateData]);

  const { sourceOutput, sourceVersion } = useUpstreamTrigger(id, "trigger");

  useEffect(() => {
    if (sourceVersion > 0 && sourceOutput && webhookUrl) {
      setStatus("running");
      pipelineSocket.send("slack_notify", {
        webhook_url: webhookUrl,
        channel,
        text: sourceOutput,
        node_id: id
      });
    }
  }, [sourceVersion, sourceOutput, webhookUrl, channel, id]);

  useEffect(() => {
    const unsub = pipelineSocket.on("slack_result", (payload: any) => {
      if (payload.node_id === id) {
        setStatus(payload.success ? "idle" : "error");
      }
    });
    return () => unsub();
  }, [id]);

  return (
    <NodeShell
      accent="#4A154B"
      title="Slack Message"
      icon={<Slack size={16} />}
      status={status}
      selected={selected}
      width={320}
    >
      <Handle type="target" position={Position.Left} id="trigger" className="w-3 h-3 bg-[#E01E5A] border-2 border-[#13131a]" />

      <div className="space-y-4 font-sans">
        <div>
          <label className="text-[10px] text-slate-500 uppercase font-bold tracking-wider mb-1.5 block">Webhook URL</label>
          <input
            type="password"
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            placeholder="https://hooks.slack.com/services/..."
            className="w-full bg-[#0a0a0f] border border-[#1e1e2e] rounded-lg px-3 py-1.5 text-xs text-slate-300 outline-none focus:border-[#E01E5A]/50 nodrag"
          />
        </div>
        <div>
          <label className="text-[10px] text-slate-500 uppercase font-bold tracking-wider mb-1.5 block">Channel</label>
          <div className="relative">
            <Hash size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" />
            <input
              type="text"
              value={channel}
              onChange={(e) => setChannel(e.target.value)}
              className="w-full bg-[#0a0a0f] border border-[#1e1e2e] rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-300 outline-none focus:border-[#E01E5A]/50 nodrag"
            />
          </div>
        </div>

        <div className="p-3 rounded-lg bg-[#E01E5A]/5 border border-[#E01E5A]/10 flex items-center gap-3">
           <Shield size={16} className="text-[#E01E5A]" />
           <p className="text-[10px] text-slate-400 leading-tight">Securely routes automation events to Slack.</p>
        </div>
      </div>
    </NodeShell>
  );
}
