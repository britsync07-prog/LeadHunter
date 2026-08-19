"use client";

import { useState, useEffect } from "react";
import Sidebar from "@/components/Sidebar";
import Topbar from "@/components/Topbar";
import { Play, Database, MapPin, Sparkles, Sliders } from "lucide-react";

export default function DashboardPage() {
  const [user, setUser] = useState<any>(null);
  const [niches, setNiches] = useState("");
  const [country, setCountry] = useState("United Kingdom");
  const [includeGoogleMaps, setIncludeGoogleMaps] = useState(true);
  const [includeSocial, setIncludeSocial] = useState(false);
  const [isRunning, setIsRunning] = useState(false);

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
        <Topbar title="Scraper Command" plan={user?.subscriptionPlan} status={isRunning ? "Running" : "Idle"} />

        <main className="p-8 max-w-7xl mx-auto w-full grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Left Config Panel */}
          <div className="space-y-6">
            <div className="double-bezel-card p-6">
              <div className="pb-4 border-b border-slate-200 flex items-center gap-3 mb-5">
                <div className="w-8 h-8 rounded-lg bg-[#012169]/10 text-[#012169] flex items-center justify-center">
                  <Database className="w-4 h-4" />
                </div>
                <h2 className="font-heading font-black text-[#012169] text-base">Target Niches</h2>
              </div>
              <label className="block text-xs font-heading font-bold uppercase tracking-wider text-slate-500 mb-2">
                Enter one niche per line
              </label>
              <textarea
                value={niches}
                onChange={(e) => setNiches(e.target.value)}
                rows={4}
                placeholder="Fitness Trainer&#10;Yoga Studio&#10;Gym Owner"
                className="w-full p-4 bg-white border border-slate-200 rounded-xl text-xs font-mono text-slate-900 focus:outline-none focus:border-[#012169] mb-3"
              />
              <button className="text-xs px-3 py-1.5 bg-[#012169]/08 hover:bg-[#012169]/15 text-[#012169] font-bold rounded-lg transition-colors flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5" />
                Expand Niche Ideas
              </button>
            </div>

            <div className="double-bezel-card p-6">
              <div className="pb-4 border-b border-slate-200 flex items-center gap-3 mb-5">
                <div className="w-8 h-8 rounded-lg bg-[#012169]/10 text-[#012169] flex items-center justify-center">
                  <MapPin className="w-4 h-4" />
                </div>
                <h2 className="font-heading font-black text-[#012169] text-base">Location Parameters</h2>
              </div>
              <div>
                <label className="block text-xs font-heading font-bold uppercase tracking-wider text-slate-500 mb-2">
                  Country
                </label>
                <select
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-xs font-mono text-slate-900 focus:outline-none focus:border-[#012169]"
                >
                  <option value="United Kingdom">United Kingdom</option>
                  <option value="United States">United States</option>
                  <option value="Canada">Canada</option>
                </select>
              </div>
            </div>

            <div className="double-bezel-card p-6">
              <div className="pb-4 border-b border-slate-200 flex items-center gap-3 mb-5">
                <div className="w-8 h-8 rounded-lg bg-[#012169]/10 text-[#012169] flex items-center justify-center">
                  <Sliders className="w-4 h-4" />
                </div>
                <h2 className="font-heading font-black text-[#012169] text-base">Data Sources</h2>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <label className="flex items-center gap-3 p-4 bg-white border border-slate-200 rounded-xl cursor-pointer hover:border-[#012169]/30">
                  <input
                    type="checkbox"
                    checked={includeGoogleMaps}
                    onChange={(e) => setIncludeGoogleMaps(e.target.checked)}
                    className="w-4 h-4 text-[#012169] rounded accent-[#012169]"
                  />
                  <div>
                    <div className="text-xs font-bold text-[#012169]">Google Maps</div>
                    <div className="text-[10px] text-slate-500">Business & Phone</div>
                  </div>
                </label>
                <label className="flex items-center gap-3 p-4 bg-white border border-slate-200 rounded-xl cursor-pointer hover:border-[#012169]/30">
                  <input
                    type="checkbox"
                    checked={includeSocial}
                    onChange={(e) => setIncludeSocial(e.target.checked)}
                    className="w-4 h-4 text-[#012169] rounded accent-[#012169]"
                  />
                  <div>
                    <div className="text-xs font-bold text-[#012169]">Social Web</div>
                    <div className="text-[10px] text-slate-500">Direct Emails</div>
                  </div>
                </label>
              </div>
            </div>

            <button
              onClick={() => setIsRunning(!isRunning)}
              className="w-full py-4 bg-[#C8102E] hover:bg-[#a90d26] text-white rounded-xl font-heading font-bold text-xs uppercase tracking-[0.18em] shadow-glow flex items-center justify-center gap-2 cursor-pointer transition-all hover:-translate-y-0.5"
            >
              <Play className="w-4 h-4" />
              {isRunning ? "Stop Scraper Engine" : "Run Scraper Engine"}
            </button>
          </div>

          {/* Right Feed & History */}
          <div className="space-y-6">
            <div className="double-bezel-card p-6">
              <div className="pb-4 border-b border-slate-200 flex items-center justify-between mb-4">
                <h2 className="font-heading font-black text-[#012169] text-base">Live Scrape Feed</h2>
                <span className="px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-mono font-bold">
                  0 leads collected
                </span>
              </div>
              <div className="h-64 bg-[#000c2b] text-emerald-400 p-4 rounded-xl font-mono text-xs overflow-y-auto space-y-2 border border-slate-800">
                <div className="text-slate-500">// Waiting for scrape job activation...</div>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
