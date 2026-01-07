import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.lovable.324c9bcf3cd74f77b2464813ea4d888b',
  appName: 'adscore-keeper',
  webDir: 'dist',
  server: {
    url: "https://adscore-keeper.lovable.app",
    cleartext: true
  }
};

export default config;