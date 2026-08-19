"use client";

import { useState, useEffect } from "react";
import Sidebar from "@/components/Sidebar";
import Topbar from "@/components/Topbar";
import { CheckCircle2, Code } from "lucide-react";

export default function CheckerPage() {
  const [user, setUser] = useState<any>(null);
  const [testEmail, setTestEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [htmlInput, setHtmlInput] = useState("");

  useEffect(() => {
    fetch("/api/me")
      .then((res) => res.json())
      .then((data) => setUser(data))
      .catch(() => {});
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 flex">
      <Sidebar user={user} isAdmin={user?.isAdmin} />

      <div className="ml-[240px] flex-1 flex flex-col min-h-screen">
        <Topbar title="Template Checker" plan={user?.subscriptionPlan} />

        <main className="p-8 max-w-7xl mx-auto w-full grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="double-bezel-card p-6 space-y-5">
            <div className="pb-4 border-b border-slate-200 flex items-center gap-2">
              <Code className="w-4 h-4 text-[#012169]" />
              <h2 className="font-heading font-black text-[#012169] text-base">Paste HTML Template</h2>
            </div>
            <div>
              <label className="block text-xs font-heading font-bold uppercase tracking-wider text-slate-500 mb-2">Test Email</label>
              <input
                type="email"
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
                placeholder="your@email.com"
                className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-xs font-mono text-slate-900 focus:outline-none focus:border-[#012169]"
              />
            </div>
            <div>
              <label className="block text-xs font-heading font-bold uppercase tracking-wider text-slate-500 mb-2">Subject</label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Email Subject"
                className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-xs font-mono text-slate-900 focus:outline-none focus:border-[#012169]"
              />
            </div>
            <div>
              <label className="block text-xs font-heading font-bold uppercase tracking-wider text-slate-500 mb-2">HTML Code</label>
              <textarea
                value={htmlInput}
                onChange={(e) => setHtmlInput(e.target.value)}
                rows={10}
                placeholder="<html><body><h1>Hello</h1></body></html>"
                className="w-full p-4 bg-[#000c2b] text-emerald-400 border border-slate-800 rounded-xl text-xs font-mono focus:outline-none"
              />
            </div>
            <button className="w-full py-3.5 bg-[#C8102E] hover:bg-[#a90d26] text-white rounded-xl text-xs font-heading font-bold uppercase tracking-wider shadow-glow flex items-center justify-center gap-2 cursor-pointer">
              <CheckCircle2 className="w-4 h-4" />
              Validate & Send Test
            </button>
          </div>

          <div className="double-bezel-card p-6">
            <div className="pb-4 border-b border-slate-200">
              <h2 className="font-heading font-black text-[#012169] text-base">Validation Report</h2>
            </div>
            <div className="p-8 text-center text-xs font-mono text-slate-500 italic">
              Results will appear here after checking template.
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
