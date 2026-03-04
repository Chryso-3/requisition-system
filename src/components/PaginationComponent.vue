<script setup>
import { computed } from 'vue'

const props = defineProps({
  currentPage: { type: Number, required: true },
  totalPages: { type: Number, required: true },
  pageSize: { type: Number, default: 50 },
  totalItems: { type: Number, default: 0 },
  loading: { type: Boolean, default: false },
})

const emit = defineEmits(['page-change'])

const pages = computed(() => {
  const range = []
  const delta = 2
  const left = props.currentPage - delta
  const right = props.currentPage + delta + 1

  for (let i = 1; i <= props.totalPages; i++) {
    if (i === 1 || i === props.totalPages || (i >= left && i < right)) {
      range.push(i)
    } else if (range[range.length - 1] !== '...') {
      range.push('...')
    }
  }
  return range
})

function changePage(p) {
  if (p === '...' || p === props.currentPage || props.loading) return
  emit('page-change', p)
}
</script>

<template>
  <div class="pagination-container jinja">
    <div class="pagination-info">
      Showing
      <span class="font-bold text-slate-900">{{
        Math.min((currentPage - 1) * pageSize + 1, totalItems)
      }}</span>
      to
      <span class="font-bold text-slate-900">{{
        Math.min(currentPage * pageSize, totalItems)
      }}</span>
      of <span class="font-bold text-slate-900">{{ totalItems }}</span> entries
    </div>

    <div class="pagination-controls">
      <button
        class="page-btn prev"
        :disabled="currentPage === 1 || loading"
        @click="changePage(currentPage - 1)"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="m15 18-6-6 6-6" />
        </svg>
      </button>

      <button
        v-for="page in pages"
        :key="page === '...' ? Math.random() : page"
        class="page-btn"
        :class="{ active: page === currentPage, dots: page === '...' }"
        :disabled="page === '...' || loading"
        @click="changePage(page)"
      >
        {{ page }}
      </button>

      <button
        class="page-btn next"
        :disabled="currentPage === totalPages || loading"
        @click="changePage(currentPage + 1)"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="m9 18 6-6-6-6" />
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.pagination-container {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.5rem;
  background: white;
  border-top: 1px solid #f1f5f9;
  border-bottom-left-radius: 12px;
  border-bottom-right-radius: 12px;
}

.pagination-info {
  font-size: 0.8125rem;
  color: #64748b;
  font-weight: 500;
}

.pagination-info span {
  color: #1e293b;
  font-weight: 700;
  margin: 0 0.125rem;
}

.pagination-controls {
  display: flex;
  gap: 0.35rem;
  align-items: center;
}

.page-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 32px;
  height: 32px;
  padding: 0 0.5rem;
  font-size: 0.8125rem;
  font-weight: 700;
  color: #64748b;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  user-select: none;
}

.page-btn:hover:not(:disabled):not(.dots) {
  border-color: #0ea5e9;
  color: #0ea5e9;
  background: #f0f9ff;
  transform: translateY(-1px);
}

.page-btn:active:not(:disabled):not(.dots) {
  transform: translateY(0) scale(0.95);
}

.page-btn.active {
  background: #0ea5e9;
  border-color: #0ea5e9;
  color: white;
  box-shadow: 0 4px 10px rgba(14, 165, 233, 0.3);
}

.page-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.page-btn.dots {
  border-color: transparent;
  cursor: default;
  color: #94a3b8;
}

@media (max-width: 640px) {
  .pagination-container {
    flex-direction: column;
    gap: 1rem;
    padding: 1.5rem;
    text-align: center;
  }
}
</style>
