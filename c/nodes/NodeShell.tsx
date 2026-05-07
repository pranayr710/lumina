"use client";

import React from "react";
import { Pin, X } from "lucide-react";

export type InferenceMode = "local" | "gemini" | "cloud" | "input";

interface NodeShellProps {
  accent: string;
  title: string;
  icon: React.ReactNode;
  status?: "idle" | "running" | "error";
  selected?: boolean;
  children: React.ReactNode;
  width?: number;
  onPin?: () => void;
  pinned?: boolean;
  id?: string;
  /** Controls privacy indicator color in header */
  inferenceMode?: InferenceMode;
}

// Privacy badge colors and tooltips
const PRIVACY_META: Record<InferenceMode, { color: string; label: string; tooltip: string }> = {
  local:  { color: "#34A853", label: "LOCAL",  tooltip: "On-device — no data leaves your machine" },
  gemini: { color: "#FBBC05", label: "GEMINI", tooltip: "Google Gemini API — frames sent to cloud" },
  cloud:  { color: "#f97316", label: "CLOUD",  tooltip: "External service — data sent over internet" },
  input:  { color: "#4285F4", label: "INPUT",  tooltip: "Data source — no inference" },
};

export function inferModeFromType(nodeType: string): InferenceMode {
  const t = nodeType ?? "";
  if (["camera","video","mic","audioFile","ipCamera","timer"].includes(t)) return "input";
  if (["emailAction","smsAction","slackAction","discordAction","webhookAction","mqttAction","googleSheetsAction"].includes(t)) return "cloud";
  if (["visualLlm","audioLlm","llm","geminiLive","toolUse"].includes(t)) return "gemini";
  return "local";
}

export default function NodeShell({
  accent,
  title,
  icon,
  status = "idle",
  selected,
  children,
  width = 320,
  onPin,
  pinned,
  id,
  inferenceMode = "local",
}: NodeShellProps) {
  const privacy = PRIVACY_META[inferenceMode];

  return (
    <div
      className={`relative group rounded-xl transition-all duration-300 glass-bright overflow-hidden font-sans ${
        selected ? "ring-1 ring-[#4285F4]/50 shadow-[0_0_30px_rgba(66,133,244,0.1)]" : "border border-white/5"
      }`}
      style={{ width }}
    >
      {selected && (
        <div
          className="absolute inset-0 pointer-events-none opacity-20"
          style={{ background: `radial-gradient(circle at 50% 0%, ${accent}, transparent 70%)` }}
        />
      )}

      {/* Header */}
      <div className="relative px-4 py-3 flex items-center justify-between border-b border-white/5 bg-black/20 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="text-slate-400 group-hover:text-white transition-colors" style={{ color: selected ? accent : undefined }}>
            {icon}
          </div>
          <h3 className="text-[10px] font-bold text-slate-300 uppercase tracking-[0.15em] group-hover:text-white transition-colors">
            {title}
          </h3>
        </div>

        <div className="flex items-center gap-2">
          {/* Privacy badge */}
          <div
            className="group/priv relative flex items-center gap-1 px-1.5 py-0.5 rounded"
            style={{ background: `${privacy.color}18`, border: `1px solid ${privacy.color}35` }}
            title={privacy.tooltip}
          >
            <div
              className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{
                backgroundColor: privacy.color,
                boxShadow: inferenceMode !== "input" ? `0 0 4px ${privacy.color}80` : "none",
              }}
            />
            <span className="text-[8px] font-black tracking-wider hidden group-hover:inline-block" style={{ color: privacy.color }}>
              {privacy.label}
            </span>
            {/* Tooltip */}
            <div className="absolute bottom-full right-0 mb-1.5 whitespace-nowrap bg-[#0d0d14] border border-white/10 px-2 py-1 rounded text-[9px] text-slate-300 opacity-0 group-hover/priv:opacity-100 transition-opacity pointer-events-none z-[200]">
              {privacy.tooltip}
            </div>
          </div>

          {/* Status dot */}
          <div
            className="w-1.5 h-1.5 rounded-full status-indicator"
            style={{
              backgroundColor: status === "running" ? accent : status === "error" ? "#ef4444" : "#334155",
              "--pulse-color": status === "running" ? `${accent}40` : "transparent",
            } as any}
          />
          {onPin && (
            <button
              onClick={(e) => { e.stopPropagation(); onPin(); }}
              className={`p-1 rounded transition-all cursor-pointer ${pinned ? "text-[#4285F4]" : "text-slate-600 hover:text-slate-400"}`}
              title="Pin to overlay"
            >
              <Pin size={10} fill={pinned ? "currentColor" : "none"} />
            </button>
          )}
          {id && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                window.dispatchEvent(new CustomEvent("lumina:delete-node", { detail: { id } }));
              }}
              className="p-1 rounded text-slate-600 hover:text-red-400 hover:bg-red-500/10 transition-all cursor-pointer"
              title="Delete node"
            >
              <X size={10} />
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="p-4 relative">{children}</div>

      {/* Bottom accent bar */}
      <div
        className="h-[1px] w-full opacity-30"
        style={{ background: `linear-gradient(90deg, transparent, ${accent}, transparent)` }}
      />
    </div>
  );
}
