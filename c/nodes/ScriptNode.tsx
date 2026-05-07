"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { Handle, Position, type NodeProps } from "reactflow";
import { Code2, Play, Loader } from "lucide-react";
import { pipelineSocket } from "@/l/websocket";
import { useUpstreamTrigger } from "@/l/useUpstreamTrigger";
import { useNodeOutputStore } from "@/l/nodeOutputStore";
import { useNodeData } from "@/l/useNodeData";
import NodeShell from "./NodeShell";

export default function ScriptNode({ id, selected, data }: NodeProps) {
  const [code, setCode] = useState(data.code || "output = input.upper()");
  const [output, setOutputState] = useState("");
  const [processing, setProcessing] = useState(false);
  const processingRef = useRef(false);

  const updateData = useNodeData(id);
  useEffect(() => {
    updateData({ code });
  }, [code, updateData]);

  const { sourceOutput, sourceVersion } = useUpstreamTrigger(id, "input");

  const runScript = useCallback((inputVal: string) => {
    if (processingRef.current) return;
    processingRef.current = true;
    setProcessing(true);
    pipelineSocket.send("run_script", {
      node_id: id,
      code,
      input: inputVal
    });
  }, [id, code]);

  useEffect(() => {
    if (sourceVersion === 0 || sourceOutput === undefined) return;
    runScript(sourceOutput);
  }, [sourceVersion, sourceOutput, runScript]);

  useEffect(() => {
    const unsub = pipelineSocket.on("script_result", (payload: any) => {
      if (payload.node_id === id) {
        setProcessing(false);
        processingRef.current = false;
        if (payload.success) {
          setOutputState(payload.output);
          useNodeOutputStore.getState().setOutput(id, payload.output);
        } else {
          setOutputState("Error: " + payload.error);
        }
      }
    });
    return () => unsub();
  }, [id]);

  const onManualRun = () => {
    runScript(sourceOutput || "test input");
  };

  return (
    <NodeShell
      accent="#EA4335"
      title="Python Script"
      icon={<Code2 size={16} />}
      status={processing ? "running" : output ? "running" : "idle"}
      selected={selected}
      width={320}
    >
      <Handle 
        type="target" 
        position={Position.Left} 
        id="input"
        className="w-3 h-3 bg-[#EA4335] border-2 border-[#13131a]" 
      />

      <div className="space-y-4 font-sans">
        <div>
          <label className="text-[10px] font-bold text-slate-500 uppercase mb-2 block tracking-widest font-sans">
            Python Code
          </label>
          <textarea
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="w-full bg-[#0a0a0f] border border-[#282838] rounded-xl p-3 text-xs font-mono text-emerald-400 outline-none focus:border-[#EA4335]/50 h-32 resize-none nodrag nowheel"
            placeholder="input -> process -> output"
          />
        </div>

        <button
          onClick={onManualRun}
          disabled={processing}
          className="w-full flex items-center justify-center gap-2 py-2 rounded-md text-xs font-medium transition-colors nodrag disabled:opacity-30 cursor-pointer font-sans"
          style={{
            background: "rgba(234, 67, 53, 0.15)",
            color: "#EA4335",
            border: "1px solid rgba(234, 67, 53, 0.25)",
          }}
        >
          {processing ? (
            <Loader size={14} className="animate-spin" />
          ) : (
            <Play size={14} />
          )}
          Run Script
        </button>

        {output && (
          <div className="bg-black/40 p-3 rounded-xl border border-white/5 font-mono text-[10px] text-slate-400 max-h-32 overflow-y-auto">
            {output}
          </div>
        )}
      </div>

      <Handle 
        type="source" 
        position={Position.Right} 
        id="output"
        className="w-3 h-3 bg-[#EA4335] border-2 border-[#13131a]" 
      />
    </NodeShell>
  );
}
