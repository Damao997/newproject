<script setup lang="ts">
import { useAuthStore } from '@/store/modules/auth';

defineOptions({
  name: 'UserAvatar'
});

const authStore = useAuthStore();

function backToLegacy() {
  window.location.assign('/dashboard');
}
</script>

<template>
  <div class="flex items-center gap-12px">
    <div class="flex items-center gap-6px text-14px">
      <SvgIcon icon="ph:user-circle" class="text-icon-large" />
      <span class="font-medium">{{ authStore.userInfo.userName || '当前账号' }}</span>
    </div>
    <NButton size="small" secondary @click="backToLegacy">返回旧版</NButton>
  </div>
</template>

<style scoped></style>
