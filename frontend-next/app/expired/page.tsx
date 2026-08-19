"use client";

import Link from "next/link";
import { AlertCircle } from "lucide-react";

export default function ExpiredPage() {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6 relative overflow-hidden">
      <div className="max-w-xl w-full double-bezel-card p-10 text-center relative z-10 border-rose-200">
        <div className="w-16 h-16 bg-rose-100 border border-rose-200 rounded-2xl flex items-center justify-center mx-auto mb-6">
          <AlertCircle className="w-8 h-8 text-[#C8102E]" />
        </div>
        <div className="inline-block px-3.5 py-1 bg-rose-50 border border-rose-200 rounded-full text-[10px] font-heading font-bold uppercase tracking-widest text-[#C8102E] mb-3">
          Trial Period Expired
        </div>
        <h1 className="text-3xl font-heading font-black text-[#012169] tracking-tight mb-3">ACCESS EXPIRED</h1>
        <p className="text-xs text-slate-600 mb-8 leading-relaxed">
          Your 3-day enterprise access to LeadHunter has ended. To continue scraping B2B leads and sending cold outreach campaigns, please select a subscription plan.
        </p>

        <div className="grid grid-cols-2 gap-4 mb-8 text-left">
          <div className="p-5 rounded-2xl bg-[#012169]/05 border border-[#012169]/15">
            <div className="text-[10px] font-heading font-bold uppercase text-[#012169] mb-1">Advance Plan</div>
            <div className="text-2xl font-heading font-black text-[#012169]">£79 /mo</div>
            <div className="text-[10px] text-slate-500 font-mono">1,000 leads/day</div>
          </div>
          <div className="p-5 rounded-2xl bg-purple-50 border border-purple-200">
            <div className="text-[10px] font-heading font-bold uppercase text-purple-900 mb-1">Premium Plan</div>
            <div className="text-2xl font-heading font-black text-purple-900">£449 /mo</div>
            <div className="text-[10px] text-slate-500 font-mono">6,000 leads/day</div>
          </div>
        </div>

        <div className="flex gap-4 justify-center">
          <Link href="/#pricing" className="px-8 py-3.5 bg-[#C8102E] text-white rounded-xl text-xs font-heading font-bold uppercase tracking-wider shadow-glow hover:bg-[#a90d26]">
            Renew Access
          </Link>
        </div>
      </div>
    </div>
  );
}
