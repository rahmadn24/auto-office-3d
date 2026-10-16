import type { Config } from 'tailwindcss';

/**
 * Design token — sumber: brief/autonomous_command_hud/DESIGN.md
 * (palette Material 3 + aksen divisi dari PRD §4.1).
 */
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: '#051424',
        surface: '#051424',
        'surface-dim': '#051424',
        'surface-bright': '#2c3a4c',
        'surface-container-lowest': '#010f1f',
        'surface-container-low': '#0d1c2d',
        'surface-container': '#122131',
        'surface-container-high': '#1c2b3c',
        'surface-container-highest': '#273647',
        'on-surface': '#d4e4fa',
        'on-surface-variant': '#c7c4d7',
        outline: '#908fa0',
        'outline-variant': '#464554',
        primary: '#c0c1ff',
        'on-primary': '#1000a9',
        'primary-container': '#8083ff',
        'on-primary-container': '#0d0096',
        secondary: '#4edea3',
        'on-secondary': '#003824',
        'secondary-container': '#00a572',
        tertiary: '#ffb95f',
        'on-tertiary': '#472a00',
        error: '#ffb4ab',
        'on-error': '#690005',
        // Aksen divisi (PRD §4.1) untuk dipakai juga oleh objek 3D
        'zone-founder': '#6366f1',
        'zone-meeting': '#f59e0b',
        'zone-devlab': '#10b981',
        'zone-marketing': '#ec4899',
        'zone-devops': '#06b6d4',
        'zone-hub': '#38bdf8',
        'canvas-base': '#0c0f17',
      },
      fontFamily: {
        headline: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
        body: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        'label-xs': ['10px', { lineHeight: '14px', letterSpacing: '0.08em', fontWeight: '600' }],
        'mono-label': ['11px', { lineHeight: '16px', letterSpacing: '0.06em', fontWeight: '500' }],
        'body-sm': ['12px', { lineHeight: '18px', fontWeight: '400' }],
        'headline-md': ['20px', { lineHeight: '28px', fontWeight: '600' }],
      },
    },
  },
  plugins: [],
};

export default config;
