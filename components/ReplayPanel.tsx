"use client";

import React, { useState, useEffect, useRef } from "react";
import { X, Play, Pause, ChevronLeft, ChevronRight, RefreshCw, Clock } from "lucide-react";

interface LuminaEvent {
  id: number;
  timestamp: string;
  node_type: string;
  node_id: string;
  data: string;
  image_path?: string;
}

interface Props { onClose: () => void }

export default function ReplayPanel({ onClose }: Props) {
  const [events, setEvents] = useState<LuminaEvent[]>([]);
  const [current, setCurrent] = useState(0);
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const fetchEvents = async () => {
    setLoading(true);
    try {
      const r = await fetch("http://localhost:8000/api/history");
      const data = await r.json();
      const evts: LuminaEvent[] = data.events || [];
      setEvents(evts);
      setCurrent(evts.length > 0 ? evts.length - 1 : 0);
    } catch { setEvents([]); }
    setLoading(false);
  };

  useEffect(() => { fetchEvents(); }, []);

  useEffect(() => {
    if (!playing || events.length === 0) return;
    const t = setInterval(() => {
      setCurrent(c => {
        if (c >= events.length - 1) { setPlaying(false); return c; }
        return c + 1;
      });
    }, 600);
    return () => clearInterval(t);
  }, [playing, events.length]);

  // Scroll event list to current item
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector(`[data-idx="${current}"]`) as HTMLElement;
    if (el) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [current]);

  const ev = events[current];

  const fmt = (ts: string) => {
    try { return new Date(ts).toLocaleTimeString(); } catch { return ts; }
  };

  const fmtData = (raw: string) => {
    try { return JSON.stringify(JSON.parse(raw), null, 2); } catch { return raw; }
  };

  const TYPE_COLORS: Record<string, string> = {
    detection: "#f97316", visualLlm: "#a855f7", audioDetect: "#8b5cf6",
    whisperStt: "#10b981", logic: "#f59e0b", llm: "#3b82f6",
    emailAction: "#3b82f6", logAction: "#34A853",
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-[100] flex items-center justify-center p-6">
      <div className="w-full max-w-2xl rounded-2xl border border-white/10 bg-[#09090d]/95 shadow-2xl flex flex-col max-h-[85vh] overflow-hidden">

        {/* Header */}
        <div className="px-6 py-5 border-b border-white/5 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-[#4285F4]/10 text-[#4285F4]"><Clock size={16} /></div>
            <div>
              <h2 className="text-sm font-bold text-white">Replay Mode</h2>
              <p className="text-[10px] text-slate-500 mt-0.5">
                {loading ? "Loading…" : `${events.length} events recorded`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={fetchEvents} title="Refresh" className="p-2 rounded-lg hover:bg-white/5 text-slate-500 hover:text-white transition-all cursor-pointer"><RefreshCw size={14} /></button>
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-white/5 text-slate-500 hover:text-white transition-all cursor-pointer"><X size={16} /></button>
          </div>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">Loading events…</div>
        ) : events.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-600 gap-3 py-20">
            <Clock size={32} className="opacity-30" />
            <p className="text-sm font-semibold">No events recorded yet</p>
            <p className="text-[11px]">Run the pipeline to start collecting events</p>
          </div>
        ) : (
          <>
            {/* Scrubber */}
            <div className="px-6 py-4 border-b border-white/5 shrink-0">
              <input type="range" min={0} max={events.length - 1} value={current}
                onChange={e => setCurrent(+e.target.value)}
                className="w-full accent-[#4285F4] cursor-pointer" />
              <div className="flex items-center justify-between text-[10px] text-slate-600 mt-1.5">
                <span>{events[0]?.timestamp ? fmt(events[0].timestamp) : ""}</span>
                <span className="text-slate-400 font-bold tabular-nums">{current + 1} / {events.length}</span>
                <span>{events[events.length - 1]?.timestamp ? fmt(events[events.length - 1].timestamp) : ""}</span>
              </div>
            </div>

            {/* Playback controls */}
            <div className="flex items-center justify-center gap-3 px-6 py-3 border-b border-white/5 shrink-0">
              <button onClick={() => setCurrent(0)} className="p-2 rounded-lg hover:bg-white/5 text-slate-500 hover:text-white transition-all cursor-pointer" title="First">
                <ChevronLeft size={14} className="inline" /><ChevronLeft size={14} className="inline -ml-2" />
              </button>
              <button onClick={() => setCurrent(c => Math.max(0, c - 1))} className="p-2 rounded-lg hover:bg-white/5 text-slate-400 hover:text-white transition-all cursor-pointer"><ChevronLeft size={16} /></button>
              <button onClick={() => setPlaying(p => !p)}
                className={`px-5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
                  playing ? "bg-rose-500/20 border border-rose-500/30 text-rose-400" : "bg-[#4285F4]/20 border border-[#4285F4]/30 text-[#4285F4]"
                }`}>
                {playing ? <><Pause size={12} /> Pause</> : <><Play size={12} /> Play</>}
              </button>
              <button onClick={() => setCurrent(c => Math.min(events.length - 1, c + 1))} className="p-2 rounded-lg hover:bg-white/5 text-slate-400 hover:text-white transition-all cursor-pointer"><ChevronRight size={16} /></button>
              <button onClick={() => setCurrent(events.length - 1)} className="p-2 rounded-lg hover:bg-white/5 text-slate-500 hover:text-white transition-all cursor-pointer" title="Last">
                <ChevronRight size={14} className="inline" /><ChevronRight size={14} className="inline -ml-2" />
              </button>
            </div>

            {/* Event detail */}
            {ev && (
              <div className="px-6 py-4 border-b border-white/5 shrink-0 space-y-3">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border"
                    style={{ color: TYPE_COLORS[ev.node_type] || "#94a3b8", borderColor: `${TYPE_COLORS[ev.node_type] || "#94a3b8"}40`, background: `${TYPE_COLORS[ev.node_type] || "#94a3b8"}12` }}>
                    {ev.node_type}
                  </span>
                  <span className="text-[10px] text-slate-500">{ev.timestamp ? new Date(ev.timestamp).toLocaleString() : ""}</span>
                  <span className="text-[10px] text-slate-600 font-mono">{ev.node_id}</span>
                </div>
                {ev.image_path && (
                  <img src={`http://localhost:8000/screenshots/${ev.image_path.split(/[\\/]/).pop()}`}
                    alt="frame" className="w-full max-h-40 object-contain rounded-xl border border-white/5 bg-black"
                    onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                )}
                <pre className="text-[11px] text-slate-300 font-mono bg-white/[0.02] border border-white/5 rounded-xl p-3 overflow-auto max-h-28 whitespace-pre-wrap">
                  {fmtData(ev.data)}
                </pre>
              </div>
            )}

            {/* Event list */}
            <div ref={listRef} className="flex-1 overflow-y-auto scrollbar-none">
              {events.map((e, i) => (
                <button key={e.id} data-idx={i} onClick={() => setCurrent(i)}
                  className={`w-full flex items-center gap-3 px-6 py-2.5 text-left transition-all border-l-2 ${
                    i === current ? "bg-[#4285F4]/8 border-[#4285F4]" : "hover:bg-white/[0.02] border-transparent"
                  }`}>
                  <span className="text-[9px] text-slate-600 w-14 shrink-0 tabular-nums">{fmt(e.timestamp)}</span>
                  <span className="text-[10px] font-bold uppercase tracking-wider w-24 shrink-0"
                    style={{ color: TYPE_COLORS[e.node_type] || "#64748b" }}>{e.node_type}</span>
                  <span className="text-[10px] text-slate-600 truncate font-mono">{e.node_id}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
