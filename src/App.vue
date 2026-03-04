<script setup></script>

<template>
  <router-view />
</template>

<style>
* {
  box-sizing: border-box;
}
body {
  margin: 0;
  font-family:
    'Segoe UI',
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    'Helvetica Neue',
    sans-serif;
  font-size: 15px;
  line-height: 1.5;
  color: #0f172a;
  background: #f1f5f9;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
#app {
  min-height: 100vh;
}
</style>
