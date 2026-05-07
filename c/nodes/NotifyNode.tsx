"use client";

import React, { useEffect, useState } from "react";
import { Handle, Position, type NodeProps } from "reactflow";
import { Bell, ShieldCheck, ShieldX, ShieldAlert } from "lucide-react";
import NodeShell from "./NodeShell";
import { useUpstreamTrigger } from "@/l/useUpstreamTrigger";

export default function NotifyNode({ id, selected }: NodeProps) {
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [triggerCount, setTriggerCount] = useState(0);
  const [lastMessage, setLastMessage] = useState<string | null>(null);

  const { sourceOutput, sourceVersion } = useUpstreamTrigger(id, "trigger");

  useEffect(() => {
    if ("Notification" in window) {
      setPermission(Notification.permission);
    }
  }, []);

  const requestPermission = async () => {
    if (!("Notification" in window)) return;
    try {
      const result = await Notification.requestPermission();
      setPermission(result);
    } catch {}
  };

  useEffect(() => {
    if (!sourceOutput || sourceVersion === 0) return;
    setTriggerCount((c) => c + 1);
    setLastMessage(sourceOutput);

    if ("Notification" in window && Notification.permission === "granted") {
      try {
        new Notification("Lumina Alert", {
          body: sourceOutput,
          icon: "/icon.png",
        });
      } catch {}
    }
  }, [sourceVersion]);

  const permissionConfig = {
    granted: { color: "#10b981", bg: "#10b98115", border: "#10b98125", icon: <ShieldCheck size={14} />, label: "Enabled" },
    denied: { color: "#ef4444", bg: "#ef444415", border: "#ef444425", icon: <ShieldX size={14} />, label: "Blocked" },
    default: { color: "#f59e0b", bg: "#f59e0b15", border: "#f59e0b25", icon: <ShieldAlert size={14} />, label: "Not set" },
  };

  const perm = permissionConfig[permission];

  return (
    <NodeShell
      accent="#eab308"
      title="Notification"
      icon={<Bell size={16} />}
      status={triggerCount > 0 ? "running" : "idle"}
      selected={selected}
      width={320}
    >
      <Handle
        type="target"
        position={Position.Left}
        id="trigger"
        data-tooltip="trigger"
        style={{ background: "#f59e0b", border: "2px solid #13131a" }}
      />

      <div className="flex items-center gap-2 mb-3 font-sans">
        <div
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[11px] font-medium"
          style={{ background: perm.bg, color: perm.color, border: `1px solid ${perm.border}` }}
        >
          {perm.icon}
          {perm.label}
        </div>

        {permission === "default" && (
          <button
            onClick={requestPermission}
            className="flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors nodrag cursor-pointer"
            style={{ background: "rgba(234, 179, 8, 0.15)", color: "#eab308", border: "1px solid rgba(234, 179, 8, 0.25)" }}
          >
            Enable Notifications
          </button>
        )}

        {permission === "denied" && (
          <span className="text-[10px] text-red-400/70 flex-1">
            Enable in browser settings
          </span>
        )}
      </div>

      <div
        className="rounded-lg p-3 nodrag nowheel font-sans"
        style={{
          background: "#0a0a0f",
          minHeight: 60,
        }}
      >
        {lastMessage ? (
          <div>
            <div className="text-[10px] text-yellow-500/60 mb-1 font-mono">Last notification:</div>
            <p className="text-sm text-slate-300 font-mono" style={{ wordBreak: "break-word" }}>
              {lastMessage}
            </p>
          </div>
        ) : (
          <p className="text-sm text-slate-600 text-center py-2">
            No notifications sent yet
          </p>
        )}
      </div>

      <div className="mt-3 text-right">
        <span className="text-xs font-mono text-yellow-500/70">{triggerCount} triggers</span>
      </div>
    </NodeShell>
  );
}
