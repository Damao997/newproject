<script lang="ts" setup>
import { computed } from 'vue';
import { $t } from '@/locales';
import { useRouterPush } from '@/hooks/common/router';

defineOptions({ name: 'ExceptionBase' });

type ExceptionType = '403' | '404' | '500';

interface Props {
  /**
   * Exception type
   *
   * - 403: no permission
   * - 404: not found
   * - 500: service error
   */
  type: ExceptionType;
}

const props = defineProps<Props>();

const { routerPushByKey } = useRouterPush();

const iconMap: Record<ExceptionType, string> = {
  '403': 'no-permission',
  '404': 'not-found',
  '500': 'service-error'
};

const icon = computed(() => iconMap[props.type]);

function backToLegacy() {
  window.location.assign('/dashboard');
}
</script>

<template>
  <div class="size-full min-h-520px flex-col-center gap-16px overflow-hidden px-24px text-center">
    <div class="flex text-240px text-primary lt-sm:text-180px">
      <SvgIcon :local-icon="icon" />
    </div>
    <h1 class="text-28px font-500">{{ type }} · {{ $t(`route.${type}`) }}</h1>
    <p v-if="type === '403'" class="max-w-520px text-14px text-gray-500">
      当前账号没有新版工作台的访问权限。旧版仍可继续使用，且不会因此放宽原权限。
    </p>
    <div class="flex flex-wrap justify-center gap-12px">
      <NButton secondary @click="backToLegacy">返回旧版</NButton>
      <NButton type="primary" @click="routerPushByKey('root')">{{ $t('common.backToHome') }}</NButton>
    </div>
  </div>
</template>

<style scoped></style>
