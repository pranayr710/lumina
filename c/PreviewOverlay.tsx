"use client";

import React, { useState, useEffect } from "react";
import { X, Maximize2, Minimize2, Move } from "lucide-react";
import { useFrameStore } from "@/l/frameStore";

interface PreviewOverlayProps {
  nodeId: string;
  label: string;
  onClose: () => void;
}

export default function PreviewOverlay({ nodeId, label, onClose }: PreviewOverlayProps) {
  const frame = useFrameStore((state) => state.frames[nodeId]);
  const [isExpanded, setIsExpanded] = useState(false);
  const [position, setPosition] = useState({ x: 20, y: 80 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    setDragOffset({
      x: e.clientX - position.x,
      y: e.clientY - position.y
    });
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        setPosition({
          x: e.clientX - dragOffset.x,
          y: e.clientY - dragOffset.y
        });
      }
    };
    const handleMouseUp = () => setIsDragging(false);

    if (isDragging) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    }
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, dragOffset]);

  return (
    <div
      className={`fixed z-[100] transition-all duration-300 ease-out group ${isExpanded ? "w-[640px]" : "w-[320px]"}`}
      style={{
        left: position.x,
        top: position.y,
        transform: isDragging ? "scale(1.02)" : "scale(1)",
        pointerEvents: "auto"
      }}
    >
      <div className="bg-[#13131a] rounded-xl overflow-hidden border border-[#282838] shadow-2xl shadow-black/60">
        {/* Header */}
        <div 
          className="flex items-center justify-between px-3 py-2 border-b border-[#1e1e2e] bg-[#1a1a25] cursor-move select-none"
          onMouseDown={handleMouseDown}
        >
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-[#4285F4] animate-pulse" />
            <span className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">{label}</span>
          </div>
          <div className="flex items-center gap-1">
            <button 
              onClick={() => setIsExpanded(!isExpanded)}
              className="p-1 hover:bg-white/5 rounded text-slate-500 hover:text-slate-200 transition-colors"
            >
              {isExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
            <button 
              onClick={onClose}
              className="p-1 hover:bg-red-500/10 rounded text-slate-500 hover:text-red-400 transition-colors"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="relative aspect-video bg-black font-sans">
          {frame ? (
            <img src={frame} alt="Preview" className="w-full h-full object-contain" />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-700">
              <Move size={24} className="mb-2 opacity-20" />
              <p className="text-[10px] uppercase font-bold tracking-tighter opacity-40">No Signal</p>
            </div>
          )}
          
          <div className="absolute bottom-2 right-2 bg-black/60 backdrop-blur-md px-2 py-0.5 rounded text-[9px] font-mono text-[#4285F4]/80 border border-[#4285F4]/20">
            {nodeId}
          </div>
        </div>
      </div>
    </div>
  );
}
