<script setup lang="ts">
import { onMounted } from 'vue';

function goToLegacyLogin() {
  const params = new URLSearchParams(window.location.search);
  const redirect = params.get('redirect') || '/next/home';
  window.location.replace(`/login?redirect=${encodeURIComponent(redirect)}`);
}

onMounted(goToLegacyLogin);
</script>

<template>
  <div class="size-full flex-center bg-layout">
    <NCard :bordered="false" class="w-400px lt-sm:w-300px">
      <NSpace vertical :size="16">
        <h2 class="text-20px font-medium">正在前往登录</h2>
        <p class="text-14px text-gray-500">新版工作台复用旧版账号与会话，正在跳转登录页。</p>
        <NButton type="primary" block @click="goToLegacyLogin">继续登录</NButton>
      </NSpace>
    </NCard>
  </div>
</template>
