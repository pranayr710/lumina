"use client";

import React from "react";
import { Pin, Settings2, X } from "lucide-react";

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
}: NodeShellProps) {
  return (
    <div
      className={`relative group rounded-xl transition-all duration-300 glass-bright overflow-hidden font-sans ${
        selected ? "ring-1 ring-[#4285F4]/50 shadow-[0_0_30px_rgba(66,133,244,0.1)]" : "border border-white/5"
      }`}
      style={{
        width: width,
      }}
    >
      {/* Selection Glow */}
      {selected && (
        <div 
          className="absolute inset-0 pointer-events-none opacity-20"
          style={{
            background: `radial-gradient(circle at 50% 0%, ${accent}, transparent 70%)`
          }}
        />
      )}

      {/* Header */}
      <div className="relative px-4 py-3 flex items-center justify-between border-b border-white/5 bg-black/20 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div 
            className="text-slate-400 group-hover:text-white transition-colors"
            style={{ color: selected ? accent : undefined }}
          >
            {icon}
          </div>
          <h3 className="text-[10px] font-bold text-slate-300 uppercase tracking-[0.15em] group-hover:text-white transition-colors">
            {title}
          </h3>
        </div>

        <div className="flex items-center gap-2">
          {/* Status Dot */}
          <div 
            className={`w-1.5 h-1.5 rounded-full status-indicator`}
            style={{ 
              backgroundColor: status === "running" ? accent : status === "error" ? "#ef4444" : "#334155",
              "--pulse-color": status === "running" ? `${accent}40` : "transparent"
            } as any}
          />
          {onPin && (
            <button
              onClick={(e) => { e.stopPropagation(); onPin(); }}
              className={`p-1 rounded transition-all cursor-pointer ${
                pinned ? "text-[#4285F4]" : "text-slate-600 hover:text-slate-400"
              }`}
              title="Pin node to overlay"
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

      {/* Body Content */}
      <div className="p-4 relative">
        {children}
      </div>

      {/* Bottom Accent Bar */}
      <div 
        className="h-[1px] w-full opacity-30"
        style={{ background: `linear-gradient(90deg, transparent, ${accent}, transparent)` }}
      />
    </div>
  );
}
