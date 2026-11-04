"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import { Handle, Position, useEdges } from "reactflow";
import { ListRestart, MessageSquareQuote, Loader, Mic } from "lucide-react";
import { useAudioStore } from "@/lib/audioStore";
import { useNodeOutputStore } from "@/lib/nodeOutputStore";
import { useNodeData } from "@/lib/useNodeData";
import { pipelineSocket } from "@/lib/websocket";
import NodeShell from "./NodeShell";

/** Merge base64-encoded float32 PCM chunks into one base64 blob. */
function concatBase64Pcm(chunks: string[]): string {
  const arrays: Uint8Array[] = [];
  let total = 0;
  for (const b64 of chunks) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    arrays.push(bytes);
    total += bytes.length;
  }
  const merged = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) { merged.set(a, off); off += a.length; }
  let bin = "";
  const CHUNK = 8192;
  for (let i = 0; i < merged.length; i += CHUNK) {
    bin += String.fromCharCode(...merged.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

export default function WhisperNode({ id, selected, data }: any) {
  const [transcript, setTranscript] = useState(data.text || "Waiting for audio...");
  const [loading, setLoading] = useState(false);
  const [listenDuration, setListenDuration] = useState<number>(data?.listenDuration ?? 4);
  const [recordedSecs, setRecordedSecs] = useState(0);

  const chunksRef = useRef<string[]>([]);
  const lastSeenAudioRef = useRef<string>("");
  const setOutput = useNodeOutputStore((s) => s.setOutput);

  const updateData = useNodeData(id);
  useEffect(() => {
    updateData({ listenDuration });
  }, [listenDuration, updateData]);

  // Find the upstream mic from the LIVE canvas edges (not the debounced
  // workflow store, which lagged behind and left this node stuck).
  const edges = useEdges();
  const connectedMicId = useMemo(() => {
    const e = edges.find((e) => e.target === id && e.targetHandle === "audio");
    return e?.source ?? null;
  }, [edges, id]);

  // Receive transcription results from the backend.
  useEffect(() => {
    const unsub = pipelineSocket.on("stt_result", (payload: any) => {
      if (payload.node_id !== id) return;
      const text = (payload.transcript || "").trim();
      setTranscript(text || "[no speech detected]");
      setLoading(false);
      // Only fire downstream on real speech — don't spam the log with
      // "[no speech detected]" or "[Whisper error …]" status messages.
      if (text && !text.startsWith("[")) setOutput(id, text);
    });
    return () => unsub();
  }, [id, setOutput]);

  // Accumulate ~listenDuration seconds of mic audio, then transcribe.
  useEffect(() => {
    if (!connectedMicId) {
      setTranscript("Waiting for audio...");
      return;
    }
    chunksRef.current = [];
    lastSeenAudioRef.current = "";
    setRecordedSecs(0);

    const poll = setInterval(() => {
      if (loading) return; // don't stack windows while a transcription is in flight
      const audio = useAudioStore.getState().getAudio(connectedMicId);
      if (!audio || audio === lastSeenAudioRef.current) return;

      lastSeenAudioRef.current = audio;
      chunksRef.current.push(audio);
      setRecordedSecs(chunksRef.current.length);

      if (chunksRef.current.length >= listenDuration) {
        const combined = concatBase64Pcm(chunksRef.current);
        chunksRef.current = [];
        setRecordedSecs(0);
        setLoading(true);
        pipelineSocket.sendWhisper(combined, id);
      }
    }, 200);

    return () => clearInterval(poll);
  }, [connectedMicId, listenDuration, id, loading]);

  // Safety net: never let a dropped/slow backend response wedge the node on
  // "Transcribing…" forever — clear the loading state after 20s and resume.
  useEffect(() => {
    if (!loading) return;
    const t = setTimeout(() => {
      setLoading(false);
      lastSeenAudioRef.current = "";
    }, 20000);
    return () => clearTimeout(t);
  }, [loading]);

  const recordPct = listenDuration > 0 ? Math.round((recordedSecs / listenDuration) * 100) : 0;
  const waiting = transcript === "Waiting for audio...";

  return (
    <NodeShell
      accent="#34A853"
      title="Whisper STT"
      icon={<ListRestart size={16} />}
      status={loading ? "running" : !waiting ? "running" : "idle"}
      selected={selected}
      width={320}
      id={id}
    >
      <Handle
        type="target"
        position={Position.Left}
        id="audio"
        className="w-3 h-3 bg-[#FBBC05] border-2 border-[#13131a]"
      />

      <div className="flex items-center gap-2 mb-3 font-sans">
        <span
          className="text-[10px] font-mono px-2.5 py-1 rounded-full"
          style={{ background: "rgba(52, 168, 83, 0.15)", color: "#34A853", border: "1px solid rgba(52, 168, 83, 0.25)" }}
        >
          Whisper &middot; base
        </span>
        {!connectedMicId && (
          <span className="text-[10px] text-slate-500 ml-auto">No mic connected</span>
        )}
      </div>

      {connectedMicId && !loading && (
        <div className="mb-3 font-sans">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] text-emerald-400 font-medium flex items-center gap-1">
              <Mic size={11} /> Listening {recordedSecs}/{listenDuration}s
            </span>
            <span className="text-[10px] text-slate-500 font-mono">{recordPct}%</span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "#1e1e2e" }}>
            <div
              className="h-full rounded-full"
              style={{ width: `${recordPct}%`, background: "linear-gradient(90deg, #34A853, #6ee7a8)", transition: "width 0.3s ease-out" }}
            />
          </div>
        </div>
      )}

      <div className="flex items-center gap-3 mb-3 font-sans">
        <span className="text-xs text-slate-500 w-16 shrink-0">Window</span>
        <input
          type="range"
          min={2}
          max={10}
          value={listenDuration}
          onChange={(e) => setListenDuration(Number(e.target.value))}
          className="flex-1 h-1.5 accent-emerald-400 nodrag nowheel"
        />
        <span className="text-xs text-slate-400 font-mono w-10 text-right">{listenDuration}s</span>
      </div>

      <div className="p-1 font-sans">
        <div className="bg-[#0a0a0f] border border-[#282838] rounded-xl p-4 min-h-[100px] flex flex-col gap-3">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-emerald-400">
              <Loader size={14} className="animate-spin" /> Transcribing {listenDuration}s of audio...
            </div>
          ) : (
            <>
              <MessageSquareQuote size={20} className="text-slate-700" />
              <p className="text-sm text-slate-300 leading-relaxed italic font-sans">
                "{transcript}"
              </p>
            </>
          )}
        </div>
      </div>

      <Handle
        type="source"
        position={Position.Right}
        id="output"
        className="w-3 h-3 bg-[#34A853] border-2 border-[#13131a]"
      />
    </NodeShell>
  );
}
