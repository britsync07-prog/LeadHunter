"use client";

import { useState } from "react";
import Link from "next/link";
import { Lock, Eye, EyeOff, LogIn } from "lucide-react";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, rememberMe }),
      });

      if (res.ok) {
        window.location.href = "/dashboard";
      } else {
        const data = await res.json();
        setError(data.error || "Incorrect credentials.");
      }
    } catch {
      setError("Network connection lost. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6 relative overflow-hidden">
      {/* Background Orbs */}
      <div className="absolute top-[-10%] left-[-10%] w-[36rem] h-[36rem] bg-[#012169]/10 rounded-full blur-[140px] pointer-events-none"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-[32rem] h-[32rem] bg-[#C8102E]/10 rounded-full blur-[140px] pointer-events-none"></div>

      <div className="w-full max-w-[440px] relative z-10">
        {/* Brand Header */}
        <div className="flex items-center gap-3 justify-center mb-8">
          <div className="w-12 h-12 rounded-2xl bg-[#012169] flex items-center justify-center border border-[#012169]/20 shadow-xl">
            <img src="/vite.ico" alt="Logo" className="w-7 h-7 object-contain" />
          </div>
          <span className="text-2xl font-heading font-black text-[#012169] tracking-tight">
            LeadHunter <span className="text-[#C8102E] font-medium text-xs">UK</span>
          </span>
        </div>

        {/* Card */}
        <div className="double-bezel-card p-8 sm:p-10">
          <div className="text-center mb-8">
            <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-[#012169]/08 border border-[#012169]/15 text-[10px] font-heading font-bold uppercase tracking-[0.2em] text-[#012169] mb-3">
              <Lock className="w-3 h-3 text-[#C8102E]" />
              Command Center Access
            </div>
            <h1 className="text-3xl font-heading font-black text-[#012169] tracking-tight mb-2">Welcome Back</h1>
            <p className="text-xs text-slate-500 font-medium">Enter credentials to access your outreach workspace</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-[11px] font-heading font-bold text-slate-700 mb-2 uppercase tracking-wider">
                Username or Email
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                placeholder="admin or email@example.com"
                className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-sm font-mono text-slate-900 focus:outline-none focus:border-[#012169] focus:ring-4 focus:ring-[#012169]/10 transition-all"
              />
            </div>

            <div>
              <label className="block text-[11px] font-heading font-bold text-slate-700 mb-2 uppercase tracking-wider">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  placeholder="••••••••"
                  className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-sm font-mono text-slate-900 focus:outline-none focus:border-[#012169] focus:ring-4 focus:ring-[#012169]/10 transition-all pr-12"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-[#012169]"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between pt-1">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-[#012169] focus:ring-[#012169]/20 cursor-pointer accent-[#012169]"
                />
                <span className="text-xs text-slate-600 font-medium">Remember me (30 days)</span>
              </label>
              <a href="https://discord.gg/WYEmRXRbmn" target="_blank" className="text-xs font-semibold text-[#012169] hover:underline">
                Forgot password?
              </a>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 bg-[#C8102E] hover:bg-[#a90d26] text-white rounded-xl text-xs font-heading font-bold uppercase tracking-[0.18em] transition-all shadow-glow hover:-translate-y-0.5 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              <LogIn className="w-4 h-4" />
              {loading ? "Verifying..." : "Sign In"}
            </button>
          </form>

          {error && (
            <div className="mt-5 p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs font-medium">
              {error}
            </div>
          )}

          <div className="mt-6 pt-5 border-t border-slate-100 text-center text-xs text-slate-500 font-medium">
            Don&apos;t have an account?{" "}
            <Link href="/signup" className="text-[#012169] font-bold hover:underline">
              Sign up for free
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
