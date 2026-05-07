"use client";

import React from "react";
import { ArrowRight, Shield, Cpu, GitBranch, Eye, Mic, Sparkles } from "lucide-react";

interface LandingPageProps {
  onEnter: () => void;
}

export default function LandingPage({ onEnter }: LandingPageProps) {
  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col items-center justify-center relative bg-[#030305]">
      {/* Background grid effect */}
      <div 
        className="absolute inset-0 pointer-events-none opacity-20" 
        style={{
          backgroundImage: "radial-gradient(circle at 1px 1px, #1a1a2e 1px, transparent 0)",
          backgroundSize: "40px 40px",
        }} 
      />

      {/* Glow orbs - Premium Google / Gemini aesthetic */}
      <div 
        className="absolute pointer-events-none" 
        style={{
          width: 600, height: 600,
          top: "10%", left: "20%",
          background: "radial-gradient(circle, rgba(66,133,244,0.06) 0%, transparent 75%)",
          filter: "blur(80px)",
        }} 
      />
      <div 
        className="absolute pointer-events-none" 
        style={{
          width: 500, height: 500,
          bottom: "10%", right: "15%",
          background: "radial-gradient(circle, rgba(168,85,247,0.05) 0%, transparent 75%)",
          filter: "blur(80px)",
        }} 
      />

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center gap-12 max-w-2xl px-8 animate-fade-in-up">
        {/* Logo and Headings */}
        <div className="flex flex-col items-center gap-6">
          <div
            className="flex items-center justify-center w-20 h-20 rounded-2xl bg-white/[0.02] border border-white/5 shadow-[0_0_50px_rgba(66,133,244,0.08)] relative group overflow-hidden"
          >
            {/* Beautiful gradient border outline */}
            <div className="absolute inset-0 bg-gradient-to-tr from-[#4285F4] via-[#A855F7] to-[#EA4335] opacity-20 group-hover:opacity-40 transition-opacity duration-300" />
            <Sparkles size={32} className="text-[#A855F7] relative z-10 animate-pulse" />
          </div>
          
          <div className="text-center">
            <h1 className="text-6xl font-black tracking-[0.25em] bg-gradient-to-r from-white via-[#e8eaf6] to-slate-400 bg-clip-text text-transparent uppercase leading-none font-sans">
              LUMINA
            </h1>
            <p className="text-xs font-bold text-slate-500 tracking-[0.4em] uppercase mt-4">
              Privacy-First AI Pipeline Orchestrator
            </p>
          </div>

          <p className="text-sm text-slate-400 text-center leading-relaxed max-w-md mt-2 font-medium">
            Wire local camera feeds, audio streams, object detection, and Google Gemini 2.0 Fallbacks in real-time. Secure, on-device execution accelerated by local hardware.
          </p>
        </div>

        {/* Feature pills */}
        <div className="flex flex-wrap justify-center gap-3">
          {[
            { icon: <Eye size={12} />, label: "Computer Vision", color: "#4285F4" },
            { icon: <Mic size={12} />, label: "Audio Analytics", color: "#FBBC05" },
            { icon: <Shield size={12} />, label: "Zero-Cloud Privacy", color: "#34A853" },
            { icon: <Cpu size={12} />, label: "On-Device Inference", color: "#EA4335" },
            { icon: <Sparkles size={12} />, label: "Gemini 2.0 Flash", color: "#A855F7" },
          ].map((feat) => (
            <div
              key={feat.label}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest bg-white/[0.02] border border-white/5 text-slate-400 transition-all hover:border-white/10 hover:bg-white/[0.03]"
            >
              <span style={{ color: feat.color }}>{feat.icon}</span>
              {feat.label}
            </div>
          ))}
        </div>

        {/* Enter button */}
        <button
          onClick={() => {
            console.log("Launching Lumina Workspace...");
            onEnter();
          }}
          className="group relative z-50 flex items-center gap-4 px-10 py-4 rounded-xl text-xs font-bold uppercase tracking-[0.2em] transition-all hover:scale-[1.02] active:scale-[0.98] mt-4 bg-white text-black hover:bg-gradient-to-r hover:from-[#4285F4] hover:to-[#A855F7] hover:text-white transition-all cursor-pointer shadow-[0_4px_20px_rgba(66,133,244,0.15)]"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          Launch Orchestrator
          <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />
        </button>

        {/* Tagline */}
        <p className="text-[10px] font-bold text-slate-700 tracking-widest uppercase mt-2">
          Reimagined by Google. Secure by Default.
        </p>
      </div>
    </div>
  );
}
