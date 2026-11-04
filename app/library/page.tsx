"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import Sidebar from "@/components/Sidebar";
import { useWorkflowStore } from "@/lib/workflowStore";
import {
  BookOpen, Search, Play, Download, Clock,
  Eye, Mic, Bell, ShieldCheck, Home, Layers,
} from "lucide-react";

interface Template {
  id: string;
  name: string;
  description: string;
  category: string;
  nodeCount: number;
  icon: React.ReactNode;
  color: string;
  nodes: any[];
  edges: any[];
}

const TEMPLATES: Template[] = [
  {
    id: "object-tracking",
    name: "Object Tracking Pipeline",
    description: "Detect objects with YOLOv8, filter by confidence, and log all events in real-time.",
    category: "Visual AI", nodeCount: 4, icon: <Eye size={20} />, color: "#f97316",
    nodes: [
      { id: "n1", type: "camera",    position: { x: 50,   y: 200 }, data: { fps: 3 } },
      { id: "n2", type: "detection", position: { x: 440,  y: 200 }, data: { confidence: 55, interval: 2 } },
      { id: "n3", type: "logic",     position: { x: 840,  y: 200 }, data: { conditions: [{ id: "1", operator: "contains", value: "person" }], mode: "any" } },
      { id: "n4", type: "logAction", position: { x: 1240, y: 200 }, data: {} },
    ],
    edges: [
      { id: "e1", source: "n1", sourceHandle: "camera", target: "n2", targetHandle: "camera",  animated: true, style: { stroke: "#4285F4" } },
      { id: "e2", source: "n2", sourceHandle: "match",  target: "n3", targetHandle: "input",   animated: true, style: { stroke: "#34A853" } },
      { id: "e3", source: "n3", sourceHandle: "match",  target: "n4", targetHandle: "trigger", animated: true, style: { stroke: "#4285F4" } },
    ],
  },
  {
    id: "anomaly-detection",
    name: "Anomaly Detection",
    description: "VLM-powered scene analysis — sends notification when anomalies are detected by the AI.",
    category: "Safety", nodeCount: 5, icon: <Bell size={20} />, color: "#a855f7",
    nodes: [
      { id: "n1", type: "camera",       position: { x: 50,   y: 200 }, data: { fps: 2 } },
      { id: "n2", type: "detection",    position: { x: 440,  y: 100 }, data: { confidence: 60, interval: 3 } },
      { id: "n3", type: "visualLlm",    position: { x: 440,  y: 320 }, data: { prompt: "Describe any anomalies, dangers, or unusual activity.", interval: 10 } },
      { id: "n4", type: "logic",        position: { x: 880,  y: 200 }, data: { conditions: [{ id: "1", operator: "contains", value: "anomaly" }, { id: "2", operator: "contains", value: "danger" }], mode: "any" } },
      { id: "n5", type: "notifyAction", position: { x: 1280, y: 200 }, data: {} },
    ],
    edges: [
      { id: "e1", source: "n1", sourceHandle: "camera",   target: "n2", targetHandle: "camera",  animated: true, style: { stroke: "#4285F4" } },
      { id: "e2", source: "n1", sourceHandle: "camera",   target: "n3", targetHandle: "camera",  animated: true, style: { stroke: "#4285F4" } },
      { id: "e3", source: "n2", sourceHandle: "match",    target: "n3", targetHandle: "trigger", animated: true, style: { stroke: "#34A853" } },
      { id: "e4", source: "n3", sourceHandle: "response", target: "n4", targetHandle: "input",   animated: true, style: { stroke: "#a855f7" } },
      { id: "e5", source: "n4", sourceHandle: "match",    target: "n5", targetHandle: "trigger", animated: true, style: { stroke: "#4285F4" } },
    ],
  },
  {
    id: "audio-event-logger",
    name: "Audio Event Logger",
    description: "YamNet classifies microphone audio in real-time. Matching sounds are logged with timestamps.",
    category: "Audio AI", nodeCount: 3, icon: <Mic size={20} />, color: "#FBBC05",
    nodes: [
      { id: "n1", type: "mic",         position: { x: 50,  y: 200 }, data: {} },
      { id: "n2", type: "audioDetect", position: { x: 440, y: 200 }, data: { confidence: 30, interval: 2 } },
      { id: "n3", type: "logAction",   position: { x: 840, y: 200 }, data: {} },
    ],
    edges: [
      { id: "e1", source: "n1", sourceHandle: "audio", target: "n2", targetHandle: "audio",   animated: true, style: { stroke: "#FBBC05" } },
      { id: "e2", source: "n2", sourceHandle: "match", target: "n3", targetHandle: "trigger", animated: true, style: { stroke: "#34A853" } },
    ],
  },
  {
    id: "face-auth",
    name: "Face Authentication Gate",
    description: "Enroll a reference face — only alert when an unrecognized face is detected by the camera.",
    category: "Security", nodeCount: 4, icon: <ShieldCheck size={20} />, color: "#06B6D4",
    nodes: [
      { id: "n1", type: "camera",      position: { x: 50,   y: 200 }, data: { fps: 2 } },
      { id: "n2", type: "faceMatch",   position: { x: 440,  y: 200 }, data: {} },
      { id: "n3", type: "logic",       position: { x: 840,  y: 200 }, data: { conditions: [{ id: "1", operator: "contains", value: "no match" }], mode: "any" } },
      { id: "n4", type: "emailAction", position: { x: 1240, y: 200 }, data: { subject: "Unknown face detected", body: "Lumina detected an unrecognized face at the camera." } },
    ],
    edges: [
      { id: "e1", source: "n1", sourceHandle: "camera", target: "n2", targetHandle: "camera",  animated: true, style: { stroke: "#4285F4" } },
      { id: "e2", source: "n2", sourceHandle: "output", target: "n3", targetHandle: "input",   animated: true, style: { stroke: "#06B6D4" } },
      { id: "e3", source: "n3", sourceHandle: "match",  target: "n4", targetHandle: "trigger", animated: true, style: { stroke: "#4285F4" } },
    ],
  },
  {
    id: "smart-doorbell",
    name: "Smart Doorbell Logic",
    description: "IP camera monitors entrance. Person detected triggers SMS and Discord notifications.",
    category: "Automation", nodeCount: 5, icon: <Home size={20} />, color: "#34A853",
    nodes: [
      { id: "n1", type: "ipCamera",      position: { x: 50,   y: 200 }, data: { url: "rtsp://192.168.1.1/stream" } },
      { id: "n2", type: "detection",     position: { x: 480,  y: 200 }, data: { confidence: 65, interval: 3 } },
      { id: "n3", type: "logic",         position: { x: 900,  y: 200 }, data: { conditions: [{ id: "1", operator: "contains", value: "person" }], mode: "any" } },
      { id: "n4", type: "smsAction",     position: { x: 1320, y: 100 }, data: { body: "Someone is at the door!" } },
      { id: "n5", type: "discordAction", position: { x: 1320, y: 300 }, data: { message: "Person detected at entrance." } },
    ],
    edges: [
      { id: "e1", source: "n1", sourceHandle: "frames", target: "n2", targetHandle: "camera",  animated: true, style: { stroke: "#4285F4" } },
      { id: "e2", source: "n2", sourceHandle: "match",  target: "n3", targetHandle: "input",   animated: true, style: { stroke: "#34A853" } },
      { id: "e3", source: "n3", sourceHandle: "match",  target: "n4", targetHandle: "trigger", animated: true, style: { stroke: "#4285F4" } },
      { id: "e4", source: "n3", sourceHandle: "match",  target: "n5", targetHandle: "trigger", animated: true, style: { stroke: "#4285F4" } },
    ],
  },
  {
    id: "voice-transcribe",
    name: "Voice Transcription Log",
    description: "Whisper STT converts microphone input to text, then LLM summarizes and logs the result.",
    category: "Audio AI", nodeCount: 4, icon: <Layers size={20} />, color: "#10b981",
    nodes: [
      { id: "n1", type: "mic",        position: { x: 50,   y: 200 }, data: {} },
      { id: "n2", type: "whisperStt", position: { x: 440,  y: 200 }, data: {} },
      { id: "n3", type: "llm",        position: { x: 840,  y: 200 }, data: { prompt: "Summarize this transcript in one sentence.", system_prompt: "You are a meeting assistant." } },
      { id: "n4", type: "logAction",  position: { x: 1240, y: 200 }, data: {} },
    ],
    edges: [
      { id: "e1", source: "n1", sourceHandle: "audio",  target: "n2", targetHandle: "audio",   animated: true, style: { stroke: "#FBBC05" } },
      { id: "e2", source: "n2", sourceHandle: "output", target: "n3", targetHandle: "input",   animated: true, style: { stroke: "#10b981" } },
      { id: "e3", source: "n3", sourceHandle: "output", target: "n4", targetHandle: "trigger", animated: true, style: { stroke: "#3b82f6" } },
    ],
  },
];

const CAT_COLOR: Record<string, string> = {
  "Visual AI": "#4285F4", "Safety": "#a855f7", "Audio AI": "#FBBC05",
  "Security": "#06B6D4", "Automation": "#34A853",
};

export default function LibraryPage() {
  const [search, setSearch] = useState("");
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const router = useRouter();
  const createWorkflow = useWorkflowStore(s => s.createWorkflow);
  const setActiveWorkflowId = useWorkflowStore(s => s.setActiveWorkflowId);

  const filtered = TEMPLATES.filter(t =>
    !search.trim() ||
    t.name.toLowerCase().includes(search.toLowerCase()) ||
    t.category.toLowerCase().includes(search.toLowerCase())
  );

  const deploy = (tpl: Template) => {
    setLoadingId(tpl.id);
    const id = createWorkflow(tpl.name, tpl.nodes, tpl.edges);
    setActiveWorkflowId(id);
    setTimeout(() => router.push("/"), 200);
  };

  const exportJSON = (tpl: Template) => {
    const blob = new Blob([JSON.stringify({ name: tpl.name, nodes: tpl.nodes, edges: tpl.edges }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    Object.assign(document.createElement("a"), { href: url, download: `lumina-${tpl.id}.json` }).click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex h-screen w-screen bg-[#030305] overflow-hidden text-slate-200">
      <Sidebar backendConnected={true} />
      <main className="flex-1 ml-[240px] flex flex-col overflow-hidden">
        <header className="px-8 py-6 border-b border-white/5 flex items-center justify-between bg-black/20 backdrop-blur-xl shrink-0">
          <div className="flex items-center gap-4">
            <div className="p-2 rounded-lg bg-cyan-500/10 border border-cyan-500/20"><BookOpen size={20} className="text-cyan-400" /></div>
            <div>
              <h1 className="text-lg font-bold tracking-tight">Pipeline Library</h1>
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-0.5">{TEMPLATES.length} ready-to-use templates</p>
            </div>
          </div>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input type="text" placeholder="Search templates…" value={search} onChange={e => setSearch(e.target.value)}
              className="pl-9 pr-4 py-2 bg-white/5 border border-white/10 rounded-lg text-xs outline-none focus:border-cyan-500/30 transition-all w-64 text-slate-300 placeholder-slate-600" />
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-8">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filtered.map(tpl => (
              <div key={tpl.id} className="rounded-2xl p-6 border border-white/5 bg-white/[0.02] hover:border-white/10 transition-all group flex flex-col">
                <div className="flex items-start justify-between mb-5">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center"
                    style={{ background: `${tpl.color}18`, color: tpl.color, border: `1px solid ${tpl.color}30` }}>
                    {tpl.icon}
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => exportJSON(tpl)} title="Export JSON"
                      className="p-2 rounded-lg hover:bg-white/5 text-slate-600 hover:text-slate-300 transition-all cursor-pointer">
                      <Download size={14} />
                    </button>
                    <button onClick={() => deploy(tpl)} disabled={!!loadingId} title="Load to canvas"
                      className="p-2 rounded-lg hover:bg-white/5 text-slate-600 hover:text-white transition-all cursor-pointer disabled:opacity-40">
                      <Play size={14} />
                    </button>
                  </div>
                </div>
                <h3 className="font-bold text-sm mb-1.5 text-white group-hover:text-cyan-400 transition-colors">{tpl.name}</h3>
                <p className="text-[11px] text-slate-500 leading-relaxed flex-1">{tpl.description}</p>
                <div className="mt-5 pt-5 border-t border-white/5 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
                      style={{ color: CAT_COLOR[tpl.category] || "#94a3b8", background: `${CAT_COLOR[tpl.category] || "#94a3b8"}15` }}>
                      {tpl.category}
                    </span>
                    <span className="text-[10px] text-slate-600 flex items-center gap-1"><Clock size={10} />{tpl.nodeCount} nodes</span>
                  </div>
                  <button onClick={() => deploy(tpl)} disabled={!!loadingId}
                    className="text-[10px] font-black uppercase tracking-widest text-cyan-500 hover:text-cyan-400 cursor-pointer disabled:opacity-40 transition-all">
                    {loadingId === tpl.id ? "Loading…" : "Deploy →"}
                  </button>
                </div>
              </div>
            ))}
          </div>
          {filtered.length === 0 && (
            <div className="mt-20 flex flex-col items-center justify-center py-20 border border-dashed border-white/5 rounded-[2rem]">
              <BookOpen size={32} className="text-slate-700 mb-4" />
              <p className="text-sm font-bold text-slate-500">No templates match "{search}"</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
