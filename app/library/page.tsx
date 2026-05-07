"use client";

import React from "react";
import Sidebar from "@/c/Sidebar";
import { BookOpen, Search, Filter, Play, Download, Trash2, Clock } from "lucide-react";

export default function LibraryPage() {
  return (
    <div className="flex h-screen w-screen bg-[#030305] overflow-hidden text-slate-200">
      <Sidebar backendConnected={true} />
      
      <main className="flex-1 ml-[240px] flex flex-col">
        {/* Header */}
        <header className="px-8 py-6 border-b border-white/5 flex items-center justify-between bg-black/20 backdrop-blur-xl">
          <div className="flex items-center gap-4">
            <div className="p-2 rounded-lg bg-cyan-500/10 border border-cyan-500/20">
              <BookOpen size={20} className="text-cyan-400" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight">Component Library</h1>
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-0.5">Manage and deploy saved sub-graphs</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input 
                type="text" 
                placeholder="Search templates..."
                className="pl-9 pr-4 py-2 bg-white/5 border border-white/10 rounded-lg text-xs outline-none focus:border-cyan-500/30 transition-all w-64 text-slate-300"
              />
            </div>
            <button className="p-2 rounded-lg bg-white/5 border border-white/10 text-slate-400 hover:text-white transition-all">
              <Filter size={16} />
            </button>
          </div>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-8">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              { name: "Object Tracking Pipeline", type: "Visual AI", date: "2h ago", nodes: 4 },
              { name: "Anomaly Detection", type: "Logic", date: "1d ago", nodes: 7 },
              { name: "Audio Event Logger", type: "Audio AI", date: "3d ago", nodes: 3 },
              { name: "Face Auth Subgraph", type: "Security", date: "5d ago", nodes: 5 },
              { name: "Smart Doorbell Logic", type: "Automation", date: "1w ago", nodes: 6 },
            ].map((item, i) => (
              <div key={i} className="glass rounded-2xl p-6 border border-white/5 bg-white/[0.02] hover:border-cyan-500/20 transition-all group">
                <div className="flex items-start justify-between mb-6">
                  <div className="w-10 h-10 rounded-xl bg-cyan-500/10 flex items-center justify-center text-cyan-400">
                    <BookOpen size={20} />
                  </div>
                  <div className="flex items-center gap-1">
                    <button className="p-2 rounded-lg hover:bg-white/5 text-slate-500 hover:text-white transition-all"><Play size={14} /></button>
                    <button className="p-2 rounded-lg hover:bg-white/5 text-slate-500 hover:text-white transition-all"><Download size={14} /></button>
                    <button className="p-2 rounded-lg hover:bg-white/5 text-slate-500 hover:text-rose-400 transition-all"><Trash2 size={14} /></button>
                  </div>
                </div>

                <h3 className="font-bold text-sm mb-1 group-hover:text-cyan-400 transition-colors text-white">{item.name}</h3>
                <div className="flex items-center gap-3 text-[10px] font-bold text-slate-600 uppercase tracking-widest">
                  <span className="text-cyan-500/80">{item.type}</span>
                  <span>&bull;</span>
                  <span>{item.nodes} Nodes</span>
                </div>

                <div className="mt-6 pt-6 border-t border-white/5 flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
                    <Clock size={12} />
                    {item.date}
                  </div>
                  <button className="text-[10px] font-black uppercase tracking-widest text-cyan-500 hover:text-cyan-400 cursor-pointer">Deploy &rarr;</button>
                </div>
              </div>
            ))}
          </div>

          {/* Empty State / Hint */}
          <div className="mt-12 flex flex-col items-center justify-center py-20 border border-dashed border-white/5 rounded-[2rem] bg-white/[0.01]">
            <div className="w-16 h-16 rounded-full bg-white/[0.02] flex items-center justify-center text-slate-700 mb-4">
              <Download size={32} />
            </div>
            <p className="text-sm font-bold text-slate-500">No more templates found</p>
            <p className="text-[10px] font-bold text-slate-700 uppercase tracking-[0.2em] mt-1">Import from community hub</p>
          </div>
        </div>
      </main>
    </div>
  );
}
