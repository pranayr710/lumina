"use client";

import React, { useEffect, useState, useRef, useCallback } from "react";
import { Handle, Position, type NodeProps } from "reactflow";
import { Volume2, Upload, Play } from "lucide-react";
import NodeShell from "./NodeShell";
import { useUpstreamTrigger } from "@/l/useUpstreamTrigger";
import { useNodeData } from "@/l/useNodeData";

type SoundPreset = "beep" | "siren" | "chime";

export default function SoundAlertNode({ id, selected, data }: NodeProps) {
  const [preset, setPreset] = useState<SoundPreset>(data?.soundPreset || "beep");
  const [customAudioUrl, setCustomAudioUrl] = useState<string | null>(null);
  const [customAudioName, setCustomAudioName] = useState<string | null>(null);
  const [triggerCount, setTriggerCount] = useState(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const customAudioRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { sourceOutput, sourceVersion } = useUpstreamTrigger(id, "trigger");

  const updateData = useNodeData(id);
  useEffect(() => {
    updateData({ soundPreset: preset });
  }, [preset, updateData]);

  useEffect(() => {
    return () => {
      if (customAudioUrl) URL.revokeObjectURL(customAudioUrl);
    };
  }, [customAudioUrl]);

  const getAudioCtx = useCallback(() => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
    }
    const ctx = audioCtxRef.current;
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }, []);

  const playBeep = useCallback(() => {
    try {
      const ctx = getAudioCtx();
      [600, 800, 1000].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = freq;
        osc.type = "sine";
        gain.gain.value = 0.25;
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + i * 0.2 + 0.18);
        osc.start(ctx.currentTime + i * 0.2);
        osc.stop(ctx.currentTime + i * 0.2 + 0.18);
      });
    } catch {}
  }, [getAudioCtx]);

  const playSiren = useCallback(() => {
    try {
      const ctx = getAudioCtx();
      [440, 880, 440, 880].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = freq;
        osc.type = "sawtooth";
        gain.gain.value = 0.18;
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + i * 0.15 + 0.13);
        osc.start(ctx.currentTime + i * 0.15);
        osc.stop(ctx.currentTime + i * 0.15 + 0.13);
      });
    } catch {}
  }, [getAudioCtx]);

  const playChime = useCallback(() => {
    try {
      const ctx = getAudioCtx();
      [1200, 900, 600].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = freq;
        osc.type = "triangle";
        gain.gain.value = 0.2;
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + i * 0.25 + 0.3);
        osc.start(ctx.currentTime + i * 0.25);
        osc.stop(ctx.currentTime + i * 0.25 + 0.3);
      });
    } catch {}
  }, [getAudioCtx]);

  const playSound = useCallback(() => {
    if (customAudioUrl) {
      if (!customAudioRef.current) {
        customAudioRef.current = new Audio();
      }
      customAudioRef.current.src = customAudioUrl;
      customAudioRef.current.play().catch(() => {});
      return;
    }
    if (preset === "beep") playBeep();
    else if (preset === "siren") playSiren();
    else if (preset === "chime") playChime();
  }, [customAudioUrl, preset, playBeep, playSiren, playChime]);

  useEffect(() => {
    if (!sourceOutput || sourceVersion === 0) return;
    setTriggerCount((c) => c + 1);
    playSound();
  }, [sourceVersion]);

  const onFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (customAudioUrl) URL.revokeObjectURL(customAudioUrl);
    const url = URL.createObjectURL(file);
    setCustomAudioUrl(url);
    setCustomAudioName(file.name);
  };

  const clearCustom = () => {
    if (customAudioUrl) URL.revokeObjectURL(customAudioUrl);
    setCustomAudioUrl(null);
    setCustomAudioName(null);
    if (customAudioRef.current) {
      customAudioRef.current.pause();
      customAudioRef.current = null;
    }
  };

  const presets: { key: SoundPreset; label: string }[] = [
    { key: "beep", label: "Beep" },
    { key: "siren", label: "Siren" },
    { key: "chime", label: "Chime" },
  ];

  return (
    <NodeShell
      accent="#f97316"
      title="Sound Alert"
      icon={<Volume2 size={16} />}
      status={triggerCount > 0 ? "running" : "idle"}
      selected={selected}
      width={320}
    >
      <Handle
        type="target"
        position={Position.Left}
        id="trigger"
        data-tooltip="trigger"
        style={{ background: "#f59e0b", border: "2px solid #13131a" }}
      />

      <div className="flex gap-1.5 mb-3 font-sans">
        {presets.map((p) => (
          <button
            key={p.key}
            onClick={() => { setPreset(p.key); clearCustom(); }}
            className="flex-1 px-2 py-1.5 rounded-md text-xs font-medium transition-colors nodrag cursor-pointer"
            style={{
              background: !customAudioUrl && preset === p.key ? "rgba(249, 115, 22, 0.2)" : "#0a0a0f",
              color: !customAudioUrl && preset === p.key ? "#f97316" : "#64748b",
              border: `1px solid ${!customAudioUrl && preset === p.key ? "rgba(249, 115, 22, 0.3)" : "#1e1e2e"}`,
            }}
          >
            {p.label}
          </button>
        ))}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*"
        onChange={onFileSelect}
        className="hidden"
      />

      <div className="font-sans">
        {customAudioName ? (
          <div className="flex items-center gap-2 mb-3 px-2 py-1.5 rounded-md" style={{ background: "rgba(249, 115, 22, 0.1)", border: "1px solid rgba(249, 115, 22, 0.25)" }}>
            <Volume2 size={12} className="text-orange-400 shrink-0" />
            <span className="text-xs text-orange-300 truncate flex-1 font-mono">{customAudioName}</span>
            <button onClick={clearCustom} className="text-[10px] text-slate-500 hover:text-slate-300 nodrag cursor-pointer">Clear</button>
          </div>
        ) : (
          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-full flex items-center justify-center gap-2 py-1.5 rounded-md text-xs text-slate-500 transition-colors mb-3 nodrag cursor-pointer"
            style={{ background: "#0a0a0f", border: "1px solid #1e1e2e" }}
          >
            <Upload size={11} />
            Upload custom audio
          </button>
        )}

        <button
          onClick={playSound}
          className="w-full flex items-center justify-center gap-2 py-2 rounded-md text-xs font-medium transition-colors nodrag cursor-pointer"
          style={{ background: "rgba(249, 115, 22, 0.15)", color: "#f97316", border: "1px solid rgba(249, 115, 22, 0.25)" }}
        >
          <Play size={12} />
          Test Sound
        </button>
      </div>

      <div className="mt-3 text-right">
        <span className="text-xs font-mono text-orange-500/70">{triggerCount} triggers</span>
      </div>
    </NodeShell>
  );
}
