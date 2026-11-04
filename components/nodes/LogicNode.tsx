"use client";

import React, { useEffect, useState, useMemo, useRef } from "react";
import { Handle, Position, type NodeProps, useEdges } from "reactflow";
import { GitBranch, Plus, X, CheckCircle, XCircle } from "lucide-react";
import NodeShell from "./NodeShell";
import { useNodeOutputStore } from "@/lib/nodeOutputStore";
import type { LogicCondition } from "@/lib/types";
import { useNodeData } from "@/lib/useNodeData";

const OPERATORS: { value: LogicCondition["operator"]; label: string }[] = [
  { value: "contains", label: "contains" },
  { value: "not_contains", label: "doesn't contain" },
  { value: "equals", label: "equals" },
  { value: "starts_with", label: "starts with" },
  { value: "regex", label: "regex" },
];

/** Coerce a possibly-missing condition into a safe shape. AI-generated
 *  workflows sometimes omit `value` or name it differently (keyword/text/match),
 *  which previously crashed on `c.value.trim()`. */
function normalizeConditions(raw: any): LogicCondition[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    return [{ id: "1", operator: "contains", value: "" }];
  }
  return raw.map((c, i) => {
    const op = OPERATORS.some((o) => o.value === c?.operator) ? c.operator : "contains";
    const v = c?.value ?? c?.keyword ?? c?.text ?? c?.match ?? c?.label ?? "";
    return { id: String(c?.id ?? i + 1), operator: op, value: String(v) };
  });
}

function evaluateCondition(cond: LogicCondition, text: string): boolean {
  const input = text.toLowerCase();
  const raw = cond.value ?? "";
  const value = raw.toLowerCase();
  switch (cond.operator) {
    case "contains":
      return input.includes(value);
    case "not_contains":
      return !input.includes(value);
    case "equals":
      return input.trim() === value.trim();
    case "starts_with":
      return input.startsWith(value);
    case "regex":
      try {
        return new RegExp(raw, "i").test(text);
      } catch {
        return false;
      }
    default:
      return false;
  }
}

export default function LogicNode({ id, selected, data }: NodeProps) {
  const [conditions, setConditions] = useState<LogicCondition[]>(
    normalizeConditions(data?.conditions)
  );
  const [mode, setMode] = useState<"any" | "all">(data?.mode || "any");
  const [retrigger, setRetrigger] = useState(data?.retrigger ?? false);
  const [lastResult, setLastResult] = useState<boolean | null>(null);
  const [evalCount, setEvalCount] = useState(0);
  const lastInputRef = useRef<string | null>(null);

  const updateData = useNodeData(id);
  useEffect(() => {
    updateData({ conditions, mode, retrigger });
  }, [conditions, mode, retrigger, updateData]);

  const edges = useEdges();

  const { sourceNodeId, sourceHandle } = useMemo(() => {
    const incomingEdge = edges.find(
      (e) => e.target === id && e.targetHandle === "input"
    );
    return {
      sourceNodeId: incomingEdge?.source ?? null,
      sourceHandle: incomingEdge?.sourceHandle ?? null,
    };
  }, [edges, id]);

  const outputKey = useMemo(() => {
    if (!sourceNodeId) return null;
    if (sourceHandle && sourceHandle !== "response" && sourceHandle !== "output") {
      return `${sourceNodeId}:${sourceHandle}`;
    }
    return sourceNodeId;
  }, [sourceNodeId, sourceHandle]);

  const sourceOutput = useNodeOutputStore(
    (state) => (outputKey ? state.outputs[outputKey] : undefined)
  );
  
  const sourceVersion = useNodeOutputStore(
    (state) => (outputKey ? (state.versions[outputKey] ?? 0) : 0)
  );

  useEffect(() => {
    if (!sourceOutput || conditions.length === 0) return;
    if (conditions.every((c) => !(c.value ?? "").trim())) return;

    if (!retrigger && sourceOutput === lastInputRef.current) return;
    lastInputRef.current = sourceOutput;

    const activeConditions = conditions.filter((c) => (c.value ?? "").trim());
    if (activeConditions.length === 0) return;

    const results = activeConditions.map((c) => evaluateCondition(c, sourceOutput));
    const passed =
      mode === "any" ? results.some(Boolean) : results.every(Boolean);

    setLastResult(passed);
    setEvalCount((c) => c + 1);

    const store = useNodeOutputStore.getState();
    if (passed) {
      store.setOutput(`${id}:match`, sourceOutput);
    } else {
      store.setOutput(`${id}:no_match`, sourceOutput);
    }
  }, [sourceVersion, conditions, mode, id, retrigger]);

  const addCondition = () => {
    setConditions((prev) => [
      ...prev,
      { id: String(Date.now()), operator: "contains" as const, value: "" },
    ]);
  };

  const removeCondition = (condId: string) => {
    setConditions((prev) => prev.filter((c) => c.id !== condId));
  };

  const updateCondition = (
    condId: string,
    field: "operator" | "value",
    val: string
  ) => {
    setConditions((prev) =>
      prev.map((c) =>
        c.id === condId
          ? { ...c, [field]: val }
          : c
      )
    );
  };

  return (
    <NodeShell
      accent="#f59e0b"
      title="Logic Gate"
      icon={<GitBranch size={16} />}
      status={lastResult !== null ? "running" : "idle"}
      selected={selected}
      width={380}
      id={id}
    >
      <Handle
        type="target"
        position={Position.Left}
        id="input"
        data-tooltip="input"
        style={{
          width: 14,
          height: 14,
          background: "#A855F7",
          border: "3px solid #13131a",
          zIndex: 50,
        }}
      />

      <div className="flex items-center gap-2 mb-3 font-sans">
        <span className="text-xs text-slate-500">Match</span>
        {(["any", "all"] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className="px-2.5 py-1 rounded text-xs font-medium transition-colors nodrag cursor-pointer"
            style={{
              background: mode === m ? "rgba(245, 158, 11, 0.2)" : "#0a0a0f",
              color: mode === m ? "#f59e0b" : "#64748b",
              border: `1px solid ${mode === m ? "rgba(245, 158, 11, 0.3)" : "#1e1e2e"}`,
            }}
          >
            {m.toUpperCase()}
          </button>
        ))}
        <span className="text-xs text-slate-500 ml-1">conditions</span>
      </div>

      <label className="flex items-center gap-2 mb-3 cursor-pointer nodrag select-none font-sans">
        <button
          onClick={() => setRetrigger(!retrigger)}
          className="w-8 h-[18px] rounded-full relative transition-colors nodrag cursor-pointer"
          style={{
            background: retrigger ? "rgba(245, 158, 11, 0.4)" : "#1e1e2e",
            border: `1px solid ${retrigger ? "rgba(245, 158, 11, 0.5)" : "#2a2a3a"}`,
          }}
        >
          <div
            className="absolute top-[2px] w-3 h-3 rounded-full transition-all"
            style={{
              background: retrigger ? "#f59e0b" : "#64748b",
              left: retrigger ? 14 : 2,
            }}
          />
        </button>
        <span className="text-[11px] text-slate-400">
          Fire every evaluation
        </span>
      </label>

      <div className="space-y-2 mb-3 font-sans">
        {conditions.map((cond) => (
          <div key={cond.id} className="flex items-center gap-1.5">
            <select
              value={cond.operator}
              onChange={(e) =>
                updateCondition(cond.id, "operator", e.target.value)
              }
              className="bg-[#0a0a0f] border border-[#1e1e2e] rounded px-2 py-1.5 text-xs text-slate-300 outline-none focus:border-amber-500/40 nodrag"
              style={{ minWidth: 110 }}
            >
              {OPERATORS.map((op) => (
                <option key={op.value} value={op.value}>
                  {op.label}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={cond.value ?? ""}
              onChange={(e) =>
                updateCondition(cond.id, "value", e.target.value)
              }
              className="flex-1 bg-[#0a0a0f] border border-[#1e1e2e] rounded px-2 py-1.5 text-xs text-slate-300 outline-none focus:border-amber-500/40 nodrag"
              placeholder="value..."
            />
            {conditions.length > 1 && (
              <button
                onClick={() => removeCondition(cond.id)}
                className="p-1 rounded text-slate-600 hover:text-red-400 transition-colors nodrag cursor-pointer"
              >
                <X size={12} />
              </button>
            )}
          </div>
        ))}
      </div>

      <button
        onClick={addCondition}
        className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-amber-400 transition-colors mb-3 nodrag cursor-pointer font-sans"
      >
        <Plus size={12} />
        Add Condition
      </button>

      {lastResult !== null && (
        <div
          className="flex items-center gap-2 rounded-md px-3 py-2 font-sans"
          style={{
            background: lastResult ? "#10b98115" : "#ef444415",
            border: `1px solid ${lastResult ? "#10b98125" : "#ef444425"}`,
          }}
        >
          {lastResult ? (
            <CheckCircle size={14} className="text-emerald-400" />
          ) : (
            <XCircle size={14} className="text-red-400" />
          )}
          <span
            className="text-xs font-medium"
            style={{ color: lastResult ? "#10b981" : "#ef4444" }}
          >
            {lastResult ? "MATCH" : "NO MATCH"}
          </span>
          <span className="text-[10px] text-slate-500 ml-auto font-mono">
            {evalCount} evals
          </span>
        </div>
      )}

      <Handle
        type="source"
        position={Position.Right}
        id="match"
        data-tooltip="match"
        style={{
          width: 14,
          height: 14,
          background: "#10b981",
          border: "3px solid #13131a",
          top: "40%",
          zIndex: 50,
        }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="no_match"
        data-tooltip="no match"
        style={{
          width: 14,
          height: 14,
          background: "#ef4444",
          border: "3px solid #13131a",
          top: "65%",
          zIndex: 50,
        }}
      />
    </NodeShell>
  );
}
