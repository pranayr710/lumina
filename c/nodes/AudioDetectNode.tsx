"use client";

import React, { useEffect, useState, useRef, useMemo } from "react";
import { Handle, Position, type NodeProps, useEdges } from "reactflow";
import { AudioLines, Loader, CheckCircle, XCircle } from "lucide-react";
import NodeShell from "./NodeShell";
import { pipelineSocket } from "@/l/websocket";
import { useAudioStore } from "@/l/audioStore";
import { useNodeOutputStore } from "@/l/nodeOutputStore";
import { useNodeData } from "@/l/useNodeData";

interface AudioDetection {
  label: string;
  confidence: number;
}

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

export default function AudioDetectNode({ id, selected, data }: NodeProps) {
  const [confidence, setConfidence] = useState<number>(
    data?.confidence ?? 30
  );
  const [listenDuration, setListenDuration] = useState<number>(
    data?.listenDuration ?? 3
  );
  const [detections, setDetections] = useState<AudioDetection[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [recordedSecs, setRecordedSecs] = useState(0);
  const [latencyMs, setLatencyMs] = useState(0);
  const [filterText, setFilterText] = useState<string>(data?.filterLabels ?? "");
  const [retrigger, setRetrigger] = useState(data?.retrigger ?? true);
  const [lastMatch, setLastMatch] = useState<boolean | null>(null);

  const phaseRef = useRef<Phase>("idle");
  const chunksRef = useRef<string[]>([]);
  const lastSeenAudioRef = useRef<string>("");
  const lastOutputRef = useRef<string | null>(null);

  const updateData = useNodeData(id);
  useEffect(() => {
    updateData({ confidence, listenDuration, filterLabels: filterText, retrigger });
  }, [confidence, listenDuration, filterText, retrigger, updateData]);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const filterLabels = useMemo(() => {
    if (!filterText.trim()) return null;
    return filterText
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0);
  }, [filterText]);

  const edges = useEdges();

  const connectedMicId = useMemo(() => {
    const incomingEdge = edges.find(
      (e) => e.target === id && e.targetHandle === "audio"
    );
    return incomingEdge?.source ?? null;
  }, [edges, id]);

  const filteredDetections = useMemo(() => {
    if (!filterLabels || filterLabels.length === 0) return detections;
    return detections.filter((d) =>
      filterLabels.some((f) => d.label.toLowerCase().includes(f))
    );
  }, [detections, filterLabels]);

  const filterLabelsRef = useRef(filterLabels);
  useEffect(() => {
    filterLabelsRef.current = filterLabels;
  }, [filterLabels]);

  const retriggerRef = useRef(retrigger);
  useEffect(() => {
    retriggerRef.current = retrigger;
  }, [retrigger]);

  useEffect(() => {
    const handler = (payload: any) => {
      if (payload.node_id !== id) return;

      const dets: AudioDetection[] = payload.detections || [];
      setDetections(dets);
      setLatencyMs(payload.latency_ms || 0);

      const fl = filterLabelsRef.current;
      const filtered =
        !fl || fl.length === 0
          ? dets
          : dets.filter((d) =>
              fl.some((f) => d.label.toLowerCase().includes(f))
            );

      const matched = filtered.length > 0;
      setLastMatch(matched);

      const outputText = matched
        ? filtered
            .map((d) => `${d.label} ${(d.confidence * 100).toFixed(0)}%`)
            .join(", ")
        : "nothing detected";

      if (!retriggerRef.current && outputText === lastOutputRef.current) {
        // Skip duplicate
      } else {
        lastOutputRef.current = outputText;
        const store = useNodeOutputStore.getState();
        if (matched) {
          store.setOutput(`${id}:match`, outputText);
          store.setOutput(id, outputText);
        } else {
          store.setOutput(`${id}:no_match`, outputText);
          store.setOutput(id, outputText);
        }
      }

      chunksRef.current = [];
      lastSeenAudioRef.current = "";
      setRecordedSecs(0);
      setPhase("recording");
    };
    pipelineSocket.on("audio_result", handler);
    return () => pipelineSocket.off("audio_result", handler);
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
        pipelineSocket.sendAudioAnalyze(combined, id, confidence / 100);
      }
    }, 200);

    return () => clearInterval(pollInterval);
  }, [connectedMicId, listenDuration, id, confidence]);

  useEffect(() => {
    if (phase !== "analyzing") return;
    const timeout = setTimeout(() => {
      chunksRef.current = [];
      lastSeenAudioRef.current = "";
      setRecordedSecs(0);
      setPhase("recording");
    }, 10000);
    return () => clearTimeout(timeout);
  }, [phase]);

  const confColor = (c: number) => {
    if (c >= 0.75) return "#10b981";
    if (c >= 0.5) return "#f59e0b";
    return "#ef4444";
  };

  const recordPct =
    listenDuration > 0 ? Math.round((recordedSecs / listenDuration) * 100) : 0;

  return (
    <NodeShell
      accent="#8B5CF6"
      title="Audio Detect"
      icon={<AudioLines size={16} />}
      status={phase !== "idle" ? "running" : "idle"}
      selected={selected}
      width={340}
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

      <div className="flex items-center gap-2 mb-3">
        <span
          className="text-[10px] font-mono px-2.5 py-1 rounded-full"
          style={{
            background: "rgba(139, 92, 246, 0.15)",
            color: "#8B5CF6",
            border: "1px solid rgba(139, 92, 246, 0.25)",
          }}
        >
          YamNet &middot; ONNX
        </span>
        <span
          className="text-[10px] font-mono px-2 py-1 rounded-full animate-pulse"
          style={{
            background: "rgba(52, 168, 83, 0.15)",
            color: "#34A853",
            border: "1px solid rgba(52, 168, 83, 0.25)",
          }}
        >
          NPU
        </span>
        {!connectedMicId && (
          <span className="text-[10px] text-slate-500 ml-auto">
            No mic connected
          </span>
        )}
      </div>

      {phase === "recording" && connectedMicId && (
        <div className="mb-3 font-sans">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] text-violet-400 font-medium">
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
                background: "linear-gradient(90deg, #8b5cf6, #a78bfa)",
                transition: "width 0.3s ease-out",
              }}
            />
          </div>
        </div>
      )}

      {phase === "analyzing" && (
        <div className="flex items-center gap-2 text-sm text-violet-400 mb-3 font-sans">
          <Loader size={14} className="animate-spin" />
          Analyzing {listenDuration}s of audio...
        </div>
      )}

      <div className="flex items-center gap-3 mb-2 font-sans">
        <span className="text-xs text-slate-500 w-16 shrink-0">
          Confidence
        </span>
        <input
          type="range"
          min={5}
          max={95}
          value={confidence}
          onChange={(e) => setConfidence(Number(e.target.value))}
          className="flex-1 h-1.5 accent-violet-400 nodrag nowheel"
        />
        <span className="text-xs text-slate-400 font-mono w-10 text-right">
          {confidence}%
        </span>
      </div>

      <div className="flex items-center gap-3 mb-3 font-sans">
        <span className="text-xs text-slate-500 w-16 shrink-0">Listen</span>
        <input
          type="range"
          min={1}
          max={10}
          value={listenDuration}
          onChange={(e) => setListenDuration(Number(e.target.value))}
          className="flex-1 h-1.5 accent-violet-400 nodrag nowheel"
        />
        <span className="text-xs text-slate-400 font-mono w-10 text-right">
          {listenDuration}s
        </span>
      </div>

      <div className="mb-3 font-sans">
        <span className="text-xs text-slate-500 block mb-1.5">
          Filter sounds
        </span>
        <input
          type="text"
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          placeholder="e.g. speech, music, dog"
          className="w-full bg-[#0a0a0f] border border-[#1e1e2e] rounded-lg px-3 py-2 text-sm text-slate-300 outline-none focus:border-violet-500/40 font-mono nodrag nowheel"
        />
      </div>

      <label className="flex items-center gap-2 mb-3 cursor-pointer nodrag select-none font-sans">
        <button
          onClick={() => setRetrigger(!retrigger)}
          className="w-8 h-[18px] rounded-full relative transition-colors nodrag cursor-pointer"
          style={{
            background: retrigger ? "rgba(139, 92, 246, 0.4)" : "#1e1e2e",
            border: `1px solid ${retrigger ? "rgba(139, 92, 246, 0.5)" : "#2a2a3a"}`,
          }}
        >
          <div
            className="absolute top-[2px] w-3 h-3 rounded-full transition-all"
            style={{
              background: "#8B5CF6",
              left: retrigger ? 14 : 2,
            }}
          />
        </button>
        <span className="text-[11px] text-slate-400">
          Auto-repeat after results
        </span>
      </label>

      <div
        className="rounded-lg p-3 nodrag nowheel font-sans"
        style={{
          background: "#0a0a0f",
          minHeight: 50,
          maxHeight: 180,
          overflowY: "auto",
        }}
      >
        {filteredDetections.length > 0 ? (
          <div className="space-y-1.5 font-sans">
            {filteredDetections.map((d, i) => (
              <div
                key={`${d.label}-${i}`}
                className="flex items-center gap-2 text-xs"
              >
                <span className="text-slate-300 flex-1 truncate">
                  {d.label}
                </span>
                <div
                  className="h-1.5 rounded-full"
                  style={{
                    width: `${Math.round(d.confidence * 60)}px`,
                    background: confColor(d.confidence),
                    minWidth: 4,
                  }}
                />
                <span
                  className="font-mono w-10 text-right"
                  style={{ color: confColor(d.confidence) }}
                >
                  {(d.confidence * 100).toFixed(0)}%
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-slate-600 text-center py-2 font-sans">
            {connectedMicId
              ? detections.length > 0 && filteredDetections.length === 0
                ? `No matches for "${filterText}"`
                : phase === "idle"
                  ? "Waiting for mic..."
                  : "No sounds detected yet"
              : "Connect a microphone to start detection"}
          </p>
        )}
      </div>

      {lastMatch !== null && (
        <div
          className="flex items-center gap-2 rounded-md px-3 py-2 mt-2 font-sans"
          style={{
            background: lastMatch ? "#10b98115" : "#ef444415",
            border: `1px solid ${lastMatch ? "#10b98125" : "#ef444425"}`,
          }}
        >
          {lastMatch ? (
            <CheckCircle size={14} className="text-emerald-400" />
          ) : (
            <XCircle size={14} className="text-red-400" />
          )}
          <span
            className="text-xs font-medium"
            style={{ color: lastMatch ? "#10b981" : "#ef4444" }}
          >
            {lastMatch ? "MATCH" : "NO MATCH"}
          </span>
          <span className="text-[10px] text-slate-500 ml-auto font-mono">
            {filteredDetections.length} sound{filteredDetections.length !== 1 ? "s" : ""}
          </span>
        </div>
      )}

      {latencyMs > 0 && (
        <div className="mt-1 text-right font-sans">
          <span className="text-[10px] font-mono text-slate-500">
            {latencyMs.toFixed(0)}ms
          </span>
        </div>
      )}

      <Handle
        type="source"
        position={Position.Right}
        id="match"
        data-tooltip="match"
        style={{
          background: "#10b981",
          border: "2px solid #13131a",
          top: "40%",
        }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="no_match"
        data-tooltip="no match"
        style={{
          background: "#ef4444",
          border: "2px solid #13131a",
          top: "65%",
        }}
      />

      <div
        className="absolute text-[9px] font-mono text-emerald-500/60"
        style={{ right: 14, top: "37%" }}
      >
        match
      </div>
      <div
        className="absolute text-[9px] font-mono text-red-500/60"
        style={{ right: 14, top: "62%" }}
      >
        no match
      </div>
    </NodeShell>
  );
}
