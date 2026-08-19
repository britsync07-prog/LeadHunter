tailwind.config = {
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Manrope', 'Plus Jakarta Sans', 'system-ui', 'sans-serif'],
        display: ['Space Grotesk', 'Outfit', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      colors: {
        obsidian: {
          950: '#070a12',
          900: '#0b0f19',
          850: '#0f172a',
          800: '#1e293b',
          700: '#334155',
        },
        brand: {
          base: '#070a12',
          surface: 'rgba(15, 23, 42, 0.75)',
          card: 'rgba(11, 15, 25, 0.85)',
          hover: 'rgba(30, 41, 59, 0.6)',
          border: 'rgba(255, 255, 255, 0.08)',
          borderGlow: 'rgba(56, 189, 248, 0.25)',
          primary: '#38bdf8',
          primaryDark: '#0284c7',
          cta: '#06b6d4',
          accent: '#6366f1',
          emerald: '#10b981',
          amber: '#f59e0b',
          rose: '#f43f5e',
          text: '#f8fafc',
          secondary: '#94a3b8',
          muted: '#64748b',
        }
      },
      boxShadow: {
        'glass': '0 20px 50px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.08)',
        'glow': '0 0 35px rgba(56, 189, 248, 0.25)',
        'glow-emerald': '0 0 35px rgba(16, 185, 129, 0.25)',
        'card': '0 12px 30px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.05)',
      },
      backgroundImage: {
        'gradient-mesh': 'radial-gradient(circle at 10% 10%, rgba(56, 189, 248, 0.12), transparent 30%), radial-gradient(circle at 90% 90%, rgba(99, 102, 241, 0.12), transparent 35%), radial-gradient(circle at 50% 50%, rgba(16, 185, 129, 0.08), transparent 45%), linear-gradient(180deg, #070a12 0%, #0b0f19 100%)',
        'glass-gradient': 'linear-gradient(135deg, rgba(255, 255, 255, 0.07) 0%, rgba(255, 255, 255, 0.02) 100%)',
      }
    }
  }
}
