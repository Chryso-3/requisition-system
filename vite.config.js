import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

export default defineConfig({
  plugins: [
    vue(),
    vueDevTools(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    },
  },
  server: {
    host: true,
    port: 5173
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-vue': ['vue', 'vue-router', 'pinia'],
          'vendor-firebase': ['firebase/app', 'firebase/firestore', 'firebase/auth', 'firebase/storage'],
          'admin-views': [
            './src/views/admin/AdminUsersView.vue',
            './src/views/admin/AdminReferenceDataView.vue',
            './src/views/admin/AdminSystemSettingsView.vue'
          ],
          'procurement-views': [
            './src/views/ProcurementHubView.vue',
            './src/views/PurchaseListView.vue',
            './src/views/CanvassListView.vue'
          ]
        }
      }
    }
  }
})
