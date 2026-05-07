"use client";

import React, { useEffect, useState, useRef, useCallback } from "react";
import { Handle, Position, type NodeProps, useEdges } from "reactflow";
import { Wrench, Loader, CheckCircle, XCircle, Plus, Trash2 } from "lucide-react";
import NodeShell from "./NodeShell";
import { pipelineSocket } from "@/l/websocket";
import { useNodeOutputStore } from "@/l/nodeOutputStore";
import { useNodeData } from "@/l/useNodeData";

interface ToolParam {
  name: string;
  description: string;
}

export default function ToolUseNode({ id, selected, data }: NodeProps) {
  const [toolName, setToolName] = useState<string>(data?.tool_name || "search_web");
  const [toolDesc, setToolDesc] = useState<string>(
    data?.tool_description || "Search the web for information about a topic"
  );
  const [callUrl, setCallUrl] = useState<string>(data?.call_url || "");
  const [params, setParams] = useState<ToolParam[]>(
    data?.tool_parameters_list || [{ name: "query", description: "The search query" }]
  );
  const [lastResult, setLastResult] = useState<{ called: boolean; args?: any; reason?: string } | null>(null);
  const [processing, setProcessing] = useState(false);

  const updateData = useNodeData(id);
  useEffect(() => {
    const paramObj = Object.fromEntries(params.map((p) => [p.name, { description: p.description }]));
    updateData({ tool_name: toolName, tool_description: toolDesc, call_url: callUrl, tool_parameters: paramObj, tool_parameters_list: params });
  }, [toolName, toolDesc, callUrl, params, updateData]);

  const edges = useEdges();
  const inputVersion = useNodeOutputStore((s) => {
    const inEdge = edges.find((e) => e.target === id && e.targetHandle === "input");
    if (!inEdge) return 0;
    return s.versions[inEdge.source] ?? 0;
  });
  const lastVersionRef = useRef(0);

  useEffect(() => {
    const handler = (d: any) => {
      if (d.node_id !== id) return;
      setProcessing(false);
      setLastResult({ called: d.called, args: d.args, reason: d.reason });
      if (d.called) {
        const outputText = JSON.stringify(d.args);
        useNodeOutputStore.getState().setOutput(id, outputText);
      }
    };
    pipelineSocket.on("tool_use_result", handler);
    return () => pipelineSocket.off("tool_use_result", handler);
  }, [id]);

  const fireTool = useCallback(() => {
    const inEdge = edges.find((e) => e.target === id && e.targetHandle === "input");
    if (!inEdge) return;
    const inputText = useNodeOutputStore.getState().outputs[inEdge.source] ?? "";
    if (!inputText || processing) return;

    setProcessing(true);
    const paramObj = Object.fromEntries(params.map((p) => [p.name, { description: p.description }]));
    pipelineSocket.send("tool_use", {
      node_id: id,
      input_text: inputText,
      tool_name: toolName,
      tool_description: toolDesc,
      tool_parameters: paramObj,
      call_url: callUrl,
    });
  }, [edges, id, toolName, toolDesc, callUrl, params, processing]);

  // Trigger on upstream output change
  useEffect(() => {
    if (inputVersion === 0 || inputVersion === lastVersionRef.current) return;
    lastVersionRef.current = inputVersion;
    fireTool();
  }, [inputVersion, fireTool]);

  const addParam = () => setParams((p) => [...p, { name: "", description: "" }]);
  const removeParam = (i: number) => setParams((p) => p.filter((_, idx) => idx !== i));
  const updateParam = (i: number, field: "name" | "description", val: string) => {
    setParams((p) => p.map((item, idx) => idx === i ? { ...item, [field]: val } : item));
  };

  return (
    <NodeShell
      accent="#6366F1"
      title="Tool Use"
      icon={<Wrench size={16} />}
      status={processing ? "running" : lastResult?.called ? "running" : "idle"}
      selected={selected}
      width={380}
      id={id}
      inferenceMode="gemini"
    >
      <Handle
        type="target" position={Position.Left} id="input"
        style={{ width: 12, height: 12, background: "#6366F1", border: "3px solid #13131a", zIndex: 50 }}
      />

      <div className="flex items-center gap-2 mb-3">
        <span
          className="text-[10px] font-mono px-2 py-1 rounded-full"
          style={{ background: "rgba(99,102,241,0.15)", color: "#6366F1", border: "1px solid rgba(99,102,241,0.25)" }}
        >
          Gemini Function Calling
        </span>
      </div>

      {/* Tool name */}
      <div className="mb-3">
        <label className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 block">Tool Name</label>
        <input
          value={toolName}
          onChange={(e) => setToolName(e.target.value)}
          className="w-full bg-[#0a0a0f] border border-[#1e1e2e] rounded-md px-3 py-1.5 text-xs text-slate-300 outline-none focus:border-indigo-400/40 nodrag font-mono"
          placeholder="tool_name"
        />
      </div>

      {/* Tool description */}
      <div className="mb-3">
        <label className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 block">Description</label>
        <input
          value={toolDesc}
          onChange={(e) => setToolDesc(e.target.value)}
          className="w-full bg-[#0a0a0f] border border-[#1e1e2e] rounded-md px-3 py-1.5 text-xs text-slate-300 outline-none focus:border-indigo-400/40 nodrag"
          placeholder="What this tool does..."
        />
      </div>

      {/* Parameters */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-2">
          <label className="text-[10px] text-slate-500 uppercase tracking-wider">Parameters</label>
          <button onClick={addParam} className="text-indigo-400 hover:text-indigo-300 nodrag cursor-pointer">
            <Plus size={12} />
          </button>
        </div>
        <div className="space-y-2">
          {params.map((p, i) => (
            <div key={i} className="flex gap-2 items-center">
              <input
                value={p.name}
                onChange={(e) => updateParam(i, "name", e.target.value)}
                className="w-24 bg-[#0a0a0f] border border-[#1e1e2e] rounded px-2 py-1 text-[11px] text-slate-300 outline-none nodrag font-mono"
                placeholder="name"
              />
              <input
                value={p.description}
                onChange={(e) => updateParam(i, "description", e.target.value)}
                className="flex-1 bg-[#0a0a0f] border border-[#1e1e2e] rounded px-2 py-1 text-[11px] text-slate-300 outline-none nodrag"
                placeholder="description"
              />
              <button onClick={() => removeParam(i)} className="text-slate-600 hover:text-red-400 nodrag cursor-pointer">
                <Trash2 size={11} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Call URL */}
      <div className="mb-3">
        <label className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 block">
          Execute URL <span className="text-slate-600 normal-case">(optional HTTP endpoint)</span>
        </label>
        <input
          value={callUrl}
          onChange={(e) => setCallUrl(e.target.value)}
          className="w-full bg-[#0a0a0f] border border-[#1e1e2e] rounded-md px-3 py-1.5 text-xs text-slate-400 outline-none focus:border-indigo-400/40 nodrag font-mono"
          placeholder="https://api.example.com/tool"
        />
      </div>

      {/* Status */}
      <div
        className="rounded-lg p-3 nodrag nowheel min-h-[48px]"
        style={{ background: "#0a0a0f" }}
      >
        {processing ? (
          <div className="flex items-center gap-2 text-sm text-indigo-400">
            <Loader size={12} className="animate-spin" />
            Gemini deciding...
          </div>
        ) : lastResult ? (
          <div className="flex items-start gap-2">
            {lastResult.called ? (
              <CheckCircle size={12} className="text-emerald-400 mt-0.5 shrink-0" />
            ) : (
              <XCircle size={12} className="text-slate-500 mt-0.5 shrink-0" />
            )}
            <div>
              {lastResult.called ? (
                <>
                  <p className="text-[10px] text-emerald-400 font-bold mb-1">Tool called: {toolName}</p>
                  <p className="text-[10px] text-slate-400 font-mono break-all">
                    {JSON.stringify(lastResult.args)}
                  </p>
                </>
              ) : (
                <p className="text-[10px] text-slate-500">Not called — {lastResult.reason}</p>
              )}
            </div>
          </div>
        ) : (
          <p className="text-xs text-slate-600 text-center">
            Waiting for upstream input...
          </p>
        )}
      </div>

      <Handle
        type="source" position={Position.Right} id="output"
        style={{ width: 12, height: 12, background: "#6366F1", border: "3px solid #13131a", zIndex: 50 }}
      />
    </NodeShell>
  );
}
