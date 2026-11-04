"use client";

import React from "react";
import { Pin, X, AlertTriangle } from "lucide-react";

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
  inferenceMode?: InferenceMode;
  errorMessage?: string;
}

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
  accent, title, icon, status = "idle", selected, children,
  width = 320, onPin, pinned, id, inferenceMode = "local", errorMessage,
}: NodeShellProps) {
  const privacy = PRIVACY_META[inferenceMode];
  const hasError = !!errorMessage || status === "error";

  return (
    <div
      className={`relative group rounded-xl transition-all duration-300 glass-bright overflow-hidden font-sans ${
        hasError
          ? "ring-1 ring-red-500/50 shadow-[0_0_20px_rgba(239,68,68,0.15)]"
          : selected
            ? "ring-1 ring-[#4285F4]/50 shadow-[0_0_30px_rgba(66,133,244,0.1)]"
            : "border border-white/5"
      }`}
      style={{ width }}
    >
      {selected && !hasError && (
        <div className="absolute inset-0 pointer-events-none opacity-20"
          style={{ background: `radial-gradient(circle at 50% 0%, ${accent}, transparent 70%)` }} />
      )}
      {hasError && (
        <div className="absolute inset-0 pointer-events-none opacity-10"
          style={{ background: "radial-gradient(circle at 50% 0%, #ef4444, transparent 70%)" }} />
      )}

      {/* Header */}
      <div className={`relative px-4 py-3 flex items-center justify-between border-b backdrop-blur-md ${
        hasError ? "bg-red-950/20 border-red-500/20" : "bg-black/20 border-white/5"
      }`}>
        <div className="flex items-center gap-3">
          <div className="text-slate-400 group-hover:text-white transition-colors"
            style={{ color: hasError ? "#ef4444" : selected ? accent : undefined }}>
            {hasError ? <AlertTriangle size={14} /> : icon}
          </div>
          <h3 className={`text-[10px] font-bold uppercase tracking-[0.15em] transition-colors ${
            hasError ? "text-red-400" : "text-slate-300 group-hover:text-white"
          }`}>
            {title}
          </h3>
        </div>

        <div className="flex items-center gap-2">
          {/* Privacy badge */}
          <div className="group/priv relative flex items-center gap-1 px-1.5 py-0.5 rounded"
            style={{ background: `${privacy.color}18`, border: `1px solid ${privacy.color}35` }}
            title={privacy.tooltip}>
            <div className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{ backgroundColor: privacy.color, boxShadow: inferenceMode !== "input" ? `0 0 4px ${privacy.color}80` : "none" }} />
            <span className="text-[8px] font-black tracking-wider hidden group-hover:inline-block" style={{ color: privacy.color }}>
              {privacy.label}
            </span>
            <div className="absolute bottom-full right-0 mb-1.5 whitespace-nowrap bg-[#0d0d14] border border-white/10 px-2 py-1 rounded text-[9px] text-slate-300 opacity-0 group-hover/priv:opacity-100 transition-opacity pointer-events-none z-[200]">
              {privacy.tooltip}
            </div>
          </div>

          {/* Status dot */}
          <div className="w-1.5 h-1.5 rounded-full status-indicator"
            style={{
              backgroundColor: hasError ? "#ef4444" : status === "running" ? accent : "#334155",
              "--pulse-color": hasError ? "#ef444440" : status === "running" ? `${accent}40` : "transparent",
            } as any} />

          {onPin && (
            <button onClick={(e) => { e.stopPropagation(); onPin(); }}
              className={`p-1 rounded transition-all cursor-pointer ${pinned ? "text-[#4285F4]" : "text-slate-600 hover:text-slate-400"}`}
              title="Pin to overlay">
              <Pin size={10} fill={pinned ? "currentColor" : "none"} />
            </button>
          )}
          {id && (
            <button onClick={(e) => { e.stopPropagation(); window.dispatchEvent(new CustomEvent("lumina:delete-node", { detail: { id } })); }}
              className="p-1 rounded text-slate-600 hover:text-red-400 hover:bg-red-500/10 transition-all cursor-pointer"
              title="Delete node">
              <X size={10} />
            </button>
          )}
        </div>
      </div>

      {/* Error banner */}
      {errorMessage && (
        <div className="px-4 py-2 bg-red-950/30 border-b border-red-500/20 flex items-start gap-2">
          <AlertTriangle size={10} className="text-red-400 mt-0.5 shrink-0" />
          <p className="text-[10px] text-red-300 leading-tight">{errorMessage}</p>
        </div>
      )}

      {/* Body */}
      <div className="p-4 relative">{children}</div>

      {/* Bottom accent bar */}
      <div className="h-[1px] w-full opacity-30"
        style={{ background: hasError ? "linear-gradient(90deg, transparent, #ef4444, transparent)" : `linear-gradient(90deg, transparent, ${accent}, transparent)` }} />
    </div>
  );
}
