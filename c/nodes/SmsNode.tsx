"use client";

import React, { useEffect, useState, useCallback } from "react";
import { Handle, Position, type NodeProps } from "reactflow";
import { MessageCircle, WifiOff } from "lucide-react";
import NodeShell from "./NodeShell";
import { useUpstreamTrigger } from "@/l/useUpstreamTrigger";
import { useOnlineStatus } from "@/l/useOnlineStatus";
import { pipelineSocket } from "@/l/websocket";
import { useNodeData } from "@/l/useNodeData";

export default function SmsNode({ id, selected, data }: NodeProps) {
  const [phoneTo, setPhoneTo] = useState(data?.smsTo || "");
  const [bodyTemplate, setBodyTemplate] = useState(data?.smsBody || "{{output}}");
  const [triggerCount, setTriggerCount] = useState(0);
  const [lastStatus, setLastStatus] = useState<"success" | "error" | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastTime, setLastTime] = useState<string | null>(null);

  const { sourceOutput, sourceVersion } = useUpstreamTrigger(id, "trigger");
  const online = useOnlineStatus();

  const updateData = useNodeData(id);
  useEffect(() => {
    updateData({ smsTo: phoneTo, smsBody: bodyTemplate });
  }, [phoneTo, bodyTemplate, updateData]);

  const handleResult = useCallback(
    (payload: any) => {
      if (payload.node_id !== id) return;
      setLastTime(new Date().toLocaleTimeString());
      if (payload.success) {
        setLastStatus("success");
        setLastError(null);
      } else {
        setLastStatus("error");
        setLastError(payload.error || "Unknown error");
      }
    },
    [id]
  );

  useEffect(() => {
    pipelineSocket.on("sms_result", handleResult);
    return () => {
      pipelineSocket.off("sms_result", handleResult);
    };
  }, [handleResult]);

  useEffect(() => {
    if (!sourceOutput || sourceVersion === 0) return;
    setTriggerCount((c) => c + 1);

    if (!online) {
      setLastStatus("error");
      setLastError("No internet connection");
      setLastTime(new Date().toLocaleTimeString());
      return;
    }

    if (!phoneTo) {
      setLastStatus("error");
      setLastError("No phone number set");
      setLastTime(new Date().toLocaleTimeString());
      return;
    }

    const body = bodyTemplate.includes("{{output}}")
      ? bodyTemplate.replace(/\{\{output\}\}/g, sourceOutput)
      : bodyTemplate;
    pipelineSocket.sendSms(phoneTo, body, id);
  }, [sourceVersion]);

  const statusColor =
    lastStatus === null ? "#64748b" : lastStatus === "success" ? "#14b8a6" : "#ef4444";

  return (
    <NodeShell
      accent="#14b8a6"
      title="SMS Alert"
      icon={<MessageCircle size={16} />}
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

      {!online && (
        <div
          className="flex items-center gap-2 mb-3 px-3 py-2 rounded-md font-sans"
          style={{ background: "#ef444415", border: "1px solid #ef444425" }}
        >
          <WifiOff size={14} className="text-red-400" />
          <span className="text-xs text-red-400 font-medium">No Internet — SMS disabled</span>
        </div>
      )}

      <div className="mb-3 font-sans">
        <span className="text-xs text-slate-500 block mb-1.5">Phone Number</span>
        <input
          type="tel"
          value={phoneTo}
          onChange={(e) => setPhoneTo(e.target.value)}
          disabled={!online}
          className="w-full bg-[#0a0a0f] border border-[#1e1e2e] rounded-lg px-3 py-2 text-sm text-slate-300 outline-none focus:border-teal-500/40 font-mono nodrag nowheel disabled:opacity-40"
          placeholder="+1234567890"
        />
      </div>

      <div className="mb-3 font-sans">
        <span className="text-xs text-slate-500 block mb-1.5">
          Message <span className="text-slate-600">{'({{output}} = trigger text)'}</span>
        </span>
        <textarea
          value={bodyTemplate}
          onChange={(e) => setBodyTemplate(e.target.value)}
          disabled={!online}
          rows={2}
          className="w-full bg-[#0a0a0f] border border-[#1e1e2e] rounded-lg px-3 py-2 text-sm text-slate-300 outline-none focus:border-teal-500/40 font-mono nodrag nowheel disabled:opacity-40 resize-none"
          placeholder="Alert: {{output}}"
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
          <div className="w-2 h-2 rounded-full" style={{ background: statusColor }} />
          <span className="text-xs font-mono" style={{ color: statusColor }}>
            {lastStatus === "success" ? "Sent" : lastError || "Error"}
          </span>
          {lastTime && (
            <span className="text-[10px] text-slate-500 ml-auto font-mono font-sans">{lastTime}</span>
          )}
        </div>
      )}

      {!phoneTo && !lastStatus && (
        <div className="rounded-lg p-3 font-sans" style={{ background: "#0a0a0f" }}>
          <p className="text-xs text-slate-600 text-center">Enter a phone number to send SMS</p>
        </div>
      )}

      <div className="mt-3 text-right font-sans">
        <span className="text-xs font-mono text-teal-500/70">{triggerCount} triggers</span>
      </div>
    </NodeShell>
  );
}
