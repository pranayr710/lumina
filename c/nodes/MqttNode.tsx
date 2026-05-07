"use client";

import React, { useState, useEffect } from "react";
import { Handle, Position, type NodeProps } from "reactflow";
import { Radio, CheckCircle2 } from "lucide-react";
import NodeShell from "./NodeShell";
import { useUpstreamTrigger } from "@/l/useUpstreamTrigger";
import { pipelineSocket } from "@/l/websocket";
import { useNodeData } from "@/l/useNodeData";

export default function MqttNode({ id, selected, data }: NodeProps) {
  const [broker, setBroker] = useState(data.broker || "broker.hivemq.com");
  const [topic, setTopic] = useState(data.topic || "lumina/alerts");
  const [lastSent, setLastSent] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "running" | "error">("idle");

  const updateData = useNodeData(id);
  useEffect(() => {
    updateData({ broker, topic });
  }, [broker, topic, updateData]);

  const { sourceOutput, sourceVersion } = useUpstreamTrigger(id, "trigger");

  useEffect(() => {
    if (sourceVersion === 0 || !sourceOutput) return;

    setStatus("running");
    pipelineSocket.send("mqtt_publish", {
      broker,
      topic,
      payload: sourceOutput
    });
  }, [sourceVersion, sourceOutput, broker, topic]);

  useEffect(() => {
    const unsub = pipelineSocket.on("mqtt_result", (payload: any) => {
      if (payload.success) {
        setStatus("idle");
        setLastSent(new Date().toLocaleTimeString());
      } else {
        setStatus("error");
      }
    });
    return () => unsub();
  }, []);

  return (
    <NodeShell
      accent="#4285F4"
      title="MQTT Publish"
      icon={<Radio size={16} />}
      status={status}
      selected={selected}
      width={320}
    >
      <Handle
        type="target"
        position={Position.Left}
        id="trigger"
        className="w-3 h-3 bg-cyan-500 border-2 border-[#13131a]"
      />

      <div className="space-y-4 font-sans">
        <div className="grid grid-cols-1 gap-3 font-sans">
          <div>
            <label className="text-[10px] text-slate-500 uppercase font-bold tracking-wider mb-1.5 block">Broker</label>
            <input
              type="text"
              value={broker}
              onChange={(e) => setBroker(e.target.value)}
              placeholder="e.g. 192.168.1.100"
              className="w-full bg-[#0a0a0f] border border-[#282838] rounded-lg px-3 py-1.5 text-xs text-slate-300 outline-none focus:border-cyan-500/50 nodrag"
            />
          </div>
          <div>
            <label className="text-[10px] text-slate-500 uppercase font-bold tracking-wider mb-1.5 block">Topic</label>
            <input
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="lumina/events"
              className="w-full bg-[#0a0a0f] border border-[#282838] rounded-lg px-3 py-1.5 text-xs text-slate-300 outline-none focus:border-cyan-500/50 nodrag"
            />
          </div>
        </div>

        <div className="bg-cyan-500/5 rounded-lg p-3 border border-cyan-500/10 font-sans">
          <div className="flex items-center justify-between mb-2">
             <span className="text-[10px] text-[#4285F4] uppercase">Connection</span>
             {lastSent && (
                <span className="text-[9px] text-emerald-500 flex items-center gap-1 font-sans">
                  <CheckCircle2 size={10} />
                  Published {lastSent}
                </span>
             )}
          </div>
          <div className="text-[10px] text-slate-400 leading-relaxed truncate font-mono">
            {status === "running" ? "Publishing..." : status === "error" ? "Connection failed!" : `Broker: ${broker}`}
          </div>
        </div>
      </div>
    </NodeShell>
  );
}
