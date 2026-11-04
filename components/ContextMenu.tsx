"use client";

import React, { useEffect, useRef } from "react";
import { Copy, Trash2, Pin, PinOff } from "lucide-react";

interface ContextMenuProps {
  x: number;
  y: number;
  nodeId: string;
  nodePinned: boolean;
  onDuplicate: () => void;
  onDelete: () => void;
  onPin: () => void;
  onClose: () => void;
}

export default function ContextMenu({
  x, y, nodePinned, onDuplicate, onDelete, onPin, onClose,
}: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Element)) onClose();
    };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", esc); };
  }, [onClose]);

  // Keep menu on screen
  const left = Math.min(x, window.innerWidth - 180);
  const top  = Math.min(y, window.innerHeight - 140);

  return (
    <div
      ref={ref}
      className="fixed z-[300] min-w-[170px] rounded-xl border border-white/10 bg-[#09090d]/98 backdrop-blur-xl shadow-2xl py-1.5 text-xs"
      style={{ left, top }}
      onContextMenu={e => e.preventDefault()}
    >
      <button
        onClick={() => { onDuplicate(); onClose(); }}
        className="w-full flex items-center gap-3 px-4 py-2.5 text-slate-300 hover:bg-white/5 hover:text-white transition-all"
      >
        <Copy size={12} />
        <span>Duplicate</span>
        <span className="ml-auto text-[10px] text-slate-600">Ctrl+D</span>
      </button>
      <button
        onClick={() => { onPin(); onClose(); }}
        className="w-full flex items-center gap-3 px-4 py-2.5 text-slate-300 hover:bg-white/5 hover:text-white transition-all"
      >
        {nodePinned ? <PinOff size={12} /> : <Pin size={12} />}
        <span>{nodePinned ? "Unpin Preview" : "Pin Preview"}</span>
      </button>
      <div className="my-1 border-t border-white/5" />
      <button
        onClick={() => { onDelete(); onClose(); }}
        className="w-full flex items-center gap-3 px-4 py-2.5 text-rose-400 hover:bg-rose-500/10 transition-all"
      >
        <Trash2 size={12} />
        <span>Delete Node</span>
        <span className="ml-auto text-[10px] text-rose-700">Del</span>
      </button>
    </div>
  );
}
