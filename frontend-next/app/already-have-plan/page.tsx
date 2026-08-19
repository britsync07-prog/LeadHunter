"use client";

import Link from "next/link";
import { CheckCircle } from "lucide-react";

export default function AlreadyHavePlanPage() {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6 relative overflow-hidden">
      <div className="max-w-xl w-full double-bezel-card p-10 text-center relative z-10">
        <div className="w-16 h-16 bg-emerald-100 border border-emerald-200 rounded-2xl flex items-center justify-center mx-auto mb-6">
          <CheckCircle className="w-8 h-8 text-emerald-600" />
        </div>
        <div className="inline-block px-3.5 py-1 bg-emerald-50 border border-emerald-200 rounded-full text-[10px] font-heading font-bold uppercase tracking-widest text-emerald-700 mb-3">
          Subscription Active
        </div>
        <h1 className="text-3xl font-heading font-black text-[#012169] tracking-tight mb-3">ACTIVE PLAN FOUND</h1>
        <p className="text-xs text-slate-600 mb-8 leading-relaxed">
          You are already subscribed to an active subscription tier. There is no need to purchase this plan again.
        </p>

        <div className="flex gap-4 justify-center">
          <Link href="/dashboard" className="px-8 py-3.5 bg-[#012169] text-white rounded-xl text-xs font-heading font-bold uppercase tracking-wider shadow-md hover:bg-[#000c2b]">
            Go to Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
