"use client";

import React from "react";
import { useTelemetryStore } from "@/l/telemetryStore";
import { Activity, Zap, Clock, ShieldCheck } from "lucide-react";

export default function TelemetryHud() {
  const { executionCounts, latencies } = useTelemetryStore();

  const totalExecutions = Object.values(executionCounts).reduce((a, b) => a + b, 0);
  
  const getAvgLatency = (type: string) => {
    const list = latencies[type] || [];
    if (list.length === 0) return 0;
    return Math.round(list.reduce((a, b) => a + b, 0) / list.length);
  };

  return (
    <div className="absolute bottom-6 right-6 z-[100] flex flex-col gap-3 pointer-events-none">
      {/* HUD Header */}
      <div className="glass px-4 py-2 rounded-xl flex items-center gap-3 border border-[#4285F4]/30 shadow-lg shadow-[#4285F4]/10">
        <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
        <span className="text-[10px] font-black text-slate-300 uppercase tracking-[0.2em]">Lumina HUD // Active</span>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-3">
        <div className="glass p-3 rounded-2xl border border-white/5 flex flex-col gap-1">
          <div className="flex items-center gap-2 text-[#4285F4]">
            <Activity size={12} />
            <span className="text-[9px] font-bold uppercase tracking-wider">Total Ops</span>
          </div>
          <span className="text-xl font-mono font-bold text-white tracking-tighter">
            {totalExecutions.toLocaleString()}
          </span>
        </div>

        <div className="glass p-3 rounded-2xl border border-white/5 flex flex-col gap-1">
          <div className="flex items-center gap-2 text-purple-400">
            <Zap size={12} />
            <span className="text-[9px] font-bold uppercase tracking-wider">VLM Speed</span>
          </div>
          <span className="text-xl font-mono font-bold text-white tracking-tighter">
            {getAvgLatency("visualLlm")}ms
          </span>
        </div>

        <div className="glass p-3 rounded-2xl border border-white/5 flex flex-col gap-1">
          <div className="flex items-center gap-2 text-amber-400">
            <Clock size={12} />
            <span className="text-[9px] font-bold uppercase tracking-wider">Detection</span>
          </div>
          <span className="text-xl font-mono font-bold text-white tracking-tighter">
            {getAvgLatency("detection")}ms
          </span>
        </div>

        <div className="glass p-3 rounded-2xl border border-white/5 flex flex-col gap-1">
          <div className="flex items-center gap-2 text-emerald-400">
            <ShieldCheck size={12} />
            <span className="text-[9px] font-bold uppercase tracking-wider">Neural Engine</span>
          </div>
          <span className="text-xl font-mono font-bold text-white tracking-tighter">
            {totalExecutions > 0 ? "Normal" : "Idle"}
          </span>
        </div>
      </div>

      {/* Node Activity Feed */}
      <div className="glass p-4 rounded-2xl border border-white/5 max-h-[200px] overflow-hidden flex flex-col gap-2">
        <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">Execution Pulse</span>
        <div className="space-y-1.5">
          {Object.entries(executionCounts).slice(-4).reverse().map(([id, count]) => (
            <div key={id} className="flex items-center justify-between gap-4">
              <span className="text-[10px] font-mono text-slate-400 truncate max-w-[80px]">{id}</span>
              <div className="flex-1 h-[1px] bg-white/5" />
              <span className="text-[10px] font-mono text-[#4285F4] font-bold">{count}x</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
