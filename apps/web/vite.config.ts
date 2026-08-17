import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// No index.html/entry point yet — routing and pages start Phase 9/10. This
// config exists so the real build toolchain is in place from the moment
// components do (DayBoard, Phase 8), not bolted on later.
export default defineConfig({
  plugins: [react()],
});
