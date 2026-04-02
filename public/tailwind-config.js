tailwind.config = {
    darkMode: 'class', // Keeping class for potential future toggles, but defaulting to light
    theme: {
        extend: {
            fontFamily: {
                sans: ['Manrope', 'sans-serif'],
                display: ['Space Grotesk', 'sans-serif'],
                mono: ['JetBrains Mono', 'monospace'],
            },
            colors: {
                brand: {
                    base: '#f5f1e8',
                    card: '#fffdf9',
                    hover: '#efe5d8',
                    cta: '#ef7d57',
                    primary: '#145b73',
                    text: '#10212b',
                    secondary: '#51616b',
                    muted: '#8a989d',
                    border: '#d8d0c3',
                }
            },
            boxShadow: {
                'glass': '0 18px 45px rgba(16, 33, 43, 0.08)',
                'glow': '0 18px 40px rgba(20, 91, 115, 0.18)',
                'card': '0 12px 30px rgba(16, 33, 43, 0.08)',
            },
            backgroundImage: {
                'gradient-mesh': 'radial-gradient(circle at top left, rgba(20,91,115,0.18), transparent 35%), radial-gradient(circle at top right, rgba(239,125,87,0.16), transparent 32%), linear-gradient(180deg, #f8f4ec 0%, #f2ece1 100%)'
            }
        }
    }
}
