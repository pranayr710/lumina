"use client";

import React, { useState, useEffect, useRef } from "react";
import { Handle, Position, type NodeProps } from "reactflow";
import { Timer, Zap } from "lucide-react";
import NodeShell from "./NodeShell";
import { useUpstreamTrigger } from "@/l/useUpstreamTrigger";
import { useNodeOutputStore } from "@/l/nodeOutputStore";
import { useNodeData } from "@/l/useNodeData";

export default function DebounceNode({ id, selected, data }: NodeProps) {
  const [cooldown, setCooldown] = useState<number>(data?.cooldown || 60);
  const [lastTriggerTime, setLastTriggerTime] = useState<number>(0);
  const [onCooldown, setOnCooldown] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const updateData = useNodeData(id);
  useEffect(() => {
    updateData({ cooldown });
  }, [cooldown, updateData]);

  const { sourceOutput, sourceVersion } = useUpstreamTrigger(id, "input");

  useEffect(() => {
    if (sourceVersion === 0 || sourceOutput === undefined) return;
    
    const now = Date.now();
    const elapsed = (now - lastTriggerTime) / 1000;

    if (elapsed >= cooldown) {
      setLastTriggerTime(now);
      setOnCooldown(true);
      useNodeOutputStore.getState().setOutput(id, sourceOutput);
      
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        setOnCooldown(false);
      }, cooldown * 1000);
    }
  }, [sourceVersion, sourceOutput, cooldown, id, lastTriggerTime]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const remaining = Math.max(0, cooldown - (Date.now() - lastTriggerTime) / 1000);

  return (
    <NodeShell
      accent="#FBBC05"
      title="Debounce Cooldown"
      icon={<Timer size={16} />}
      status={onCooldown ? "running" : "idle"}
      selected={selected}
      width={280}
    >
      <Handle
        type="target"
        position={Position.Left}
        id="input"
        className="w-3 h-3 bg-[#FBBC05] border-2 border-[#13131a]"
      />

      <div className="space-y-4 font-sans">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Cooldown (sec)</span>
          <span className="text-xs font-mono text-amber-500">{cooldown}s</span>
        </div>
        
        <input
          type="range"
          min={1}
          max={3600}
          value={cooldown}
          onChange={(e) => setCooldown(parseInt(e.target.value))}
          className="w-full h-1.5 accent-amber-500 nodrag nowheel"
        />

        {onCooldown ? (
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 flex items-center gap-3">
            <div className="relative w-8 h-8 flex-shrink-0">
               <svg className="w-full h-full transform -rotate-90">
                 <circle
                   cx="16"
                   cy="16"
                   r="14"
                   stroke="currentColor"
                   strokeWidth="3"
                   fill="transparent"
                   className="text-amber-500/10"
                 />
                 <circle
                   cx="16"
                   cy="16"
                   r="14"
                   stroke="currentColor"
                   strokeWidth="3"
                   fill="transparent"
                   strokeDasharray={88}
                   strokeDashoffset={88 * (1 - remaining / cooldown)}
                   className="text-amber-500 transition-all duration-1000"
                 />
               </svg>
               <Zap size={12} className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-amber-500" />
            </div>
            <div className="flex-1">
              <p className="text-[10px] font-bold text-amber-500 uppercase tracking-tighter">Cooldown Active</p>
              <p className="text-[9px] text-slate-500">Ignoring inputs for {Math.ceil(remaining)}s</p>
            </div>
          </div>
        ) : (
          <div className="bg-slate-800/20 border border-white/5 rounded-lg p-3 text-center">
            <p className="text-[10px] text-slate-500 uppercase">Ready to trigger</p>
          </div>
        )}
      </div>

      <Handle
        type="source"
        position={Position.Right}
        id="output"
        className="w-3 h-3 bg-[#FBBC05] border-2 border-[#13131a]"
      />
    </NodeShell>
  );
}
