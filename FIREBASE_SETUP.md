# Firebase Setup Guide — Leyeco III Requisition System

This guide walks you through setting up Firebase for the requisition system based on the Leyeco III Electric Cooperative requisition form (FM-PUR-05).

---

## 1. Create a Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com/).
2. Click **Add project** (or select an existing project).
3. Name it (e.g. `leyeco-requisition`) and follow the setup steps.
4. Enable **Google Analytics** if you want (optional).

---

## 2. Enable Firestore Database

1. In Firebase Console, go to **Build → Firestore Database**.
2. Click **Create database**.
3. Choose **Start in test mode** for development (or production with rules).
4. Pick a Firestore location (e.g. `asia-southeast1` for Philippines).

---

## 3. Enable Authentication

1. Go to **Build → Authentication**.
2. Click **Get started**.
3. Enable **Email/Password** (or **Google**, **Microsoft**, etc.).
4. Optional: Add authorized domains for your app (e.g. `localhost` for dev).

---

## 4. Register Your Web App

1. In Project overview, click the **Web** icon (`</>`).
2. Register an app nickname (e.g. `requisition-web`).
3. Copy the `firebaseConfig` object values.
4. Create a `.env` file in the project root (copy from `.env.example`):

```env
VITE_FIREBASE_API_KEY=your-api-key
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=123456789
VITE_FIREBASE_APP_ID=1:123456789:web:abc123
```

---

## 5. Deploy Firestore Security Rules

1. Install Firebase CLI (if needed): `npm install -g firebase-tools`
2. Log in: `firebase login`
3. Initialize in the project: `firebase init firestore` (select existing `firestore.rules`)
4. Deploy rules: `firebase deploy --only firestore`

---

## 6. Install Dependencies and Run

```sh
npm install
npm run dev
```

---

## Data Model Overview

### `requisitions` Collection

| Field | Type | Description |
|-------|------|-------------|
| `rfControlNo` | string | Requisition form control number (e.g. 163623) |
| `date` | string | Date (YYYY-MM-DD) |
| `department` | string | Requesting department |
| `purpose` | string | Purpose of request |
| `status` | string | Workflow status |
| `items` | array | List of requested items |
| `requestedBy` | object | `{ userId, name, signedAt }` |
| `recommendingApproval` | object | Section/Div/Dept Head |
| `inventoryChecked` | object | Warehouse Section Head |
| `budgetApproved` | object | Acctg Div Supervisor |
| `checkedBy` | object | Internal Auditor |
| `approvedBy` | object | General Manager |

### Requisition Item (within `items` array)

| Field | Type | Description |
|-------|------|-------------|
| `quantity` | number | QTY |
| `unit` | string | e.g. pcs, dz. |
| `description` | string | Description/Specifications |
| `warehouseInventory` | number | Stock on hand |
| `balanceForPurchase` | number | Qty to purchase |
| `remarks` | string | Notes |

### Workflow Status Values

- `draft` → `pending_recommendation` → `pending_inventory` → `pending_budget` → `pending_audit` → `pending_approval` → `approved` / `rejected`

---

## Next Steps

- Add UI components for creating and viewing requisitions.
- Implement role-based access and approval workflow.
- Add real-time listeners with `onSnapshot` for live updates.
- Optional: Firebase Cloud Functions for RF Control No generation and notifications.
