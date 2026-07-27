import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// base './' keeps built assets relative so the bundle works both on a
// GitHub Pages project subpath and under `vite preview` locally.
export default defineConfig({
  base: './',
  plugins: [react()],
})
