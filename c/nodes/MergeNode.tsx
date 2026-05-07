"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import { Handle, Position, type NodeProps, useEdges } from "reactflow";
import { GitMerge } from "lucide-react";
import NodeShell from "./NodeShell";
import { useNodeOutputStore } from "@/l/nodeOutputStore";
import { useNodeData } from "@/l/useNodeData";

type MergeMode = "AND" | "OR" | "WAIT_ALL";

export default function MergeNode({ id, selected, data }: NodeProps) {
  const [mode, setMode] = useState<MergeMode>(data?.mode || "AND");
  const edges = useEdges();
  
  const updateData = useNodeData(id);
  useEffect(() => {
    updateData({ mode });
  }, [mode, updateData]);

  const getUpstream = (targetHandle: string) => {
    const edge = edges.find(e => e.target === id && e.targetHandle === targetHandle);
    if (!edge) return { output: undefined, version: 0 };
    
    const sourceId = edge.source;
    const sourceHandle = edge.sourceHandle;
    const key = (sourceHandle && sourceHandle !== "output" && sourceHandle !== "response") 
      ? `${sourceId}:${sourceHandle}` 
      : sourceId;
      
    return {
      output: useNodeOutputStore.getState().outputs[key],
      version: useNodeOutputStore.getState().versions[key] ?? 0
    };
  };

  const inputA = getUpstream("inputA");
  const inputB = getUpstream("inputB");

  const lastProcessedA = useRef(0);
  const lastProcessedB = useRef(0);

  useEffect(() => {
    let shouldTrigger = false;
    let combinedOutput = "";

    if (mode === "OR") {
      if (inputA.version > lastProcessedA.current) {
        shouldTrigger = true;
        combinedOutput = inputA.output || "";
      } else if (inputB.version > lastProcessedB.current) {
        shouldTrigger = true;
        combinedOutput = inputB.output || "";
      }
    } else if (mode === "AND") {
      if (inputA.version > lastProcessedA.current && inputB.output) {
        shouldTrigger = true;
        combinedOutput = inputA.output || "";
      } else if (inputB.version > lastProcessedB.current && inputA.output) {
        shouldTrigger = true;
        combinedOutput = inputB.output || "";
      }
    } else if (mode === "WAIT_ALL") {
      if (inputA.version > lastProcessedA.current && inputB.version > lastProcessedB.current) {
        shouldTrigger = true;
        combinedOutput = `${inputA.output}\n${inputB.output}`;
      }
    }

    if (shouldTrigger) {
      lastProcessedA.current = inputA.version;
      lastProcessedB.current = inputB.version;
      useNodeOutputStore.getState().setOutput(id, combinedOutput);
    }
  }, [inputA.version, inputB.version, mode, id]);

  const status = useMemo(() => {
    const hasA = !!inputA.output;
    const hasB = !!inputB.output;
    if (hasA && hasB) return "running";
    if (hasA || hasB) return "idle";
    return "idle";
  }, [inputA.output, inputB.output]);

  return (
    <NodeShell
      accent="#8b5cf6"
      title="Merge / Join"
      icon={<GitMerge size={16} />}
      status={status}
      selected={selected}
      width={280}
    >
      <Handle
        type="target"
        position={Position.Left}
        id="inputA"
        style={{ top: "30%", background: "#8b5cf6", border: "2px solid #13131a" }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="inputB"
        style={{ top: "70%", background: "#8b5cf6", border: "2px solid #13131a" }}
      />

      <div className="space-y-3 font-sans">
        <div className="flex gap-1 bg-[#0a0a0f] p-1 rounded-lg border border-[#1e1e2e]">
          {(["AND", "OR", "WAIT_ALL"] as MergeMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`flex-1 py-1.5 text-[9px] font-bold rounded-md transition-all uppercase tracking-wider cursor-pointer ${
                mode === m 
                  ? "bg-[#8b5cf6] text-white shadow-lg" 
                  : "text-slate-500 hover:text-slate-300 hover:bg-white/5"
              }`}
            >
              {m.replace("_", " ")}
            </button>
          ))}
        </div>

        <div className="space-y-2 px-1">
          <div className="flex items-center justify-between text-[10px]">
            <span className={inputA.output ? "text-purple-400" : "text-slate-600"}>
              Input A {inputA.output ? "✓" : "○"}
            </span>
            <span className={inputB.output ? "text-purple-400" : "text-slate-600"}>
              Input B {inputB.output ? "✓" : "○"}
            </span>
          </div>
          
          <div className="text-[9px] text-slate-500 leading-tight bg-black/20 p-2 rounded italic">
            {mode === "AND" && "Triggers if EITHER updates, but ONLY if BOTH have current values."}
            {mode === "OR" && "Triggers whenever EITHER input updates."}
            {mode === "WAIT_ALL" && "Triggers ONLY when BOTH have fresh updates."}
          </div>
        </div>
      </div>

      <Handle
        type="source"
        position={Position.Right}
        id="output"
        className="w-3 h-3 bg-[#8b5cf6] border-2 border-[#13131a]"
      />
    </NodeShell>
  );
}
