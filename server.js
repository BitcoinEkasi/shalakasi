From 2dceb05c240b6d5c5a78d4ed51b909abe5987ef8 Mon Sep 17 00:00:00 2001
From: Luthando Ndabambi <luthando@bitcoinekasi.com>
Date: Thu, 15 Oct 2026 13:26:48 +0200
Subject: [PATCH] Rename app to Stack & Study; fix trust proxy crash on startup

- Replace the visible app name (login page, admin panel, certificate
  text, dashboard text, README, content guide) with "Stack & Study".
  Internal identifiers (sessionStorage keys, repo name) are unchanged.
- server.js: move app.set('trust proxy', 1) to after the Express app is
  created. It was placed before `const app = express()`, which threw
  "Cannot access 'app' before initialization" and stopped the server
  from starting.

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ueb7G2enn5oottS7NhRu2v
---
 CONTENT_GUIDE.md  |  2 +-
 README.md         |  2 +-
 package.json      |  2 +-
 public/admin.html | 10 +++++-----
 public/app.js     |  4 ++--
 public/index.html |  4 ++--
 server.js         |  6 +++---
 7 files changed, 15 insertions(+), 15 deletions(-)

diff --git a/CONTENT_GUIDE.md b/CONTENT_GUIDE.md
index 5b64b69..22da2fb 100644
--- a/CONTENT_GUIDE.md
+++ b/CONTENT_GUIDE.md
@@ -1,4 +1,4 @@
-# Writing content for ShalaKasi — a guide for Sassa
+# Writing content for Stack & Study — a guide for Sassa
 
 Chapters 1-4 are done as a working example. This is the pattern to follow
 for Chapters 5-10. You don't need to touch any code — just fill in two
diff --git a/README.md b/README.md
index 70bbc89..ab44b3d 100644
--- a/README.md
+++ b/README.md
@@ -1,4 +1,4 @@
-# ShalaKasi
+# Stack & Study
 
 **My First Bitcoin Diploma — Powered by Bitcoin Ekasi**
 
diff --git a/package.json b/package.json
index db790b9..a1a2c51 100644
--- a/package.json
+++ b/package.json
@@ -1,7 +1,7 @@
 {
   "name": "shalakasi-backend",
   "version": "0.1.0",
-  "description": "ShalaKasi — adaptive Bitcoin Diploma platform backend",
+  "description": "Stack & Study — adaptive Bitcoin Diploma platform backend",
   "main": "server.js",
   "scripts": {
     "start": "node server.js",
diff --git a/public/admin.html b/public/admin.html
index c02d123..0afb91e 100644
--- a/public/admin.html
+++ b/public/admin.html
@@ -2,7 +2,7 @@
 <html lang="en">
 <head>
 <meta charset="UTF-8">
-<title>ShalaKasi — Admin</title>
+<title>Stack &amp; Study — Admin</title>
 <meta name="viewport" content="width=device-width, initial-scale=1.0">
 <link rel="preconnect" href="https://fonts.googleapis.com">
 <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
@@ -14,7 +14,7 @@
 <div class="gate-screen" id="gate-screen">
   <div class="gate-card">
     <div class="gate-logo">SK</div>
-    <h1>ShalaKasi Admin</h1>
+    <h1>Stack &amp; Study Admin</h1>
     <p class="sub">Bitcoin Ekasi &middot; Diploma admin dashboard</p>
     <div class="field">
       <label>Admin key</label>
@@ -29,7 +29,7 @@
   <div class="admin-topbar">
     <div class="brand">
       <div class="brand-logo">SK</div>
-      ShalaKasi <span class="sub">&nbsp;Admin</span>
+      Stack &amp; Study <span class="sub">&nbsp;Admin</span>
     </div>
     <div class="admin-tabs">
       <button class="admin-tab active" data-page="students">Students</button>
@@ -113,7 +113,7 @@
         <div class="stat-card"><div class="stat-value">—</div><div class="stat-label">Active students</div></div>
         <div class="stat-card"><div class="stat-value">—</div><div class="stat-label">Avg. curriculum completion</div></div>
         <div class="stat-card"><div class="stat-value">—</div><div class="stat-label">Checkpoint attempts logged</div></div>
-        <div class="stat-card"><div class="stat-value">—</div><div class="stat-label">Messages exchanged with ShalaKasi</div></div>
+        <div class="stat-card"><div class="stat-value">—</div><div class="stat-label">Messages exchanged with Stack &amp; Study</div></div>
       </div>
 
       <h3 class="summary-heading">Chapter completion funnel</h3>
@@ -148,7 +148,7 @@
   </div>
   <div class="detail-tabs">
     <div class="detail-tab active" data-tab="mastery">Mastery</div>
-    <div class="detail-tab" data-tab="decisions">ShalaKasi's decisions</div>
+    <div class="detail-tab" data-tab="decisions">Stack &amp; Study's decisions</div>
     <div class="detail-tab" data-tab="chat">Chat log</div>
     <div class="detail-tab" data-tab="enrolment">Enrolment</div>
   </div>
diff --git a/public/app.js b/public/app.js
index d92c238..22f60e6 100644
--- a/public/app.js
+++ b/public/app.js
@@ -210,7 +210,7 @@ function renderCertificate(chapters) {
         <div class="cert-top-bar"></div>
         <div class="cert-block-label">BLOCK — BITCOIN DIPLOMA GRADUATE</div>
         <div class="cert-name">${escapeHtmlDash(student.full_name)}</div>
-        <div class="cert-sub">has completed the ShalaKasi Bitcoin Diploma</div>
+        <div class="cert-sub">has completed the Stack &amp; Study Bitcoin Diploma</div>
 
         <div class="cert-stats">
           <div class="cert-stat"><div class="cert-stat-value">${chaptersPassed}/${totalChapters}</div><div class="cert-stat-label">Chapters mastered</div></div>
@@ -835,7 +835,7 @@ async function loadDashboard() {
 
   el.innerHTML = `
     <h1 class="dash-title">${student.full_name}'s progress</h1>
-    <p class="dash-sub">${masteredSections} of ${totalSections} sections mastered · ShalaKasi is building this path as you go, not following a fixed order.</p>
+    <p class="dash-sub">${masteredSections} of ${totalSections} sections mastered · Stack &amp; Study is building this path as you go, not following a fixed order.</p>
     <div class="sats-earned-card">
       <div class="sats-earned-icon">⚡</div>
       <div>
diff --git a/public/index.html b/public/index.html
index fb762c5..7a60f99 100644
--- a/public/index.html
+++ b/public/index.html
@@ -2,7 +2,7 @@
 <html lang="en">
 <head>
 <meta charset="UTF-8">
-<title>ShalaKasi</title>
+<title>Stack &amp; Study</title>
 <meta name="viewport" content="width=device-width, initial-scale=1.0">
 <link rel="preconnect" href="https://fonts.googleapis.com">
 <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
@@ -14,7 +14,7 @@
 <div class="login-screen" id="login-screen">
   <div class="login-card">
     <img class="ekasi-logo" src="/assets/bitcoin-ekasi-logo.png" alt="Bitcoin Ekasi">
-    <h1>ShalaKasi</h1>
+    <h1>Stack &amp; Study</h1>
     <p class="sub">My First Bitcoin Diploma — Powered by Bitcoin Ekasi</p>
     <div class="field">
       <label>Username</label>
diff --git a/server.js b/server.js
index 04e58f3..bd8cad7 100644
--- a/server.js
+++ b/server.js
@@ -1,8 +1,7 @@
-// server.js — ShalaKasi backend
+// server.js — Stack & Study backend
 require('dotenv').config();
 
 const express = require('express');
-app.set('trust proxy', 1);
 const cors = require('cors');
 const helmet = require('helmet');
 const rateLimit = require('express-rate-limit');
@@ -14,6 +13,7 @@ const supabase = require('./services/supabase');
 const { decideNextStep } = require('./services/aiEngine');
 
 const app = express();
+app.set('trust proxy', 1);
 app.use(helmet({ contentSecurityPolicy: false }));
 app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
 app.use(express.json());
@@ -659,4 +659,4 @@ app.get('/api/admin/impact', requireAdmin, async (req, res) => {
 });
 
 const PORT = process.env.PORT || 3300;
-app.listen(PORT, () => console.log(`ShalaKasi running on http://localhost:${PORT}`));
+app.listen(PORT, () => console.log(`Stack & Study running on http://localhost:${PORT}`));
-- 
2.43.0
