/**
 * Firestore collection names for the Leyeco III Requisition System
 * Based on FM-PUR-05 Requisition Form structure
 */
export const COLLECTIONS = {
  REQUISITIONS: 'requisitions',
  USERS: 'users',
  ITEMS: 'items',
  DEPARTMENTS: 'departments',
  INTERNAL_AUDIT_LOG: 'internal_audit_log',
  TRANSACTION_LOG: 'transaction_log',
  /** One doc per requisition signature step (prevents 1MB requisition doc issues). */
  REQUISITION_SIGNATURES: 'requisition_signatures',
  /** Pre-computed analytics summary document (analytics/summary). */
  ANALYTICS: 'analytics',
  /** System settings like registration toggle, banners, etc. */
  SYSTEM_CONFIG: 'system_config',
}

/**
 * Requisition workflow statuses (sequential approval flow)
 */
export const REQUISITION_STATUS = {
  DRAFT: 'draft',
  PENDING_RECOMMENDATION: 'pending_recommendation', // Section/Div/Dept Head
  PENDING_INVENTORY: 'pending_inventory', // Warehouse Section Head
  PENDING_BUDGET: 'pending_budget', // Acctg Div Supervisor
  PENDING_AUDIT: 'pending_audit', // Internal Auditor
  PENDING_APPROVAL: 'pending_approval', // General Manager
  APPROVED: 'approved',
  REJECTED: 'rejected',
}

/**
 * User roles matching the approval workflow
 */
export const USER_ROLES = {
  REQUESTER: 'requester',
  SECTION_HEAD: 'section_head', // Section Head
  DIVISION_HEAD: 'division_head', // Manager
  DEPARTMENT_HEAD: 'department_head', // Supervisor
  WAREHOUSE_HEAD: 'warehouse_head', // Inventory Checked
  BUDGET_OFFICER: 'budget_officer', // Budget Approved
  INTERNAL_AUDITOR: 'internal_auditor', // Checked by
  GENERAL_MANAGER: 'general_manager', // Approved By
  SUPER_ADMIN: 'super_admin', // Full system control
}

/**
 * User role labels for display
 */
export const USER_ROLE_LABELS = {
  [USER_ROLES.REQUESTER]: 'Requestor',
  [USER_ROLES.SECTION_HEAD]: 'Section Head',
  [USER_ROLES.DIVISION_HEAD]: 'Manager',
  [USER_ROLES.DEPARTMENT_HEAD]: 'Supervisor',
  [USER_ROLES.WAREHOUSE_HEAD]: 'Warehouse Section Head',
  [USER_ROLES.BUDGET_OFFICER]: 'Acctg. Div. Supervisor / Budget Officer',
  [USER_ROLES.INTERNAL_AUDITOR]: 'Internal Auditor',
  [USER_ROLES.GENERAL_MANAGER]: 'General Manager',
  [USER_ROLES.SUPER_ADMIN]: 'Super Administrator',
}
