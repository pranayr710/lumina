"use client";

import React, { useEffect, useState, useRef, useMemo, useCallback } from "react";
import { Handle, Position, type NodeProps, useEdges } from "reactflow";
import { Ear, Loader } from "lucide-react";
import NodeShell from "./NodeShell";
import { pipelineSocket } from "@/l/websocket";
import { useAudioStore } from "@/l/audioStore";
import { useNodeOutputStore } from "@/l/nodeOutputStore";
import { useNodeData } from "@/l/useNodeData";

function concatBase64Pcm(chunks: string[]): string {
  const arrays: Uint8Array[] = [];
  let totalLen = 0;
  for (const b64 of chunks) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    arrays.push(bytes);
    totalLen += bytes.length;
  }
  const merged = new Uint8Array(totalLen);
  let offset = 0;
  for (const a of arrays) {
    merged.set(a, offset);
    offset += a.length;
  }
  let binary = "";
  const CHUNK = 8192;
  for (let i = 0; i < merged.length; i += CHUNK) {
    binary += String.fromCharCode(...merged.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

type Phase = "idle" | "recording" | "analyzing";

export default function AudioLlmNode({ id, selected, data }: NodeProps) {
  const [prompt, setPrompt] = useState<string>(
    data?.prompt || "Describe what you hear. Identify any notable sounds."
  );
  const [listenDuration, setListenDuration] = useState<number>(
    data?.listenDuration ?? 3
  );
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [recordedSecs, setRecordedSecs] = useState(0);
  const [latencyMs, setLatencyMs] = useState(0);

  const phaseRef = useRef<Phase>("idle");
  const chunksRef = useRef<string[]>([]);
  const lastSeenAudioRef = useRef<string>("");
  const promptRef = useRef(prompt);

  const updateData = useNodeData(id);
  useEffect(() => {
    updateData({ prompt, listenDuration });
  }, [prompt, listenDuration, updateData]);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
  useEffect(() => {
    promptRef.current = prompt;
  }, [prompt]);

  const edges = useEdges();

  const connectedMicId = useMemo(() => {
    const incomingEdge = edges.find(
      (e) => e.target === id && e.targetHandle === "audio"
    );
    return incomingEdge?.source ?? null;
  }, [edges, id]);

  useEffect(() => {
    const handler = (payload: any) => {
      if (payload.node_id === id) {
        setAnalysis(payload.analysis || "");
        setLatencyMs(payload.latency_ms || 0);
        useNodeOutputStore.getState().setOutput(id, payload.analysis || "");
        chunksRef.current = [];
        lastSeenAudioRef.current = "";
        setRecordedSecs(0);
        setPhase("recording");
      }
    };
    pipelineSocket.on("audio_llm_result", handler);
    return () => pipelineSocket.off("audio_llm_result", handler);
  }, [id]);

  useEffect(() => {
    if (!connectedMicId) {
      setPhase("idle");
      return;
    }

    chunksRef.current = [];
    lastSeenAudioRef.current = "";
    setRecordedSecs(0);
    setPhase("recording");

    const pollInterval = setInterval(() => {
      if (phaseRef.current !== "recording") return;

      const audio = useAudioStore.getState().getAudio(connectedMicId);
      if (!audio || audio === lastSeenAudioRef.current) return;

      lastSeenAudioRef.current = audio;
      chunksRef.current.push(audio);
      setRecordedSecs(chunksRef.current.length);

      if (chunksRef.current.length >= listenDuration) {
        const combined = concatBase64Pcm(chunksRef.current);
        chunksRef.current = [];
        setRecordedSecs(0);
        setPhase("analyzing");
        pipelineSocket.sendAudioLlmAnalyze(combined, promptRef.current, id);
      }
    }, 200);

    return () => clearInterval(pollInterval);
  }, [connectedMicId, listenDuration, id]);

  useEffect(() => {
    if (phase !== "analyzing") return;
    const timeout = setTimeout(() => {
      chunksRef.current = [];
      lastSeenAudioRef.current = "";
      setRecordedSecs(0);
      setPhase("recording");
    }, 30000);
    return () => clearTimeout(timeout);
  }, [phase]);

  const manualAnalyze = useCallback(() => {
    if (!connectedMicId || phaseRef.current === "analyzing") return;
    const audio = useAudioStore.getState().getAudio(connectedMicId);
    if (!audio) return;
    const chunks = chunksRef.current.length > 0
      ? chunksRef.current
      : [audio];
    const combined = concatBase64Pcm(chunks);
    chunksRef.current = [];
    setRecordedSecs(0);
    setPhase("analyzing");
    pipelineSocket.sendAudioLlmAnalyze(combined, promptRef.current, id);
  }, [connectedMicId, id]);

  const recordPct =
    listenDuration > 0 ? Math.round((recordedSecs / listenDuration) * 100) : 0;

  return (
    <NodeShell
      accent="#ec4899"
      title="Audio LLM"
      icon={<Ear size={16} />}
      status={phase !== "idle" ? "running" : analysis ? "running" : "idle"}
      selected={selected}
      width={420}
      id={id}
    >
      <Handle
        type="target"
        position={Position.Left}
        id="audio"
        data-tooltip="audio"
        style={{
          background: "#FBBC05",
          border: "2px solid #13131a",
        }}
      />

      <div
        className="absolute text-[9px] font-mono text-yellow-500/60 font-sans"
        style={{ left: 14, top: "32%" }}
      >
        audio
      </div>

      <div className="flex items-center gap-2 mb-3">
        <span
          className="text-[10px] font-mono px-2.5 py-1 rounded-full animate-pulse"
          style={{
            background: "rgba(236, 72, 153, 0.15)",
            color: "#ec4899",
            border: "1px solid rgba(236, 72, 153, 0.25)",
          }}
        >
          Gemini Preferred
        </span>
        <span
          className="text-[10px] font-mono px-2 py-1 rounded-full"
          style={{
            background: "rgba(52, 168, 83, 0.15)",
            color: "#34A853",
            border: "1px solid rgba(52, 168, 83, 0.25)",
          }}
        >
          ON-DEVICE
        </span>
        {!connectedMicId && (
          <span className="text-[10px] text-slate-500 ml-auto font-sans">
            No mic connected
          </span>
        )}
      </div>

      {phase === "recording" && connectedMicId && (
        <div className="mb-3 font-sans">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] text-pink-400 font-medium font-sans">
              Recording {recordedSecs}/{listenDuration}s
            </span>
            <span className="text-[10px] text-slate-500 font-mono">
              {recordPct}%
            </span>
          </div>
          <div
            className="h-1.5 rounded-full overflow-hidden"
            style={{ background: "#1e1e2e" }}
          >
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${recordPct}%`,
                background: "linear-gradient(90deg, #ec4899, #f472b6)",
                transition: "width 0.3s ease-out",
              }}
            />
          </div>
        </div>
      )}

      <div className="flex items-center gap-3 mb-3 font-sans">
        <span className="text-xs text-slate-500 w-16 shrink-0">Listen</span>
        <input
          type="range"
          min={1}
          max={10}
          value={listenDuration}
          onChange={(e) => setListenDuration(Number(e.target.value))}
          className="flex-1 h-1.5 accent-pink-400 nodrag nowheel"
        />
        <span className="text-xs text-slate-400 font-mono w-8 text-right">
          {listenDuration}s
        </span>
      </div>

      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={3}
        className="w-full bg-[#0a0a0f] border border-[#1e1e2e] rounded-lg px-3 py-2.5 text-sm text-slate-300 outline-none focus:border-pink-500/40 resize-none leading-relaxed mb-3 nodrag nowheel font-sans"
        placeholder="What should the AI listen for?"
      />

      <button
        onClick={manualAnalyze}
        disabled={phase === "analyzing" || !connectedMicId}
        className="w-full flex items-center justify-center gap-2 py-2 rounded-md text-xs font-medium transition-colors mb-3 nodrag disabled:opacity-30 cursor-pointer font-sans"
        style={{
          background: "rgba(236, 72, 153, 0.15)",
          color: "#ec4899",
          border: "1px solid rgba(236, 72, 153, 0.25)",
        }}
      >
        {phase === "analyzing" ? (
          <>
            <Loader size={12} className="animate-spin" />
            Analyzing {listenDuration}s of audio...
          </>
        ) : (
          "Analyze Now"
        )}
      </button>

      <div
        className="rounded-lg p-3 nodrag nowheel font-sans"
        style={{
          background: "#0a0a0f",
          minHeight: 60,
          maxHeight: 200,
          overflowY: "auto",
        }}
      >
        {phase === "analyzing" && !analysis ? (
          <div className="flex items-center gap-2 text-sm text-pink-400">
            <Loader size={14} className="animate-spin" />
            Analyzing audio...
          </div>
        ) : analysis ? (
          <p className="text-sm text-slate-300 leading-relaxed font-sans">{analysis}</p>
        ) : (
          <p className="text-xs text-slate-600 text-center py-3 font-sans">
            Connect a microphone and set your prompt
          </p>
        )}
      </div>

      {latencyMs > 0 && (
        <div className="mt-2 text-right">
          <span className="text-[10px] font-mono text-slate-500">
            {latencyMs.toFixed(0)}ms
          </span>
        </div>
      )}

      <Handle
        type="source"
        position={Position.Right}
        id="response"
        data-tooltip="response"
        style={{
          background: "#ec4899",
          border: "2px solid #13131a",
        }}
      />
    </NodeShell>
  );
}
