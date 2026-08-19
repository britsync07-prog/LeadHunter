"use client";

import { useState, useEffect } from "react";
import Sidebar from "@/components/Sidebar";
import Topbar from "@/components/Topbar";
import { Send, CheckCircle2, Eye, MousePointer } from "lucide-react";

export default function SenderPage() {
  const [user, setUser] = useState<any>(null);
  const [campaignName, setCampaignName] = useState("");
  const [senderName, setSenderName] = useState("");
  const [subject, setSubject] = useState("");
  const [htmlContent, setHtmlContent] = useState("");

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
        <Topbar title="Sender Portal" plan={user?.subscriptionPlan} />

        <main className="p-8 max-w-7xl mx-auto w-full space-y-8">
          {/* KPI Row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="double-bezel-card p-5 flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-[#012169]/10 text-[#012169] flex items-center justify-center">
                <Send className="w-5 h-5" />
              </div>
              <div>
                <div className="text-[10px] font-heading font-bold text-slate-500 uppercase tracking-wider">Total Sent</div>
                <div className="text-2xl font-mono font-bold text-[#012169]">0</div>
              </div>
            </div>

            <div className="double-bezel-card p-5 flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <div>
                <div className="text-[10px] font-heading font-bold text-slate-500 uppercase tracking-wider">Delivery Rate</div>
                <div className="text-2xl font-mono font-bold text-emerald-700">0%</div>
              </div>
            </div>

            <div className="double-bezel-card p-5 flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center">
                <Eye className="w-5 h-5" />
              </div>
              <div>
                <div className="text-[10px] font-heading font-bold text-slate-500 uppercase tracking-wider">Open Rate</div>
                <div className="text-2xl font-mono font-bold text-amber-700">0%</div>
              </div>
            </div>

            <div className="double-bezel-card p-5 flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center">
                <MousePointer className="w-5 h-5" />
              </div>
              <div>
                <div className="text-[10px] font-heading font-bold text-slate-500 uppercase tracking-wider">Click Rate</div>
                <div className="text-2xl font-mono font-bold text-purple-700">0%</div>
              </div>
            </div>
          </div>

          {/* Campaign Form */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            <div className="double-bezel-card p-6 space-y-5">
              <div className="pb-4 border-b border-slate-200">
                <h2 className="font-heading font-black text-[#012169] text-base">Compose Outreach Campaign</h2>
              </div>
              <div>
                <label className="block text-xs font-heading font-bold uppercase tracking-wider text-slate-500 mb-2">Campaign Name</label>
                <input
                  type="text"
                  value={campaignName}
                  onChange={(e) => setCampaignName(e.target.value)}
                  placeholder="e.g. Q4 UK Real Estate Outreach"
                  className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-xs font-mono text-slate-900 focus:outline-none focus:border-[#012169]"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-heading font-bold uppercase tracking-wider text-slate-500 mb-2">Sender Name</label>
                  <input
                    type="text"
                    value={senderName}
                    onChange={(e) => setSenderName(e.target.value)}
                    placeholder="John Doe"
                    className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-xs font-mono text-slate-900 focus:outline-none focus:border-[#012169]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-heading font-bold uppercase tracking-wider text-slate-500 mb-2">Subject</label>
                  <input
                    type="text"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="Quick question"
                    className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-xs font-mono text-slate-900 focus:outline-none focus:border-[#012169]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-heading font-bold uppercase tracking-wider text-slate-500 mb-2">HTML Content</label>
                <textarea
                  value={htmlContent}
                  onChange={(e) => setHtmlContent(e.target.value)}
                  rows={6}
                  placeholder="<p>Hi {{FirstName}}, ...</p>"
                  className="w-full p-4 bg-white border border-slate-200 rounded-xl text-xs font-mono text-slate-900 focus:outline-none focus:border-[#012169]"
                />
              </div>

              <button className="w-full py-4 bg-[#C8102E] hover:bg-[#a90d26] text-white font-heading font-bold text-xs uppercase tracking-[0.18em] rounded-xl shadow-glow transition-all flex items-center justify-center gap-2 cursor-pointer">
                <Send className="w-4 h-4" />
                Launch Campaign
              </button>
            </div>

            {/* Audience Panel */}
            <div className="double-bezel-card p-6 space-y-5">
              <div className="pb-4 border-b border-slate-200">
                <h2 className="font-heading font-black text-[#012169] text-base">Target Audience</h2>
              </div>
              <div className="border-2 border-dashed border-slate-200 rounded-2xl p-8 text-center hover:border-[#012169] transition-all bg-slate-50">
                <p className="text-xs text-slate-600 font-medium mb-3">Upload your lead file (.csv or .txt)</p>
                <button className="px-4 py-2 bg-[#012169] text-white rounded-xl text-xs font-bold font-heading uppercase">
                  Browse File
                </button>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
