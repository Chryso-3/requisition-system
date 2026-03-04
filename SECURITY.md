# Security Improvement Plan

This document outlines the best plan to improve security for the Leyeco III Requisition System (Firebase + Vue).

---

## Current State

- **Auth**: Firebase Auth (email/password). User role stored in Firestore `users/{uid}`.
- **Firestore rules**: Previously any authenticated user could read/write all requisitions. Rules have been tightened to be role-based where possible.
- **Secrets**: Firebase config via `VITE_*` env vars; `.env` is gitignored. API key is in the frontend (normal for Firebase).
- **Router**: Protects routes by authentication only; some role-based redirects for home.
- **Registration**: Public (anyone can sign up). Consider restricting in production.

---

## Recommended Improvements (Priority Order)

### 1. Firestore rules (done in this repo)

- **Requisitions**: 
  - **Read**: Requesters see only their own requisitions or approved ones; approvers/purchasers see all. Implemented using `get(/databases/$(database)/documents/users/$(request.auth.uid))` to read role.
  - **Create**: Any authenticated user (requesters create drafts).
  - **Update**: Any authenticated user (workflow enforcement is still partly client-side; for strict server-side approval checks, use Cloud Functions).
- **Users**: Read/write only own document (`request.auth.uid == userId`).
- **Transaction log**: Create when authenticated; read for authenticated (optionally restrict to non-requester roles later).
- **Departments / Items**: Read when authenticated; write restricted to non-requester roles (or lock down to admin-only when you have an admin role).

### 2. Firebase Console (you do this)

- **API key restriction**: In [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials → your Web API key → Application restrictions → set **HTTP referrers** to your production and dev origins (e.g. `https://your-project.web.app/*`, `http://localhost:*`).
- **App Check**: Enable [Firebase App Check](https://firebase.google.com/docs/app-check) (reCAPTCHA v3 or reCAPTCHA Enterprise) for your web app. This reduces abuse from scripts/bots using your project.
- **Authentication**: Under Authentication → Settings → Authorized domains, keep only your real domains. Consider disabling **Email/Password** sign-up in production and creating users via Admin SDK or a restricted registration flow.

### 3. Registration control (optional)

- **Option A**: Turn off public sign-up: Firebase Console → Authentication → Sign-in method → disable Email/Password “Register” (users created only by admin or Cloud Function).
- **Option B**: Keep sign-up but default role to `requester` and have an “admin” user change roles in Firestore or via a small admin tool.
- **Option C**: Use a Cloud Function that creates users only when invited (e.g. invite token or allowed-email list).

### 4. Role-based route guard (done in this repo)

- Router checks `meta.roles` and redirects or forbids access so that e.g. requesters cannot open approver-only pages by URL. Nav already hides links by role; guard ensures direct URL access is also blocked.

### 5. Custom claims (advanced, highest security)

- Store **role in Firebase Auth custom claims** (set via Admin SDK or Cloud Function) instead of only in Firestore. Rules can then use `request.auth.token.role` without a `get()` call, and clients cannot change their own role.
- Flow: On first login or when an admin assigns a role, a Cloud Function or backend sets `admin.auth().setCustomUserClaims(uid, { role: 'section_head' })`. Then in rules: `request.auth.token.role == 'section_head'`.
- Requires a small backend (Cloud Functions) or admin script.

### 6. Sensitive operations via Cloud Functions (optional)

- For approve/decline, you can use **callable Cloud Functions** that:
  - Verify the caller’s role (custom claim or Firestore).
  - Validate requisition status and workflow step.
  - Update Firestore with server timestamps and write to transaction log.
- This adds defense-in-depth; strict Firestore rules can still enforce who can write what.

### 7. General hygiene

- Keep `.env` and `.env.local` out of git (already in `.gitignore`).
- Do not commit Firebase service account keys; use them only in CI or secure server environments.
- Use HTTPS only in production (Firebase Hosting does this).
- Prefer short-lived sessions; Firebase Auth handles token refresh.

---

## Checklist

| Item | Where | Status |
|------|--------|--------|
| Firestore rules: role-based read for requisitions | `firestore.rules` | Done |
| Firestore rules: users read/write own only | `firestore.rules` | Done |
| Firestore rules: departments/items write restricted | `firestore.rules` | Done |
| Role-based route guard | `src/router/index.js` | Done |
| API key restricted to your domains | Google Cloud Console | Your action |
| App Check enabled | Firebase Console | Your action |
| Restrict or disable public registration | Firebase Console / backend | Your action |
| Custom claims for role | Cloud Functions / Admin SDK | Optional |
| Approve/decline via Cloud Function | Cloud Functions | Optional |

After changing Firestore rules, deploy with:

```bash
npm run deploy:rules
```
