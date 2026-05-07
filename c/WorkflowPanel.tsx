"use client";

import React, { useState, useRef, useEffect } from "react";
import {
  ChevronRight,
  Plus,
  Trash2,
  Clock,
  Pencil,
  Check,
  X,
  Camera,
  Film,
  Mic,
  Shield,
} from "lucide-react";
import type { Node } from "reactflow";
import type { SavedWorkflow } from "@/l/workflowStore";
import { useFrameStore } from "@/l/frameStore";
import { useAudioStore } from "@/l/audioStore";
import { INDUSTRIAL_TEMPLATES } from "@/l/templates";

// ─── Helpers ───

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const secs = Math.floor(diff / 1000);
  if (secs < 10) return "just now";
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function frameSrc(frame: string): string {
  if (frame.startsWith("data:")) return frame;
  return `data:image/jpeg;base64,${frame}`;
}

// ─── Live feed mini-components (isolated Zustand subscriptions per node) ───

function LiveFramePreview({ nodeId, nodeType }: { nodeId: string; nodeType: string }) {
  const frame = useFrameStore((s) => s.frames[nodeId]);
  const Icon = nodeType === "video" ? Film : Camera;
  const label = nodeType === "video" ? "Video" : "Camera";

  return (
    <div className="rounded overflow-hidden" style={{ background: "#0a0a0f" }}>
      {frame ? (
        <div className="relative">
          <img
            src={frameSrc(frame)}
            alt=""
            className="w-full object-cover"
            style={{ aspectRatio: "16/9" }}
          />
          <div
            className="absolute top-1 left-1 flex items-center gap-1 px-1.5 py-0.5 rounded text-[7px] font-semibold"
            style={{ background: "#000000bb", color: "#4285F4" }}
          >
            <div
              className="w-1 h-1 rounded-full"
              style={{
                background: "#4285F4",
                boxShadow: "0 0 4px #4285F4",
                animation: "pulse-glow 2s ease-in-out infinite",
              }}
            />
            {label}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-1.5 px-2 py-2">
          <Icon size={10} className="text-slate-600" />
          <span className="text-[9px] text-slate-600">{label} — Inactive</span>
        </div>
      )}
    </div>
  );
}

function LiveAudioPreview({ nodeId }: { nodeId: string }) {
  const hasAudio = useAudioStore((s) => !!s.audio[nodeId]);

  return (
    <div className="rounded overflow-hidden" style={{ background: "#0a0a0f" }}>
      {hasAudio ? (
        <div className="flex items-center gap-1.5 px-2 py-2">
          <div
            className="w-1.5 h-1.5 rounded-full flex-shrink-0"
            style={{
              background: "#4285F4",
              boxShadow: "0 0 4px #4285F4",
              animation: "pulse-glow 2s ease-in-out infinite",
            }}
          />
          <span className="text-[9px] font-medium" style={{ color: "#4285F4" }}>
            Mic — Listening
          </span>
          <div className="flex items-end gap-[2px] ml-auto h-2.5">
            {[0, 1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="w-[2px] rounded-full"
                style={{
                  background: "#4285F4",
                  animation: `audio-bar 0.8s ease-in-out ${i * 0.1}s infinite alternate`,
                  height: "40%",
                }}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-1.5 px-2 py-2">
          <Mic size={10} className="text-slate-600" />
          <span className="text-[9px] text-slate-600">Mic — Inactive</span>
        </div>
      )}
    </div>
  );
}

/** Static feed row — shows inactive */
function InactiveFeedRow({ nodeType }: { nodeType: string }) {
  const Icon = nodeType === "video" ? Film : nodeType === "mic" ? Mic : Camera;
  const label = nodeType === "video" ? "Video" : nodeType === "mic" ? "Mic" : "Camera";

  return (
    <div className="flex items-center gap-1.5 px-2 py-1.5 rounded" style={{ background: "#0a0a0f" }}>
      <Icon size={10} className="text-slate-600" />
      <span className="text-[9px] text-slate-600">{label} — Inactive</span>
    </div>
  );
}

/** Parked (background) frame preview — reads namespaced frame key */
function ParkedFramePreview({ workflowId, nodeId, nodeType }: { workflowId: string; nodeId: string; nodeType: string }) {
  const frame = useFrameStore((s) => s.frames[`${workflowId}::${nodeId}`]);
  const Icon = nodeType === "video" ? Film : Camera;
  const label = nodeType === "video" ? "Video" : "Camera";

  if (frame) {
    return (
      <div className="rounded overflow-hidden" style={{ background: "#0a0a0f" }}>
        <div className="relative">
          <img
            src={frameSrc(frame)}
            alt=""
            className="w-full object-cover"
            style={{ aspectRatio: "16/9" }}
          />
          <div
            className="absolute top-1 left-1 flex items-center gap-1 px-1.5 py-0.5 rounded text-[7px] font-semibold"
            style={{ background: "#000000bb", color: "#FBBC05" }}
          >
            <div
              className="w-1 h-1 rounded-full"
              style={{
                background: "#FBBC05",
                boxShadow: "0 0 4px #FBBC05",
                animation: "pulse-glow 2s ease-in-out infinite",
              }}
            />
            {label} — Background
          </div>
        </div>
      </div>
    );
  }

  return <InactiveFeedRow nodeType={nodeType} />;
}

/** Parked (background) audio preview — reads namespaced audio key */
function ParkedAudioPreview({ workflowId, nodeId }: { workflowId: string; nodeId: string }) {
  const hasAudio = useAudioStore((s) => !!s.audio[`${workflowId}::${nodeId}`]);

  if (hasAudio) {
    return (
      <div className="rounded overflow-hidden" style={{ background: "#0a0a0f" }}>
        <div className="flex items-center gap-1.5 px-2 py-2">
          <div
            className="w-1.5 h-1.5 rounded-full flex-shrink-0"
            style={{
              background: "#FBBC05",
              boxShadow: "0 0 4px #FBBC05",
              animation: "pulse-glow 2s ease-in-out infinite",
            }}
          />
          <span className="text-[9px] font-medium" style={{ color: "#FBBC05" }}>
            Mic — Background
          </span>
          <div className="flex items-end gap-[2px] ml-auto h-2.5">
            {[0, 1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="w-[2px] rounded-full"
                style={{
                  background: "#FBBC05",
                  animation: `audio-bar 0.8s ease-in-out ${i * 0.1}s infinite alternate`,
                  height: "40%",
                }}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return <InactiveFeedRow nodeType="mic" />;
}

// ─── Main Panel ───

interface WorkflowPanelProps {
  isOpen: boolean;
  onToggle: () => void;
  onSwitchWorkflow: (workflow: SavedWorkflow) => void;
  onNewWorkflow: () => void;
  onDeleteWorkflow: (id: string) => void;
  onRenameWorkflow: (id: string, name: string) => void;
  workflows: SavedWorkflow[];
  canvasNodes: Node[];
  onAddTemplate?: (type: any) => void;
  activeWorkflowId: string | null;
}

export default function WorkflowPanel({
  isOpen,
  onToggle,
  onSwitchWorkflow,
  onNewWorkflow,
  onDeleteWorkflow,
  onRenameWorkflow,
  activeWorkflowId,
  workflows,
  canvasNodes,
  onAddTemplate,
}: WorkflowPanelProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const deleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
    };
  }, []);

  if (!isOpen) return null;

  const handleStartRename = (wf: SavedWorkflow) => {
    setEditingId(wf.id);
    setEditName(wf.name);
  };

  const handleConfirmRename = () => {
    if (editingId && editName.trim()) {
      onRenameWorkflow(editingId, editName.trim());
    }
    setEditingId(null);
    setEditName("");
  };

  const handleCancelRename = () => {
    setEditingId(null);
    setEditName("");
  };

  const handleDeleteClick = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (deleteConfirmId === id) {
      onDeleteWorkflow(id);
      setDeleteConfirmId(null);
      if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
    } else {
      setDeleteConfirmId(id);
      if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
      deleteTimerRef.current = setTimeout(() => setDeleteConfirmId(null), 3000);
    }
  };

  // Input nodes currently on the canvas (active workflow)
  const liveInputNodes = canvasNodes.filter(
    (n) => n.type === "camera" || n.type === "video" || n.type === "mic"
  );

  return (
    <div
      className="flex flex-col h-full border-l font-sans"
      style={{
        width: 300,
        minWidth: 300,
        background: "#0d0d14",
        borderColor: "#1e1e2e",
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3.5 border-b"
        style={{ borderColor: "#1e1e2e" }}
      >
        <h2 className="text-sm font-semibold text-slate-200 tracking-wide">
          Pipelines
        </h2>
        <button
          onClick={onToggle}
          className="p-1 rounded hover:bg-[#1e1e2e] transition-colors"
        >
          <ChevronRight size={16} className="text-slate-400" />
        </button>
      </div>

      {/* New Workflow Button */}
      <div className="px-3 py-3 border-b" style={{ borderColor: "#1e1e2e" }}>
        <button
          onClick={onNewWorkflow}
          className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-medium transition-colors"
          style={{
            background: "rgba(66, 133, 244, 0.1)",
            color: "#4285F4",
            border: "1px solid rgba(66, 133, 244, 0.2)",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.background = "rgba(66, 133, 244, 0.18)";
            (e.currentTarget as HTMLElement).style.borderColor = "rgba(66, 133, 244, 0.35)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = "rgba(66, 133, 244, 0.1)";
            (e.currentTarget as HTMLElement).style.borderColor = "rgba(66, 133, 244, 0.2)";
          }}
        >
          <Plus size={14} />
          New Pipeline
        </button>
      </div>

      {/* Templates Section */}
      <div className="px-3 py-1 border-b" style={{ borderColor: "#1e1e2e" }}>
        <p className="text-[9px] text-slate-500 uppercase font-bold tracking-widest px-1 py-2">Quickstarts</p>
        <button
          onClick={() => onAddTemplate?.("doorbell")}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-slate-400 hover:text-[#4285F4] hover:bg-[#4285F4]/5 transition-all group"
        >
          <Shield size={14} className="text-slate-600 group-hover:text-[#4285F4]" />
          Smart Doorbell
        </button>
      </div>

      {/* Workflow List */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
        {workflows.map((wf) => {
          const isActive = wf.id === activeWorkflowId;
          const isEditing = editingId === wf.id;
          const isDeletePending = deleteConfirmId === wf.id;

          // For the active workflow, use live canvas nodes; for others, use saved nodes
          const wfInputNodes = isActive
            ? liveInputNodes
            : wf.nodes.filter(
                (n) => n.type === "camera" || n.type === "video" || n.type === "mic"
              );

          return (
            <div
              key={wf.id}
              onClick={() => {
                if (!isEditing && !isActive) onSwitchWorkflow(wf);
              }}
              className={`rounded-lg overflow-hidden transition-all group ${!isActive && !isEditing ? "cursor-pointer" : ""}`}
              style={{
                background: isActive ? "rgba(66, 133, 244, 0.04)" : "#13131a",
                border: `1px solid ${isActive ? "rgba(66, 133, 244, 0.25)" : "#1e1e2e"}`,
              }}
              onMouseEnter={(e) => {
                if (!isActive) {
                  (e.currentTarget as HTMLElement).style.borderColor = "#2a2a3a";
                  (e.currentTarget as HTMLElement).style.background = "#16161f";
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive) {
                  (e.currentTarget as HTMLElement).style.borderColor = "#1e1e2e";
                  (e.currentTarget as HTMLElement).style.background = "#13131a";
                }
              }}
            >
              {/* Card header */}
              <div className="p-3 pb-2">
                {/* Name row */}
                <div className="flex items-center gap-2 mb-1">
                  {isActive && (
                    <div
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{
                        background: "#4285F4",
                        boxShadow: "0 0 6px #4285F4",
                      }}
                    />
                  )}

                  {isEditing ? (
                    <div className="flex items-center gap-1 flex-1 min-w-0">
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          if (e.key === "Enter") handleConfirmRename();
                          if (e.key === "Escape") handleCancelRename();
                        }}
                        onClick={(e) => e.stopPropagation()}
                        autoFocus
                        className="flex-1 min-w-0 px-1.5 py-0.5 rounded text-xs bg-[#0a0a0f] border border-[#4285F4]/30 text-slate-200 focus:outline-none"
                      />
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleConfirmRename();
                        }}
                        className="p-0.5 text-emerald-400 hover:text-emerald-300"
                      >
                        <Check size={12} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCancelRename();
                        }}
                        className="p-0.5 text-slate-500 hover:text-slate-300"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  ) : (
                    <span className="text-xs font-medium text-slate-200 truncate flex-1">
                      {wf.name}
                    </span>
                  )}

                  {!isEditing && (
                    <div className={`flex items-center gap-0.5 ${isActive ? "opacity-70" : "opacity-0"} group-hover:opacity-100 transition-opacity`}>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleStartRename(wf);
                        }}
                        className="p-1 rounded hover:bg-[#1e1e2e] text-slate-500 hover:text-slate-300"
                        title="Rename"
                      >
                        <Pencil size={11} />
                      </button>
                      {workflows.length > 1 && (
                        <button
                          onClick={(e) => handleDeleteClick(e, wf.id)}
                          className="p-1 rounded hover:bg-[#1e1e2e]"
                          title={isDeletePending ? "Click again to confirm" : "Delete"}
                          style={{
                            color: isDeletePending ? "#ef4444" : undefined,
                          }}
                        >
                          <Trash2
                            size={11}
                            className={isDeletePending ? "" : "text-slate-500 hover:text-red-400"}
                          />
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Meta row */}
                <div className="flex items-center gap-2.5 text-[10px] text-slate-500 pl-0.5">
                  <span>
                    {wf.nodes.length} nodes &middot; {wf.edges.length} edges
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock size={9} />
                    {timeAgo(wf.updatedAt)}
                  </span>
                </div>

                {isDeletePending && (
                  <div className="mt-1.5 text-[10px] text-red-400/80 pl-0.5">
                    Click delete again to confirm
                  </div>
                )}
              </div>

              {/* Input feeds — embedded inside the card */}
              {wfInputNodes.length > 0 && (
                <div className="px-2.5 pb-2.5 space-y-1">
                  {wfInputNodes.map((node) => {
                    if (isActive) {
                      // Active workflow: live feed previews (plain keys)
                      if (node.type === "camera" || node.type === "video") {
                        return (
                          <LiveFramePreview
                            key={node.id}
                            nodeId={node.id}
                            nodeType={node.type}
                          />
                        );
                      }
                      if (node.type === "mic") {
                        return <LiveAudioPreview key={node.id} nodeId={node.id} />;
                      }
                    } else {
                      // Non-active workflow: check for parked (background) captures
                      if (node.type === "camera" || node.type === "video") {
                        return (
                          <ParkedFramePreview
                            key={node.id}
                            workflowId={wf.id}
                            nodeId={node.id}
                            nodeType={node.type!}
                          />
                        );
                      }
                      if (node.type === "mic") {
                        return (
                          <ParkedAudioPreview
                            key={node.id}
                            workflowId={wf.id}
                            nodeId={node.id}
                          />
                        );
                      }
                    }
                    return null;
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Templates Section */}
      <div className="mt-4 px-4 space-y-4 pb-8 border-t border-white/5 pt-4 overflow-y-auto max-h-[300px] scrollbar-none">
        <div className="flex items-center gap-2">
          <Shield size={14} className="text-[#4285F4]" />
          <h3 className="text-[10px] font-black text-white uppercase tracking-[0.2em]">Neural Templates</h3>
        </div>
        
        <div className="grid grid-cols-1 gap-2">
          {INDUSTRIAL_TEMPLATES.map((t) => (
            <button
              key={t.id}
              onClick={() => onAddTemplate?.(t)}
              className="glass p-3 rounded-xl border border-white/5 hover:border-[#4285F4]/30 hover:bg-[#4285F4]/5 transition-all text-left group"
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-slate-200 group-hover:text-[#4285F4] transition-colors">{t.name}</span>
                <Plus size={12} className="text-slate-600 group-hover:text-[#4285F4] group-hover:rotate-90 transition-all" />
              </div>
              <p className="text-[9px] text-slate-500 mt-0.5 line-clamp-1">{t.description}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div
        className="px-4 py-2.5 border-t text-[10px] text-slate-600"
        style={{ borderColor: "#1e1e2e" }}
      >
        Changes autosave to active workspace
      </div>
    </div>
  );
}
