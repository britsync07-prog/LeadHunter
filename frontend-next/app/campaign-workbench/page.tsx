"use client";

import { useState, useEffect } from "react";
import Sidebar from "@/components/Sidebar";
import Topbar from "@/components/Topbar";
import { Save } from "lucide-react";

export default function CampaignWorkbenchPage() {
  const [user, setUser] = useState<any>(null);

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
        <Topbar title="Campaign Workbench" plan={user?.subscriptionPlan} />

        <main className="p-8 max-w-7xl mx-auto w-full space-y-8">
          <div className="double-bezel-card p-6 space-y-6">
            <div className="flex items-center justify-between pb-4 border-b border-slate-200">
              <div>
                <h1 className="text-xl font-heading font-black text-[#012169]">Campaign Sequence Builder</h1>
                <p className="text-xs text-slate-500">Configure automated steps, delays, and tracking</p>
              </div>
              <button className="px-5 py-2.5 bg-[#C8102E] text-white rounded-xl text-xs font-heading font-bold uppercase tracking-wider shadow-glow flex items-center gap-2">
                <Save className="w-4 h-4" />
                Save Workflow
              </button>
            </div>
            <div className="p-8 text-center bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono text-slate-600">
              Interactive Workbench Workflow Canvas Initialized
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
