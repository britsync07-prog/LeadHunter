"use client";

import { useState, useEffect } from "react";
import Sidebar from "@/components/Sidebar";
import Topbar from "@/components/Topbar";
import { Users, Shield, Crown, Zap, Plus, Search } from "lucide-react";

export default function AdminPage() {
  const [user, setUser] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    fetch("/api/me")
      .then((res) => res.json())
      .then((data) => setUser(data))
      .catch(() => {});

    fetch("/api/admin/users")
      .then((res) => res.json())
      .then((data) => setUsers(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  const filteredUsers = users.filter(
    (u) =>
      u.username?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      u.email?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-slate-50 flex">
      <Sidebar user={user} isAdmin={user?.isAdmin} />

      <div className="ml-[240px] flex-1 flex flex-col min-h-screen">
        <Topbar title="User Administration" plan={user?.subscriptionPlan} status="Admin Mode" />

        <main className="p-8 max-w-7xl mx-auto w-full space-y-8">
          {/* Stats Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="double-bezel-card p-6 flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-[#012169]/10 text-[#012169] flex items-center justify-center">
                <Users className="w-6 h-6" />
              </div>
              <div>
                <div className="text-[10px] font-heading font-bold text-slate-500 uppercase tracking-wider">Total Users</div>
                <div className="text-2xl font-mono font-bold text-[#012169]">{users.length}</div>
              </div>
            </div>

            <div className="double-bezel-card p-6 flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center">
                <Shield className="w-6 h-6" />
              </div>
              <div>
                <div className="text-[10px] font-heading font-bold text-slate-500 uppercase tracking-wider">Admins</div>
                <div className="text-2xl font-mono font-bold text-purple-700">
                  {users.filter((u) => u.isAdmin).length}
                </div>
              </div>
            </div>

            <div className="double-bezel-card p-6 flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center">
                <Crown className="w-6 h-6" />
              </div>
              <div>
                <div className="text-[10px] font-heading font-bold text-slate-500 uppercase tracking-wider">Premium</div>
                <div className="text-2xl font-mono font-bold text-emerald-700">
                  {users.filter((u) => u.subscriptionPlan === "premium").length}
                </div>
              </div>
            </div>

            <div className="double-bezel-card p-6 flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center">
                <Zap className="w-6 h-6" />
              </div>
              <div>
                <div className="text-[10px] font-heading font-bold text-slate-500 uppercase tracking-wider">Advance</div>
                <div className="text-2xl font-mono font-bold text-amber-700">
                  {users.filter((u) => u.subscriptionPlan === "advance").length}
                </div>
              </div>
            </div>
          </div>

          {/* Table Container */}
          <div className="double-bezel-card p-6 space-y-6">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="relative flex-1 max-w-md">
                <Search className="w-4 h-4 absolute left-3.5 top-3.5 text-slate-400" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search users..."
                  className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-mono text-slate-900 focus:outline-none focus:border-[#012169]"
                />
              </div>
              <button className="px-4 py-2.5 bg-[#C8102E] text-white rounded-xl text-xs font-heading font-bold uppercase tracking-wider hover:bg-[#a90d26] transition-all flex items-center gap-2">
                <Plus className="w-4 h-4" />
                Create User
              </button>
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full text-left font-mono text-xs">
                <thead className="bg-slate-100 text-slate-600 font-heading uppercase text-[10px] tracking-wider border-b border-slate-200">
                  <tr>
                    <th className="p-4">Username</th>
                    <th className="p-4">Email</th>
                    <th className="p-4">Role</th>
                    <th className="p-4">Plan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredUsers.map((u) => (
                    <tr key={u.id} className="hover:bg-slate-50">
                      <td className="p-4 font-bold text-[#012169]">{u.username}</td>
                      <td className="p-4 text-slate-600">{u.email || "—"}</td>
                      <td className="p-4">
                        {u.isAdmin ? (
                          <span className="px-2.5 py-1 rounded-full bg-purple-100 text-purple-700 font-bold uppercase text-[9px]">Admin</span>
                        ) : (
                          <span className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 text-[9px]">User</span>
                        )}
                      </td>
                      <td className="p-4">
                        <span className="px-2.5 py-1 rounded-full bg-[#012169]/10 text-[#012169] font-bold uppercase text-[9px]">
                          {u.subscriptionPlan || "free"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
