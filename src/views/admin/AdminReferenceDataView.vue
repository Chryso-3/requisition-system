<script setup>
import { ref, onMounted } from 'vue'
import { ShieldAlert } from 'lucide-vue-next'

const loading = ref(false)
const isUnderDevelopment = ref(true)

onMounted(() => {
  // Functionality is hidden, so no reactive state or lifecycle hooks are needed here.
})
</script>

<template>
  <div class="admin-page">
    <div class="dev-feature-overlay animate-fade-in">
      <div class="dev-card glass-container">
        <div class="icon-orb">
          <ShieldAlert :size="48" class="text-amber-500" />
        </div>
        <h1 class="title">Module Under Development</h1>
        <p class="description">
          The Reference Data module (Departments & Suppliers) is currently being refined for future
          deployment. This section will soon allow centralized management of your master lists.
        </p>
        <div class="divider"></div>
        <p class="footer">STAY TUNED • LEYECO III</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.admin-page {
  padding: 0;
  height: calc(100vh - 64px); /* Nav height offset */
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
}

.dev-feature-overlay {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  padding: 2rem;
}

.dev-card {
  max-width: 500px;
  width: 100%;
  background: rgba(255, 255, 255, 0.4);
  backdrop-filter: blur(25px) saturate(180%);
  -webkit-backdrop-filter: blur(25px) saturate(180%);
  border-radius: 2rem;
  padding: 3.5rem;
  text-align: center;
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.4);
}

.icon-orb {
  width: 80px;
  height: 80px;
  background: rgba(245, 158, 11, 0.1);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 2rem;
  border: 1px solid rgba(245, 158, 11, 0.2);
}

.title {
  font-size: 2rem;
  font-weight: 800;
  letter-spacing: -0.02em;
  margin-bottom: 1rem;
  color: #1e293b;
}

.description {
  font-size: 1rem;
  line-height: 1.6;
  color: #64748b;
  margin-bottom: 2rem;
}

.divider {
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(0, 0, 0, 0.05), transparent);
  margin-bottom: 1.5rem;
}

.footer {
  font-size: 0.8125rem;
  font-weight: 700;
  color: #94a3b8;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.animate-fade-in {
  animation: fadeIn 0.6s ease-out forwards;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
