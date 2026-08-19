tailwind.config = {
    darkMode: 'class',
    theme: {
        extend: {
            fontFamily: {
                sans: ['Work Sans', 'Manrope', 'sans-serif'],
                display: ['Outfit', 'Space Grotesk', 'sans-serif'],
                mono: ['JetBrains Mono', 'monospace'],
            },
            colors: {
                brand: {
                    base: '#f8fafc',
                    card: '#ffffff',
                    hover: '#f1f5f9',
                    cta: '#C8102E',
                    primary: '#012169',
                    darkblue: '#000c2b',
                    red: '#C8102E',
                    text: '#0f172a',
                    secondary: '#475569',
                    muted: '#64748b',
                    border: '#e2e8f0',
                }
            },
            boxShadow: {
                'glass': '0 20px 40px rgba(1, 33, 105, 0.08)',
                'glow': '0 10px 25px rgba(200, 16, 46, 0.25)',
                'card': '0 10px 30px rgba(1, 33, 105, 0.06)',
            },
            backgroundImage: {
                'gradient-mesh': 'radial-gradient(circle at 10% 10%, rgba(1, 33, 105, 0.08), transparent 30%), radial-gradient(circle at 90% 90%, rgba(200, 16, 46, 0.06), transparent 35%), linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%)',
                'uk-gradient': 'linear-gradient(135deg, #012169 0%, #000c2b 100%)',
            }
        }
    }
}
