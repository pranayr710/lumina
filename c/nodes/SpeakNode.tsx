"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Handle, Position, type NodeProps } from "reactflow";
import { Volume2, Play } from "lucide-react";
import NodeShell from "./NodeShell";
import { useUpstreamTrigger } from "@/l/useUpstreamTrigger";
import { useNodeData } from "@/l/useNodeData";

export default function SpeakNode({ id, selected, data }: NodeProps) {
  const [voice, setVoice] = useState(data.voice || "");
  const [pitch, setPitch] = useState(data.pitch || 1.0);
  const [rate, setRate] = useState(data.rate || 1.0);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  const updateData = useNodeData(id);
  useEffect(() => {
    updateData({ voice, pitch, rate });
  }, [voice, pitch, rate, updateData]);

  useEffect(() => {
    const loadVoices = () => {
      const v = window.speechSynthesis.getVoices();
      setVoices(v);
      if (v.length > 0 && !voice) setVoice(v[0].name);
    };
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
  }, [voice]);

  const { sourceOutput, sourceVersion } = useUpstreamTrigger(id, "trigger");

  const speak = useCallback((text: string) => {
    if (!text) return;
    const utterance = new SpeechSynthesisUtterance(text);
    const selectedVoice = voices.find(v => v.name === voice);
    if (selectedVoice) utterance.voice = selectedVoice;
    utterance.pitch = pitch;
    utterance.rate = rate;
    window.speechSynthesis.speak(utterance);
  }, [voice, pitch, rate, voices]);

  useEffect(() => {
    if (sourceVersion > 0 && sourceOutput) {
      speak(sourceOutput);
    }
  }, [sourceVersion, sourceOutput, speak]);

  return (
    <NodeShell
      accent="#A855F7"
      title="Speak / TTS"
      icon={<Volume2 size={16} />}
      status={sourceVersion > 0 ? "running" : "idle"}
      selected={selected}
      width={320}
    >
      <Handle type="target" position={Position.Left} id="trigger" className="w-3 h-3 bg-purple-500 border-2 border-[#13131a]" />

      <div className="space-y-4 font-sans">
        <div>
          <label className="text-[10px] text-slate-500 uppercase font-bold tracking-wider mb-1.5 block">Voice</label>
          <select
            value={voice}
            onChange={(e) => setVoice(e.target.value)}
            className="w-full bg-[#0a0a0f] border border-[#1e1e2e] rounded-lg px-3 py-1.5 text-xs text-slate-300 outline-none focus:border-purple-500/50 nodrag"
          >
            {voices.map((v) => (
              <option key={v.name} value={v.name}>{v.name} ({v.lang})</option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="flex justify-between items-center mb-1.5">
              <label className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Pitch</label>
              <span className="text-[10px] font-mono text-purple-400">{pitch}</span>
            </div>
            <input
              type="range"
              min={0.5}
              max={2.0}
              step={0.1}
              value={pitch}
              onChange={(e) => setPitch(parseFloat(e.target.value))}
              className="w-full h-1.5 accent-purple-500 nodrag nowheel"
            />
          </div>
          <div>
            <div className="flex justify-between items-center mb-1.5">
              <label className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Rate</label>
              <span className="text-[10px] font-mono text-purple-400">{rate}</span>
            </div>
            <input
              type="range"
              min={0.5}
              max={2.0}
              step={0.1}
              value={rate}
              onChange={(e) => setRate(parseFloat(e.target.value))}
              className="w-full h-1.5 accent-purple-500 nodrag nowheel"
            />
          </div>
        </div>

        <button
          onClick={() => speak("Lumina local voice feedback check.")}
          className="w-full flex items-center justify-center gap-2 py-2 rounded-md bg-purple-500/10 text-purple-400 border border-purple-500/20 hover:bg-purple-500/20 transition-all text-xs font-bold cursor-pointer"
        >
          <Play size={14} /> Test Voice
        </button>
      </div>
    </NodeShell>
  );
}
