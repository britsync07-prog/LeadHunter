"use client";

import { useState } from "react";
import Link from "next/link";
import { UserPlus, Eye, EyeOff } from "lucide-react";

export default function SignupPage() {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, email, password }),
      });

      if (res.ok) {
        window.location.href = "/dashboard";
      } else {
        const data = await res.json();
        setError(data.error || "Registration failed.");
      }
    } catch {
      setError("Network error. Please try again.");
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
            <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-[10px] font-heading font-bold uppercase tracking-[0.2em] text-emerald-700 mb-3">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
              3-Day Enterprise Access Included
            </div>
            <h1 className="text-3xl font-heading font-black text-[#012169] tracking-tight mb-2">Create Account</h1>
            <p className="text-xs text-slate-500 font-medium">Join the automated UK lead generation engine</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-[11px] font-heading font-bold text-slate-700 mb-2 uppercase tracking-wider">
                Username
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                placeholder="johndoe"
                className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl text-sm font-mono text-slate-900 focus:outline-none focus:border-[#012169] focus:ring-4 focus:ring-[#012169]/10 transition-all"
              />
            </div>

            <div>
              <label className="block text-[11px] font-heading font-bold text-slate-700 mb-2 uppercase tracking-wider">
                Email Address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="john@example.com"
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

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 bg-[#C8102E] hover:bg-[#a90d26] text-white rounded-xl text-xs font-heading font-bold uppercase tracking-[0.18em] transition-all shadow-glow hover:-translate-y-0.5 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              <UserPlus className="w-4 h-4" />
              {loading ? "Registering..." : "Sign Up Free"}
            </button>
          </form>

          {error && (
            <div className="mt-5 p-4 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs font-medium">
              {error}
            </div>
          )}

          <div className="mt-6 pt-5 border-t border-slate-100 text-center text-xs text-slate-500 font-medium">
            Already have an account?{" "}
            <Link href="/login" className="text-[#012169] font-bold hover:underline">
              Sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
