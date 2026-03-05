<script setup>
import { computed } from 'vue'
import { CheckCircle2, XCircle, AlertCircle, X } from 'lucide-vue-next'

const props = defineProps({
  show: {
    type: Boolean,
    default: false,
  },
  status: {
    type: String,
    default: 'success', // 'success', 'error', 'warning'
  },
  title: {
    type: String,
    default: '',
  },
  message: {
    type: String,
    default: '',
  },
})

const emit = defineEmits(['close'])

const statusConfig = computed(() => {
  switch (props.status) {
    case 'error':
      return {
        icon: XCircle,
        class: 'status-error',
        color: '#ef4444',
      }
    case 'warning':
      return {
        icon: AlertCircle,
        class: 'status-warning',
        color: '#f59e0b',
      }
    case 'success':
    default:
      return {
        icon: CheckCircle2,
        class: 'status-success',
        color: '#10b981',
      }
  }
})

function close() {
  emit('close')
}
</script>

<template>
  <Transition name="modal-fade">
    <div v-if="show" class="modal-overlay" @click.self="close">
      <div class="modal-container glass-card" :class="statusConfig.class">
        <button class="close-btn" @click="close">
          <X :size="20" />
        </button>

        <div class="modal-content">
          <div class="icon-orb">
            <component :is="statusConfig.icon" :size="48" :color="statusConfig.color" />
          </div>

          <h3 class="modal-title">
            {{
              title || (status === 'success' ? 'Success' : status === 'error' ? 'Error' : 'Warning')
            }}
          </h3>
          <p class="modal-message">{{ message }}</p>

          <button class="action-btn" @click="close">OK</button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.4);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}

.modal-container {
  width: 90%;
  max-width: 400px;
  background: rgba(255, 255, 255, 0.8);
  backdrop-filter: blur(20px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.5);
  border-radius: 24px;
  padding: 2.5rem 2rem;
  position: relative;
  box-shadow:
    0 25px 50px -12px rgba(0, 0, 0, 0.25),
    inset 0 1px 0 0 rgba(255, 255, 255, 0.5);
  text-align: center;
}

.close-btn {
  position: absolute;
  top: 1.25rem;
  right: 1.25rem;
  background: none;
  border: none;
  color: #64748b;
  cursor: pointer;
  padding: 0.5rem;
  border-radius: 50%;
  transition: all 0.2s;
}

.close-btn:hover {
  background: rgba(0, 0, 0, 0.05);
  color: #0f172a;
}

.icon-orb {
  width: 80px;
  height: 80px;
  background: white;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 1.5rem;
  box-shadow: 0 10px 20px rgba(0, 0, 0, 0.05);
}

.modal-title {
  font-family: 'Sora', sans-serif;
  font-size: 1.5rem;
  font-weight: 700;
  color: #0f172a;
  margin: 0 0 0.75rem;
}

.modal-message {
  font-size: 1rem;
  color: #475569;
  line-height: 1.6;
  margin-bottom: 2rem;
}

.action-btn {
  width: 100%;
  padding: 0.875rem;
  border-radius: 12px;
  border: none;
  background: #0f172a;
  color: white;
  font-weight: 700;
  font-size: 1rem;
  cursor: pointer;
  transition: all 0.2s;
}

.action-btn:hover {
  background: #1e293b;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.action-btn:active {
  transform: translateY(0);
}

/* Status variants */
.status-success .icon-orb {
  background: rgba(16, 185, 129, 0.1);
}
.status-error .icon-orb {
  background: rgba(239, 68, 68, 0.1);
}
.status-warning .icon-orb {
  background: rgba(245, 158, 11, 0.1);
}

/* Transitions */
.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}

.modal-fade-enter-active .modal-container {
  animation: modal-pop 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.modal-fade-leave-active .modal-container {
  transition: all 0.2s ease;
  transform: scale(0.95);
  opacity: 0;
}

@keyframes modal-pop {
  from {
    opacity: 0;
    transform: scale(0.9) translateY(20px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}
</style>
