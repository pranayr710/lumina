"use client";

import React from "react";
import {
  Camera,
  Eye,
  GitBranch,
  MessageSquare,
  ScanSearch,
  Cpu,
  Mic,
  AudioLines,
  Ear,
  Film,
  Volume2,
  FileText,
  Bell,
  Aperture,
  Webhook,
  Mail,
  MessageCircle,
  Music,
  LayoutDashboard,
  History,
  Code2,
  ListRestart,
  Globe,
  Timer,
  GitMerge,
  FileOutput,
  Type,
  Accessibility,
  Radio,
  UserCheck,
  Shield,
  X,
  HelpCircle,
  BookOpen,
  Settings2,
  Zap,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NODE_CATALOG, type NodeTypeInfo } from "@/l/types";

const iconMap: Record<string, React.ReactNode> = {
  Camera: <Camera size={16} />,
  ScanSearch: <ScanSearch size={16} />,
  Eye: <Eye size={16} />,
  GitBranch: <GitBranch size={16} />,
  MessageSquare: <MessageSquare size={16} />,
  Mic: <Mic size={16} />,
  AudioLines: <AudioLines size={16} />,
  Ear: <Ear size={16} />,
  Film: <Film size={16} />,
  Volume2: <Volume2 size={16} />,
  FileText: <FileText size={16} />,
  Bell: <Bell size={16} />,
  Aperture: <Aperture size={16} />,
  Webhook: <Webhook size={16} />,
  Mail: <Mail size={16} />,
  MessageCircle: <MessageCircle size={16} />,
  Music: <Music size={16} />,
  Code2: <Code2 size={16} />,
  ListRestart: <ListRestart size={16} />,
  Globe: <Globe size={16} />,
  Timer: <Timer size={16} />,
  GitMerge: <GitMerge size={16} />,
  FileOutput: <FileOutput size={16} />,
  Type: <Type size={16} />,
  Accessibility: <Accessibility size={16} />,
  Radio: <Radio size={16} />,
  UserCheck: <UserCheck size={16} />,
  Zap: <Zap size={16} />,
  Wrench: <Wrench size={16} />,
};

const categoryLabels: Record<string, string> = {
  input: "Inputs",
  ai: "AI Models",
  logic: "Logic",
  output: "Actions",
};

interface SidebarProps {
  backendConnected: boolean;
  onAddNode?: (type: string) => void;
}

export default function Sidebar({ backendConnected, onAddNode }: SidebarProps) {
  const pathname = usePathname();
  
  const grouped = NODE_CATALOG.reduce(
    (acc, node) => {
      if (!acc[node.category]) acc[node.category] = [];
      acc[node.category].push(node);
      return acc;
    },
    {} as Record<string, NodeTypeInfo[]>
  );

  const onDragStart = (event: React.DragEvent, nodeType: string) => {
    event.dataTransfer.setData("application/reactflow", nodeType);
    event.dataTransfer.effectAllowed = "move";
  };

  return (
    <aside className="fixed left-0 top-0 bottom-0 w-[240px] z-50 flex flex-col bg-[#030305] border-r border-white/5 font-sans">
      {/* Brand Section */}
      <div className="px-6 py-6">
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-[#4285F4] shadow-[0_0_8px_rgba(66,133,244,0.5)]" />
          <h1 className="text-sm font-black tracking-[0.2em] text-white">LUMINA</h1>
        </div>
        <p className="text-[10px] text-slate-600 mt-1 font-medium tracking-wider">v1.0.0-Beta</p>
      </div>

      {/* Main Navigation */}
      <nav className="px-3 space-y-1 mb-8">
        {[
          { icon: <LayoutDashboard size={16} />, label: "Dashboard", href: "/dashboard" },
          { icon: <GitBranch size={16} />, label: "Orchestrator", href: "/" },
          { icon: <History size={16} />, label: "Logs", href: "/logs" },
          { icon: <BookOpen size={16} />, label: "Library", href: "/library" },
        ].map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center gap-3 px-3 py-2 rounded-lg text-[12px] font-semibold transition-all ${
              pathname === item.href 
                ? "bg-[#4285F4]/10 text-[#4285F4] border border-[#4285F4]/20" 
                : "text-slate-500 hover:text-slate-300 hover:bg-white/5"
            }`}
          >
            <span className={pathname === item.href ? "text-[#4285F4]" : "text-slate-600"}>
              {item.icon}
            </span>
            {item.label}
          </Link>
        ))}
      </nav>

      {/* Node Catalog */}
      <div className="flex-1 overflow-y-auto px-4 space-y-8 scrollbar-none pb-8">
        {Object.entries(grouped).map(([category, nodes]) => (
          <div key={category} className="space-y-3">
            <h2 className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-700 px-2">
              {categoryLabels[category]}
            </h2>
            <div className="space-y-1">
              {nodes.map((node) => (
                <div
                  key={node.type}
                  draggable
                  onDragStart={(e) => onDragStart(e, node.type)}
                  onClick={() => onAddNode?.(node.type)}
                  className="group flex items-center gap-3 px-2 py-2 rounded-lg cursor-grab hover:bg-white/5 transition-all active:scale-95 border border-transparent hover:border-white/5"
                >
                  <div
                    className="flex items-center justify-center w-4 h-4 text-slate-500 group-hover:text-white transition-colors"
                    style={{ color: node.accent + "aa" }}
                  >
                    {iconMap[node.icon]}
                  </div>
                  <span className="text-[11px] font-medium text-slate-500 group-hover:text-slate-300 transition-colors">
                    {node.label}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Bottom Actions */}
      <div className="px-4 py-4 space-y-2 border-t border-white/5">
        <button 
          onClick={() => window.dispatchEvent(new CustomEvent("lumina:open-docs"))}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-[11px] font-bold text-slate-600 hover:text-slate-400 hover:bg-white/5 transition-all cursor-pointer"
        >
          <BookOpen size={14} />
          DOCS
        </button>
        <button 
          onClick={() => window.dispatchEvent(new CustomEvent("lumina:open-help"))}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-[11px] font-bold text-slate-600 hover:text-slate-400 hover:bg-white/5 transition-all cursor-pointer"
        >
          <HelpCircle size={14} />
          HELP
        </button>
      </div>

      {/* Connection Status */}
      <div className="px-6 py-4 bg-black/40 border-t border-white/5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={`w-1.5 h-1.5 rounded-full ${backendConnected ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)] animate-pulse'}`} />
            <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">
              {backendConnected ? "Live" : "Offline"}
            </span>
          </div>
          <Settings2 size={12} className="text-slate-600 hover:text-slate-400 cursor-pointer" />
        </div>
      </div>
    </aside>
  );
}
