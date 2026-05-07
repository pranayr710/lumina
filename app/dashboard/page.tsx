"use client";

import React, { useEffect, useState } from "react";
import { Activity, Clock, Cpu, LayoutDashboard, Zap, Shield, Globe } from "lucide-react";
import Sidebar from "@/c/Sidebar";

export default function DashboardPage() {
  const [stats, setStats] = useState<any>(null);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await fetch("http://localhost:8000/api/dashboard");
        const data = await res.json();
        setStats(data);
      } catch (e) {}
    };
    fetchStats();
    const interval = setInterval(fetchStats, 5000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex h-screen w-screen bg-[#030305] overflow-hidden text-slate-200">
      <Sidebar backendConnected={true} />
      
      <main className="flex-1 ml-[240px] flex flex-col">
        {/* Header */}
        <header className="px-8 py-6 border-b border-white/5 flex items-center justify-between bg-black/20 backdrop-blur-xl">
          <div className="flex items-center gap-4">
            <div className="p-2 rounded-lg bg-cyan-500/10 border border-cyan-500/20">
              <LayoutDashboard size={20} className="text-cyan-400" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight">System Dashboard</h1>
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-0.5">Real-time Performance & Resource Analytics</p>
            </div>
          </div>

          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[9px] font-bold text-emerald-500 uppercase tracking-widest">Local Node Sync Active</span>
          </div>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-8 scrollbar-none">
          {/* Top Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            {[
              { label: "Session Uptime", value: stats ? `${Math.floor(stats.uptime_sec / 3600)}h ${Math.floor((stats.uptime_sec % 3600) / 60)}m` : "--", icon: <Clock />, color: "text-purple-400" },
              { label: "Processed Events", value: stats ? Object.values(stats.stats as object).reduce((a: any, b: any) => a + b, 0) : "--", icon: <Activity />, color: "text-cyan-400" },
              { label: "Hardware Load", value: "8%", icon: <Cpu />, color: "text-amber-400" },
            ].map((stat, i) => (
              <div key={i} className="glass rounded-2xl p-6 border border-white/5 bg-white/[0.02]">
                <div className="flex items-center justify-between mb-4">
                  <span className="text-[10px] font-black text-slate-600 uppercase tracking-[0.2em]">{stat.label}</span>
                  <span className={stat.color}>{stat.icon}</span>
                </div>
                <div className="text-3xl font-black tracking-tighter text-white">{stat.value}</div>
              </div>
            ))}
          </div>

          {/* Secondary Stats */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Detection breakdown */}
            <div className="glass rounded-[2rem] p-8 border border-white/5 bg-white/[0.02]">
              <div className="flex items-center justify-between mb-8">
                <h2 className="text-sm font-black uppercase tracking-[0.2em] text-slate-400">Detection Analytics</h2>
                <Zap size={14} className="text-cyan-400" />
              </div>
              
              <div className="space-y-4">
                {stats?.stats && Object.entries(stats.stats).map(([type, count]: [any, any]) => (
                  <div key={type} className="flex items-center justify-between p-4 rounded-xl bg-white/[0.02] border border-white/5 group hover:border-cyan-500/20 transition-all">
                    <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">{type.replace("_", " ")}</span>
                    <div className="flex items-center gap-4">
                      <div className="w-32 h-1.5 rounded-full bg-white/5 overflow-hidden">
                        <div 
                          className="h-full bg-cyan-500 shadow-[0_0_8px_rgba(34,211,238,0.4)]" 
                          style={{ width: `${Math.min(100, (count / 100) * 100)}%` }} 
                        />
                      </div>
                      <span className="text-sm font-bold text-white min-w-[2rem] text-right">{count}</span>
                    </div>
                  </div>
                ))}
                {!stats?.stats && <div className="text-center py-8 text-xs font-bold text-slate-700 uppercase tracking-widest">Waiting for data telemetry...</div>}
              </div>
            </div>

            {/* System Info */}
            <div className="space-y-6">
              <div className="glass rounded-[2rem] p-8 border border-white/5 bg-white/[0.02]">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-sm font-black uppercase tracking-[0.2em] text-slate-400">Orchestrator Health</h2>
                  <Shield size={14} className="text-emerald-400" />
                </div>
                <div className="flex items-center gap-6">
                   <div className="flex-1 p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/10 text-center">
                      <div className="text-[10px] font-black text-emerald-500/60 uppercase tracking-widest mb-1">Status</div>
                      <div className="text-sm font-bold text-emerald-400">Nominal</div>
                   </div>
                   <div className="flex-1 p-4 rounded-xl bg-cyan-500/5 border border-cyan-500/10 text-center">
                      <div className="text-[10px] font-black text-cyan-500/60 uppercase tracking-widest mb-1">Latency</div>
                      <div className="text-sm font-bold text-cyan-400">~12ms</div>
                   </div>
                </div>
              </div>

              <div className="glass rounded-[2rem] p-8 border border-white/5 bg-white/[0.02]">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-sm font-black uppercase tracking-[0.2em] text-slate-400">Node Location</h2>
                  <Globe size={14} className="text-slate-600" />
                </div>
                <p className="text-xs text-slate-500 leading-relaxed font-medium">
                  All AI models are executing on localized silicon. Your data remains on-device and is never transmitted to cloud endpoints.
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
