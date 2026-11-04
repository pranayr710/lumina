"use client";

import React, { useState } from "react";
import { Calendar, X, Play, Clock, RotateCcw } from "lucide-react";

export interface ScheduleConfig {
  type: "interval" | "daily" | "once";
  interval: number;   // minutes
  time: string;       // HH:MM for daily
  startAt: string;    // datetime-local for once
  duration: number;   // minutes, 0 = unlimited
}

interface Props {
  pipelineName: string;
  activeSchedule: ScheduleConfig | null;
  onSchedule: (cfg: ScheduleConfig) => void;
  onClear: () => void;
  onClose: () => void;
}

export default function ScheduleModal({ pipelineName, activeSchedule, onSchedule, onClear, onClose }: Props) {
  const [type, setType] = useState<ScheduleConfig["type"]>(activeSchedule?.type ?? "interval");
  const [interval, setIntervalVal] = useState(activeSchedule?.interval ?? 60);
  const [time, setTime] = useState(activeSchedule?.time ?? "09:00");
  const [startAt, setStartAt] = useState(activeSchedule?.startAt ?? "");
  const [duration, setDuration] = useState(activeSchedule?.duration ?? 0);

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-md z-[100] flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#09090d]/95 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-5 border-b border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-amber-500/10 text-amber-400"><Calendar size={16} /></div>
            <div>
              <h2 className="text-sm font-bold text-white">Schedule Pipeline</h2>
              <p className="text-[10px] text-slate-500 mt-0.5 truncate max-w-[220px]">{pipelineName}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/5 text-slate-500 hover:text-white transition-all cursor-pointer"><X size={16} /></button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Type tabs */}
          <div className="grid grid-cols-3 gap-2">
            {(["interval", "daily", "once"] as const).map(t => (
              <button key={t} onClick={() => setType(t)}
                className={`py-2.5 rounded-xl text-[11px] font-bold uppercase tracking-wider transition-all cursor-pointer ${
                  type === t ? "bg-amber-500/20 border border-amber-500/40 text-amber-400" : "bg-white/5 border border-white/5 text-slate-500 hover:text-slate-300"
                }`}>
                {t === "interval" ? "Repeat" : t === "daily" ? "Daily" : "Once"}
              </button>
            ))}
          </div>

          {type === "interval" && (
            <div>
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-2">Run every</label>
              <div className="flex items-center gap-3">
                <input type="number" value={interval} onChange={e => setIntervalVal(+e.target.value)} min={1}
                  className="flex-1 px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-amber-500/40 transition-all" />
                <span className="text-slate-400 text-sm shrink-0">minutes</span>
              </div>
            </div>
          )}
          {type === "daily" && (
            <div>
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-2">Start time (daily)</label>
              <input type="time" value={time} onChange={e => setTime(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-amber-500/40 transition-all" />
            </div>
          )}
          {type === "once" && (
            <div>
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-2">Start at</label>
              <input type="datetime-local" value={startAt} onChange={e => setStartAt(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-amber-500/40 transition-all" />
            </div>
          )}

          <div>
            <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-2">
              Run duration <span className="text-slate-600 normal-case font-normal">(0 = until manually stopped)</span>
            </label>
            <div className="flex items-center gap-3">
              <input type="number" value={duration} onChange={e => setDuration(+e.target.value)} min={0}
                className="flex-1 px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-amber-500/40 transition-all" />
              <span className="text-slate-400 text-sm shrink-0">minutes</span>
            </div>
          </div>

          {activeSchedule && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-amber-500/5 border border-amber-500/20 text-[11px] text-amber-400">
              <Clock size={12} />
              Schedule active — click Clear to disable
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-white/5 flex items-center gap-3">
          {activeSchedule && (
            <button onClick={() => { onClear(); onClose(); }}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold text-rose-400 hover:bg-rose-500/10 transition-all cursor-pointer">
              <RotateCcw size={12} /> Clear Schedule
            </button>
          )}
          <div className="ml-auto flex items-center gap-3">
            <button onClick={onClose} className="px-4 py-2 rounded-lg text-xs font-semibold text-slate-400 hover:text-white hover:bg-white/5 transition-all cursor-pointer">Cancel</button>
            <button onClick={() => { onSchedule({ type, interval, time, startAt, duration }); onClose(); }}
              className="px-5 py-2 rounded-lg text-xs font-bold bg-amber-500/20 border border-amber-500/40 text-amber-400 hover:bg-amber-500/30 transition-all flex items-center gap-2 cursor-pointer">
              <Play size={12} /> Set Schedule
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
