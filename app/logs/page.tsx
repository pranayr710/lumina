"use client";

import React, { useEffect, useState } from "react";
import { Image as ImageIcon, History, Calendar, Search, Filter, Activity } from "lucide-react";
import Sidebar from "@/c/Sidebar";

export default function LogsPage() {
  const [history, setHistory] = useState<any[]>([]);

  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const res = await fetch("http://localhost:8000/api/history");
        const data = await res.json();
        setHistory(data);
      } catch (e) {}
    };
    fetchHistory();
  }, []);

  return (
    <div className="flex h-screen w-screen bg-[#030305] overflow-hidden text-slate-200">
      <Sidebar backendConnected={true} />
      
      <main className="flex-1 ml-[240px] flex flex-col">
        {/* Header */}
        <header className="px-8 py-6 border-b border-white/5 flex items-center justify-between bg-black/20 backdrop-blur-xl">
          <div className="flex items-center gap-4">
            <div className="p-2 rounded-lg bg-cyan-500/10 border border-cyan-500/20">
              <History size={20} className="text-cyan-400" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight">System Logs</h1>
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-0.5">Inference History & Event Timeline</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input 
                type="text" 
                placeholder="Search events..."
                className="pl-9 pr-4 py-2 bg-white/5 border border-white/10 rounded-lg text-xs outline-none focus:border-cyan-500/30 transition-all w-64 text-slate-300"
              />
            </div>
            <button className="p-2 rounded-lg bg-white/5 border border-white/10 text-slate-400 hover:text-white transition-all">
              <Filter size={16} />
            </button>
          </div>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-8 scrollbar-none">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {history.map((event, i) => (
              <div key={event.id || i} className="glass rounded-2xl overflow-hidden border border-white/5 bg-white/[0.01] group hover:border-cyan-500/20 transition-all">
                <div className="aspect-video bg-black/40 relative">
                  {event.image ? (
                    <img 
                      src={`http://localhost:8000/${event.image}`} 
                      alt="Event" 
                      className="w-full h-full object-cover transition-transform group-hover:scale-105"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-slate-800">
                      <ImageIcon size={40} />
                    </div>
                  )}
                  <div className="absolute top-3 right-3 px-2 py-1 bg-black/60 backdrop-blur-md rounded-md text-[9px] font-black text-cyan-400 uppercase tracking-widest border border-white/5">
                    {event.type}
                  </div>
                </div>
                
                <div className="p-5">
                  <div className="flex items-center gap-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-3">
                    <Calendar size={12} className="text-cyan-500/50" />
                    {new Date(event.timestamp).toLocaleString()}
                  </div>
                  
                  <div className="text-xs text-slate-400 leading-relaxed line-clamp-2 bg-white/5 p-3 rounded-lg border border-white/5 font-mono mb-4">
                    {typeof event.data === 'string' ? event.data : JSON.stringify(event.data)}
                  </div>

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      <span className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">
                        Node: {event.node_id}
                      </span>
                    </div>
                    <Activity size={12} className="text-slate-700" />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {history.length === 0 && (
            <div className="flex flex-col items-center justify-center py-32 border border-dashed border-white/5 rounded-[2rem] bg-white/[0.01]">
              <History size={48} className="text-slate-800 mb-4" />
              <h2 className="text-sm font-bold text-slate-500">No events recorded</h2>
              <p className="text-[10px] font-bold text-slate-700 uppercase tracking-widest mt-1">Connect a log node to start capturing</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
