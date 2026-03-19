<script setup>
import { computed } from 'vue'

const props = defineProps({
  currentPage: { type: Number, required: true },
  totalPages: { type: Number, required: true },
  pageSize: { type: Number, default: 50 },
  totalItems: { type: Number, default: 0 },
  loading: { type: Boolean, default: false },
  hasMore: { type: Boolean, default: false },
})

const emit = defineEmits(['page-change'])

const pages = computed(() => {
  const current = props.currentPage
  const total = props.totalPages
  
  if (total <= 1) return [1]

  // If 7 or fewer pages, just show all of them
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1)
  }

  const range = []
  const delta = 2

  range.push(1)

  if (current - delta > 2) {
    range.push('...')
  }

  for (let i = Math.max(2, current - delta); i <= Math.min(total - 1, current + delta); i++) {
    range.push(i)
  }

  if (current + delta < total - 1) {
    range.push('....') // Use a different string for second dots to ensure unique keys
  }

  range.push(total)
  return range
})

function changePage(p) {
  if (typeof p === 'string' && p.includes('.')) return
  if (p === props.currentPage || props.loading) return
  emit('page-change', p)
}
</script>

<template>
  <div class="pagination-container jinja">
    <div class="pagination-info">
      Showing
      <span class="font-bold text-slate-900">{{
        totalItems === 0 ? 0 : Math.min((currentPage - 1) * pageSize + 1, totalItems)
      }}</span>
      to
      <span class="font-bold text-slate-900">{{
        Math.min(currentPage * pageSize, totalItems)
      }}</span>
      <template v-if="!hasMore">
        of <span class="font-bold text-slate-900">{{ totalItems }}</span> entries
      </template>
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
        v-for="(page, idx) in pages"
        :key="typeof page === 'number' ? page : `dots-${idx}`"
        class="page-btn"
        :class="{ active: page === currentPage, dots: typeof page === 'string' && page.includes('.') }"
        :disabled="(typeof page === 'string' && page.includes('.')) || loading"
        @click="changePage(page)"
      >
        {{ typeof page === 'string' && page.includes('.') ? '...' : page }}
      </button>

      <button
        class="page-btn next"
        :disabled="(currentPage === totalPages && !hasMore) || loading"
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
  padding: 0.5rem 1rem;
  background: white;
  border-top: 1px solid #f1f5f9;
  border-bottom-left-radius: 12px;
  border-bottom-right-radius: 12px;
}

.pagination-info {
  font-size: 0.75rem;
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
  gap: 0.25rem;
  align-items: center;
}

.page-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 28px;
  height: 28px;
  padding: 0 0.25rem;
  font-size: 0.75rem;
  font-weight: 700;
  color: #64748b;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
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
    gap: 0.75rem;
    padding: 1rem;
    text-align: center;
  }
}
</style>
