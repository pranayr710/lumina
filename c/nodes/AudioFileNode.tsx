"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import { Handle, Position, type NodeProps } from "reactflow";
import { Music, Play, Square, Upload, RotateCcw } from "lucide-react";
import NodeShell from "./NodeShell";
import { useAudioStore } from "@/l/audioStore";
import { useWorkflowStore } from "@/l/workflowStore";
import { useNodeData } from "@/l/useNodeData";
import {
  isSwitching,
  getSwitchFromWorkflowId,
  parkCapture,
  reclaimCapture,
} from "@/l/captureRegistry";

const SAMPLE_RATE = 16000;
const CHUNK_SAMPLES = 16000;

function encodeChunk(chunk: Float32Array): string {
  const bytes = new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  let binary = "";
  const BLOCK = 8192;
  for (let i = 0; i < bytes.length; i += BLOCK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + BLOCK));
  }
  return btoa(binary);
}

export default function AudioFileNode({ id, selected, data }: NodeProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const decodedPcmRef = useRef<Float32Array | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const positionRef = useRef<number>(0);

  const activeRef = useRef(false);
  const loopRef = useRef(data?.loop ?? true);
  const fileNameRef = useRef<string | null>(null);

  const [hasFile, setHasFile] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [active, setActive] = useState(false);
  const [loop, setLoop] = useState(data?.loop ?? true);
  const [chunkCount, setChunkCount] = useState(0);
  const [totalChunks, setTotalChunks] = useState(0);
  const [currentPosition, setCurrentPosition] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);

  useEffect(() => { activeRef.current = active; }, [active]);
  useEffect(() => { loopRef.current = loop; }, [loop]);
  useEffect(() => { fileNameRef.current = fileName; }, [fileName]);

  const updateData = useNodeData(id);
  useEffect(() => {
    updateData({ loop });
  }, [loop, updateData]);

  const createChunkInterval = useCallback((storeKey: string) => {
    return setInterval(() => {
      const pcm = decodedPcmRef.current;
      if (!pcm) return;

      const pos = positionRef.current;
      const start = pos * CHUNK_SAMPLES;

      if (start >= pcm.length) {
        if (loopRef.current) {
          positionRef.current = 0;
          setCurrentPosition(0);
          return;
        } else {
          if (intervalRef.current) clearInterval(intervalRef.current);
          intervalRef.current = null;
          setActive(false);
          activeRef.current = false;
          return;
        }
      }

      const end = Math.min(start + CHUNK_SAMPLES, pcm.length);
      let chunk: Float32Array;

      if (end - start < CHUNK_SAMPLES) {
        chunk = new Float32Array(CHUNK_SAMPLES);
        chunk.set(pcm.subarray(start, end));
      } else {
        chunk = pcm.slice(start, end);
      }

      useAudioStore.getState().setAudio(storeKey, encodeChunk(chunk));
      positionRef.current = pos + 1;
      setChunkCount((c) => c + 1);
      setCurrentPosition(pos + 1);
    }, 1000);
  }, []);

  const startChunkEmission = useCallback(
    (storeKey: string) => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = createChunkInterval(storeKey);
    },
    [createChunkInterval]
  );

  useEffect(() => {
    const wfId = useWorkflowStore.getState().activeWorkflowId;
    if (wfId) {
      const parked = reclaimCapture(wfId, id);
      if (parked && parked.type === "audioFile") {
        decodedPcmRef.current = parked.decodedPcm;
        objectUrlRef.current = parked.objectUrl;
        positionRef.current = parked.position;

        setFileName(parked.fileName);
        setLoop(parked.loop);
        setHasFile(true);
        setTotalChunks(Math.ceil(parked.decodedPcm.length / CHUNK_SAMPLES));
        setDuration(parked.decodedPcm.length / SAMPLE_RATE);
        setCurrentPosition(parked.position);

        useAudioStore.getState().removeAudio(`${wfId}::${id}`);

        if (parked.intervalId) clearInterval(parked.intervalId);

        if (parked.active) {
          startChunkEmission(id);
          setActive(true);
        }
      }
    }

    return () => {
      if (!decodedPcmRef.current || !objectUrlRef.current) return;

      const parkWfId = isSwitching()
        ? getSwitchFromWorkflowId()
        : useWorkflowStore.getState().activeWorkflowId;

      if (parkWfId) {
        useAudioStore.getState().removeAudio(id);
        if (intervalRef.current) clearInterval(intervalRef.current);

        const wasActive = activeRef.current;
        let parkInterval: ReturnType<typeof setInterval> | null = null;

        if (wasActive) {
          parkInterval = createChunkInterval(`${parkWfId}::${id}`);
        }

        parkCapture(parkWfId, id, {
          type: "audioFile",
          decodedPcm: decodedPcmRef.current!,
          objectUrl: objectUrlRef.current!,
          fileName: fileNameRef.current || "",
          intervalId: parkInterval,
          position: positionRef.current,
          active: wasActive,
          loop: loopRef.current,
          nodeId: id,
          workflowId: parkWfId,
        });

        decodedPcmRef.current = null;
        objectUrlRef.current = null;
        intervalRef.current = null;
      } else {
        if (intervalRef.current) clearInterval(intervalRef.current);
        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
        useAudioStore.getState().removeAudio(id);
        decodedPcmRef.current = null;
        objectUrlRef.current = null;
        intervalRef.current = null;
      }
    };
  }, [id]);

  const onFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    if (intervalRef.current) clearInterval(intervalRef.current);
    setActive(false);
    activeRef.current = false;
    setError(null);
    setChunkCount(0);
    setCurrentPosition(0);
    positionRef.current = 0;

    try {
      const arrayBuffer = await file.arrayBuffer();
      const url = URL.createObjectURL(file);
      objectUrlRef.current = url;

      const audioCtx = new AudioContext();
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

      const offlineCtx = new OfflineAudioContext(
        1,
        Math.ceil(audioBuffer.duration * SAMPLE_RATE),
        SAMPLE_RATE
      );
      const source = offlineCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(offlineCtx.destination);
      source.start(0);

      const rendered = await offlineCtx.startRendering();
      decodedPcmRef.current = new Float32Array(rendered.getChannelData(0));
      audioCtx.close();

      const dur = decodedPcmRef.current.length / SAMPLE_RATE;
      setFileName(file.name);
      setHasFile(true);
      setDuration(dur);
      setTotalChunks(Math.ceil(decodedPcmRef.current.length / CHUNK_SAMPLES));
    } catch (err: any) {
      setError(`Could not decode audio: ${err.message || err}`);
    }
  }, []);

  const startCapture = useCallback(() => {
    if (!decodedPcmRef.current) {
      setError("Select an audio file first");
      return;
    }
    setError(null);
    startChunkEmission(id);
    setActive(true);
  }, [id, startChunkEmission]);

  const stopCapture = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setActive(false);
    useAudioStore.getState().removeAudio(id);
  }, [id]);

  const resetPosition = useCallback(() => {
    positionRef.current = 0;
    setCurrentPosition(0);
  }, []);

  const progressPct = totalChunks > 0
    ? Math.round((currentPosition / totalChunks) * 100)
    : 0;

  return (
    <NodeShell
      accent="#FBBC05"
      title="Audio File Stream"
      icon={<Music size={16} />}
      status={active ? "running" : error ? "error" : "idle"}
      selected={selected}
      width={300}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*"
        onChange={onFileSelect}
        className="hidden"
      />

      <div
        className="relative rounded-lg overflow-hidden mb-4 font-sans"
        style={{ background: "#0a0a0f", height: 64 }}
      >
        {hasFile ? (
          <div className="flex flex-col justify-center h-full px-3 gap-1.5 font-sans">
            <div className="flex items-center gap-2">
              <Music size={16} className="text-[#FBBC05] flex-shrink-0" />
              <div
                className="flex-1 h-2 rounded-full overflow-hidden"
                style={{ background: "#1e1e2e" }}
              >
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${progressPct}%`,
                    background: "linear-gradient(90deg, #FBBC05, #f59e0b)",
                    transition: "width 0.3s ease-out",
                  }}
                />
              </div>
              <span className="text-[10px] font-mono text-[#FBBC05] w-12 text-right">
                {currentPosition}/{totalChunks}s
              </span>
            </div>
            <div className="flex items-center justify-between px-6 font-sans">
              <span className="text-[10px] text-slate-500 font-mono">
                {Math.floor(duration / 60)}:{String(Math.floor(duration % 60)).padStart(2, "0")}
              </span>
              {active && (
                <span className="text-[10px] text-[#FBBC05] font-mono">
                  #{chunkCount} chunks
                </span>
              )}
            </div>
          </div>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <Music size={24} className="text-slate-600" />
          </div>
        )}
      </div>

      {fileName && (
        <div className="mb-3 flex items-center gap-2 font-sans">
          <span className="text-xs text-slate-400 truncate flex-1 font-mono">
            {fileName}
          </span>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={active}
            className="text-[10px] text-[#FBBC05] hover:text-[#FBBC05]/80 disabled:opacity-40 nodrag cursor-pointer"
          >
            Change
          </button>
        </div>
      )}

      {!fileName && (
        <button
          onClick={() => fileInputRef.current?.click()}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-md text-sm font-medium transition-colors mb-4 nodrag cursor-pointer font-sans"
          style={{
            background: "rgba(251, 188, 5, 0.1)",
            color: "#FBBC05",
            border: "1px solid rgba(251, 188, 5, 0.25)",
          }}
        >
          <Upload size={14} />
          Select Audio File
        </button>
      )}

      {hasFile && (
        <div className="flex items-center gap-3 mb-4 font-sans">
          <label className="flex items-center gap-2 cursor-pointer nodrag select-none flex-1">
            <button
              onClick={() => setLoop(!loop)}
              className="w-8 h-[18px] rounded-full relative transition-colors nodrag cursor-pointer"
              style={{
                background: loop ? "rgba(251, 188, 5, 0.3)" : "#1e1e2e",
                border: `1px solid ${loop ? "rgba(251, 188, 5, 0.4)" : "#2a2a3a"}`,
              }}
            >
              <div
                className="absolute top-[2px] w-3 h-3 rounded-full transition-all"
                style={{
                  background: "#FBBC05",
                  left: loop ? 14 : 2,
                }}
              />
            </button>
            <span className="text-[11px] text-slate-400">Loop</span>
          </label>
          <button
            onClick={resetPosition}
            disabled={active}
            className="text-[10px] text-slate-500 hover:text-yellow-400 disabled:opacity-30 nodrag flex items-center gap-1 cursor-pointer"
          >
            <RotateCcw size={10} />
            Reset
          </button>
        </div>
      )}

      <button
        onClick={active ? stopCapture : startCapture}
        disabled={!hasFile}
        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-md text-sm font-medium transition-colors nodrag disabled:opacity-40 cursor-pointer font-sans"
        style={{
          background: active ? "#ef444420" : "rgba(251, 188, 5, 0.15)",
          color: active ? "#ef4444" : "#FBBC05",
          border: `1px solid ${active ? "#ef444430" : "rgba(251, 188, 5, 0.25)"}`,
        }}
      >
        {active ? <Square size={14} /> : <Play size={14} />}
        {active ? "Stop" : "Start Capture"}
      </button>

      {error && <p className="text-xs text-red-400 mt-3 font-sans">{error}</p>}

      <Handle
        type="source"
        position={Position.Right}
        id="audio"
        data-tooltip="audio"
        style={{
          background: "#FBBC05",
          border: "2px solid #13131a",
        }}
      />
    </NodeShell>
  );
}
