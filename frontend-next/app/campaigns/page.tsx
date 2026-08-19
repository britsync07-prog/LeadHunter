"use client";

import { useState, useEffect } from "react";
import Sidebar from "@/components/Sidebar";
import Topbar from "@/components/Topbar";
import { Layers, Folder, FileText } from "lucide-react";

export default function CampaignsPage() {
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
        <Topbar title="Campaign Viewer" plan={user?.subscriptionPlan} />

        <main className="p-8 max-w-7xl mx-auto w-full grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Panel 1 */}
          <div className="double-bezel-card p-6 space-y-4">
            <div className="flex items-center gap-2 pb-3 border-b border-slate-200">
              <Layers className="w-4 h-4 text-[#012169]" />
              <h2 className="font-heading font-bold text-[#012169] text-sm">Campaigns List</h2>
            </div>
            <div className="text-xs text-slate-500 italic p-4 text-center">Loading campaigns...</div>
          </div>

          {/* Panel 2 */}
          <div className="double-bezel-card p-6 space-y-4">
            <div className="flex items-center gap-2 pb-3 border-b border-slate-200">
              <Folder className="w-4 h-4 text-[#012169]" />
              <h2 className="font-heading font-bold text-[#012169] text-sm">Jobs in Campaign</h2>
            </div>
            <div className="text-xs text-slate-500 italic p-4 text-center">Select a campaign from the left.</div>
          </div>

          {/* Panel 3 */}
          <div className="double-bezel-card p-6 space-y-4">
            <div className="flex items-center gap-2 pb-3 border-b border-slate-200">
              <FileText className="w-4 h-4 text-[#012169]" />
              <h2 className="font-heading font-bold text-[#012169] text-sm">File Content</h2>
            </div>
            <div className="text-xs text-slate-500 italic p-4 text-center">Select a file to preview.</div>
          </div>
        </main>
      </div>
    </div>
  );
}
