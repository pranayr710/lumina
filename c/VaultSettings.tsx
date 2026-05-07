"use client";

import React, { useState } from "react";
import { useVaultStore, Credential } from "@/l/vaultStore";
import { Shield, Plus, Trash2, Key, Globe, Lock } from "lucide-react";

export default function VaultSettings({ onClose }: { onClose: () => void }) {
  const { credentials, addCredential, removeCredential } = useVaultStore();
  const [name, setName] = useState("");
  const [type, setType] = useState<Credential["type"]>("discord");
  const [value, setValue] = useState("");

  const handleAdd = () => {
    if (!name || !value) return;
    addCredential({ name, type, value });
    setName("");
    setValue("");
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-md p-6">
      <div className="glass w-full max-w-2xl rounded-[2.5rem] border border-white/10 shadow-2xl overflow-hidden flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="px-8 py-6 border-b border-white/5 flex items-center justify-between bg-white/5">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-[#4285F4]/10 rounded-2xl">
              <Shield className="text-[#4285F4]" size={24} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white tracking-tight">Lumina Secure Vault</h2>
              <p className="text-xs text-slate-400 font-medium">Securely manage your API keys, SMTP credentials, and webhooks locally</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white/5 rounded-full text-slate-400 transition-colors">
            <Plus className="rotate-45" size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-8 space-y-8">
          {/* Add New Section */}
          <div className="space-y-4">
            <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">Register New Secret</h3>
            <div className="grid grid-cols-12 gap-3">
              <div className="col-span-4">
                <input
                  type="text"
                  placeholder="Key Name (e.g. MySlack)"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white placeholder-slate-600 outline-none focus:border-[#4285F4]/50"
                />
              </div>
              <div className="col-span-3">
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value as any)}
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white outline-none focus:border-[#4285F4]/50 appearance-none"
                >
                  <option value="discord">Discord</option>
                  <option value="slack">Slack</option>
                  <option value="google">Google</option>
                  <option value="twilio">Twilio</option>
                  <option value="email">Email</option>
                </select>
              </div>
              <div className="col-span-4">
                <input
                  type="password"
                  placeholder="Secret Value / Webhook"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-white placeholder-slate-600 outline-none focus:border-[#4285F4]/50"
                />
              </div>
              <div className="col-span-1">
                <button
                  onClick={handleAdd}
                  className="w-full h-full bg-[#4285F4] text-white rounded-xl flex items-center justify-center hover:bg-[#357ae8] transition-colors"
                >
                  <Plus size={18} />
                </button>
              </div>
            </div>
          </div>

          {/* Existing Keys */}
          <div className="space-y-4">
            <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">Stored Credentials</h3>
            <div className="space-y-2">
              {credentials.length === 0 ? (
                <div className="py-12 border border-dashed border-white/5 rounded-3xl flex flex-col items-center gap-3 text-slate-600">
                  <Lock size={32} strokeWidth={1} />
                  <span className="text-xs font-medium">No secrets registered yet</span>
                </div>
              ) : (
                credentials.map((c) => (
                  <div key={c.id} className="glass px-5 py-4 rounded-2xl flex items-center justify-between border border-white/5 hover:border-white/10 transition-colors group">
                    <div className="flex items-center gap-4">
                      <div className="p-2 bg-white/5 rounded-lg text-slate-400">
                        {c.type === 'google' ? <Globe size={16} /> : <Key size={16} />}
                      </div>
                      <div>
                        <span className="text-sm font-bold text-slate-200">{c.name}</span>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[9px] font-bold text-[#4285F4] uppercase tracking-widest">{c.type}</span>
                          <span className="text-[9px] text-slate-600">••••••••••••••••</span>
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => removeCredential(c.id)}
                      className="p-2 text-slate-600 hover:text-red-400 hover:bg-red-500/10 rounded-xl transition-all opacity-0 group-hover:opacity-100"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="px-8 py-5 border-t border-white/5 bg-black/20 flex justify-between items-center">
          <p className="text-[10px] text-slate-500">All credentials are stored securely on your local device.</p>
          <button
            onClick={onClose}
            className="px-6 py-2 bg-white/5 hover:bg-white/10 text-white rounded-full text-xs font-bold transition-all"
          >
            Close Vault
          </button>
        </div>
      </div>
    </div>
  );
}
