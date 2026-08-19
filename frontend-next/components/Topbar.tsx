"use client";

interface TopbarProps {
  title: string;
  plan?: string;
  status?: string;
}

export default function Topbar({ title, plan, status = "Idle" }: TopbarProps) {
  return (
    <header className="min-h-[64px] border-b border-slate-200 flex items-center justify-between px-6 sticky top-0 z-40 bg-white/80 backdrop-blur-md shadow-sm">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-heading font-black text-[#012169] tracking-tight">{title}</h1>
      </div>
      <div className="flex items-center gap-3">
        {plan && (
          <span className="text-[10px] font-mono font-bold uppercase tracking-wider px-3 py-1 rounded-full bg-[#012169]/10 text-[#012169] border border-[#012169]/20">
            {plan} Plan
          </span>
        )}
        <div className="flex items-center gap-2 text-xs font-semibold px-3 py-1 rounded-full bg-slate-100 border border-slate-200 text-slate-700">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
          <span>{status}</span>
        </div>
      </div>
    </header>
  );
}
