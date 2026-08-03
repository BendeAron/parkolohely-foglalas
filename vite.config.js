import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    proxy: {
      // Proxy PHP API endpoints to the backend container to avoid CORS
      '/get_spots.php': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/create_reservation.php': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})