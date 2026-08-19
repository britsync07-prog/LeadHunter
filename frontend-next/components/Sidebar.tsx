"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { 
  Database, 
  Send, 
  Layers, 
  CheckCircle, 
  Crown, 
  ShieldAlert, 
  User, 
  LogOut 
} from "lucide-react";

interface SidebarProps {
  user?: { username?: string; subscriptionPlan?: string } | null;
  isAdmin?: boolean;
}

export default function Sidebar({ user, isAdmin }: SidebarProps) {
  const pathname = usePathname();

  const navItems = [
    { name: "Scraper", href: "/dashboard", icon: Database },
    { name: "Sender", href: "/sender", icon: Send },
    { name: "Campaigns", href: "/campaigns", icon: Layers },
    { name: "Checker", href: "/checker", icon: CheckCircle },
  ];

  return (
    <aside className="w-[240px] bg-[#012169] text-white flex flex-col fixed inset-y-0 left-0 z-50 shadow-2xl border-r border-white/10">
      {/* Brand Logo */}
      <div className="p-6 border-b border-white/10 flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center border border-white/20 shrink-0">
          <img src="/vite.ico" alt="Logo" className="w-6 h-6 object-contain" />
        </div>
        <div className="font-heading font-black text-lg text-white tracking-tight">
          LeadHunter <span className="text-[#C8102E] font-medium text-xs uppercase ml-0.5">UK</span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4 space-y-1.5 overflow-y-auto">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.name}
              href={item.href}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl font-heading font-semibold text-xs transition-all ${
                isActive
                  ? "bg-[#C8102E] text-white shadow-glow"
                  : "text-slate-300 hover:bg-white/10 hover:text-white"
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{item.name}</span>
            </Link>
          );
        })}

        {/* Pro Plan Link */}
        <Link
          href="/#pricing"
          className="flex items-center gap-3 px-4 py-3 mt-6 rounded-xl font-heading font-bold text-xs bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 shadow-md hover:brightness-110 transition-all"
        >
          <Crown className="w-4 h-4 text-slate-950" />
          <span>Pro Plans</span>
        </Link>

        {/* Admin Link */}
        {isAdmin && (
          <Link
            href="/admin"
            className="flex items-center gap-3 px-4 py-3 rounded-xl font-heading font-bold text-xs bg-purple-900/60 border border-purple-400/30 text-purple-200 hover:bg-purple-800/80 transition-all"
          >
            <ShieldAlert className="w-4 h-4 text-purple-300" />
            <span>Admin Panel</span>
          </Link>
        )}
      </nav>

      {/* User Footer */}
      <div className="p-4 border-t border-white/10 bg-[#000c2b] flex flex-col gap-2">
        <div className="flex items-center gap-2.5 px-3 py-2 bg-white/05 rounded-xl border border-white/10 text-xs text-slate-200">
          <User className="w-4 h-4 text-[#C8102E] shrink-0" />
          <span className="truncate font-mono text-[11px]">{user?.username || "Guest User"}</span>
        </div>
        <button
          onClick={async () => {
            await fetch("/api/logout", { method: "POST" });
            window.location.href = "/login";
          }}
          className="flex items-center justify-center gap-2 px-3 py-2 w-full text-xs font-semibold text-rose-400 hover:bg-rose-500/20 rounded-xl transition-all border border-rose-500/20 cursor-pointer"
        >
          <LogOut className="w-4 h-4" />
          <span>Logout</span>
        </button>
      </div>
    </aside>
  );
}
