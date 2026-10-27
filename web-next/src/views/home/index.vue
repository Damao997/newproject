<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import type { DataTableColumns } from 'naive-ui';
import { useAuthStore } from '@/store/modules/auth';
import {
  fetchKeyMetrics,
  fetchProductCategories,
  updateProductCategory,
  type KeyMetricsResponse,
  type KeyMetricsRow,
  type ProductCategory
} from '@/service/api/workbench';

defineOptions({
  name: 'WorkbenchHome'
});

const authStore = useAuthStore();

const tab = ref<'analysis' | 'mapping'>('analysis');
const period = ref('');
const companyCode = ref('');
const loading = ref(false);
const error = ref('');
const metrics = ref<KeyMetricsResponse | null>(null);

const categories = ref<ProductCategory[]>([]);
const categoryLoading = ref(false);
const categoryError = ref('');
const categoriesLoaded = ref(false);
const editing = ref(false);
const saving = ref(false);
const editError = ref('');
const editForm = reactive({
  id: '',
  code: '',
  name: '',
  subjectKeyword: '',
  subjectCodes: '',
  sortOrder: 0,
  status: 'active' as 'active' | 'inactive'
});

const canMap = computed(() => authStore.userInfo.buttons.includes('data:browse:view'));

const rows = computed(() => metrics.value?.rows ?? []);

const amount = (value: number | null | undefined) => {
  if (value === null || value === undefined) return '—';
  return value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const percent = (value: number | null | undefined) => {
  if (value === null || value === undefined) return '—';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
};

const columns: DataTableColumns<KeyMetricsRow> = [
  { title: '分类', key: 'category', width: 96, fixed: 'left' },
  { title: '指标', key: 'label', width: 190, fixed: 'left' },
  {
    title: '本月实际 / 万元',
    key: 'monthActual',
    align: 'right',
    width: 140,
    render: row => amount(row.values.monthActual)
  },
  {
    title: '月度同比',
    key: 'monthYoy',
    align: 'right',
    width: 108,
    render: row => percent(row.values.monthYoy)
  },
  {
    title: '财年累计 / 万元',
    key: 'ytdActual',
    align: 'right',
    width: 140,
    render: row => amount(row.values.ytdActual)
  },
  {
    title: '累计同比',
    key: 'ytdYoy',
    align: 'right',
    width: 108,
    render: row => percent(row.values.ytdYoy)
  },
  {
    title: '年度预算 / 万元',
    key: 'annualBudget',
    align: 'right',
    width: 140,
    render: row => amount(row.values.annualBudget)
  }
];

const categoryColumns: DataTableColumns<ProductCategory> = [
  { title: '品类名称', key: 'name', minWidth: 150 },
  { title: '编码', key: 'code', width: 140 },
  { title: '匹配关键词', key: 'subjectKeyword', minWidth: 140 },
  {
    title: '显式科目',
    key: 'subjectCodes',
    minWidth: 150,
    render: row => (row.subjectCodes.length ? row.subjectCodes.join('、') : '—')
  },
  {
    title: '状态',
    key: 'status',
    width: 90,
    render: row => (row.status === 'active' ? '启用' : '停用')
  }
];

async function loadMetrics() {
  loading.value = true;
  error.value = '';

  try {
    metrics.value = await fetchKeyMetrics({
      period: period.value.trim() || undefined,
      companyCode: companyCode.value.trim() || undefined
    });
    period.value = metrics.value.period;
  } catch (err) {
    error.value = err instanceof Error ? err.message : '关键指标加载失败';
  } finally {
    loading.value = false;
  }
}

async function loadCategories() {
  categoryLoading.value = true;
  categoryError.value = '';

  try {
    categories.value = await fetchProductCategories();
    categoriesLoaded.value = true;
  } catch (err) {
    categoryError.value = err instanceof Error ? err.message : '品类配置加载失败';
  } finally {
    categoryLoading.value = false;
  }
}

function openEdit(row: ProductCategory) {
  editError.value = '';
  Object.assign(editForm, {
    id: row.id,
    code: row.code,
    name: row.name,
    subjectKeyword: row.subjectKeyword,
    subjectCodes: row.subjectCodes.join(', '),
    sortOrder: row.sortOrder,
    status: row.status
  });
  editing.value = true;
}

async function saveCategory() {
  if (!editForm.name.trim()) {
    editError.value = '品类名称不能为空';
    return;
  }

  const subjectCodes = editForm.subjectCodes
    .split(/[,，\s]+/)
    .map(item => item.trim())
    .filter(Boolean);

  if (!editForm.subjectKeyword.trim() && subjectCodes.length === 0) {
    editError.value = '匹配关键词与显式科目至少填写一项';
    return;
  }

  saving.value = true;
  editError.value = '';

  try {
    await updateProductCategory(editForm.id, {
      name: editForm.name.trim(),
      subjectKeyword: editForm.subjectKeyword.trim(),
      subjectCodes,
      sortOrder: Number(editForm.sortOrder) || 0,
      status: editForm.status
    });
    editing.value = false;
    await loadCategories();
  } catch (err) {
    editError.value = err instanceof Error ? err.message : '保存失败';
  } finally {
    saving.value = false;
  }
}

watch(tab, value => {
  if (value === 'mapping' && !categoriesLoaded.value) void loadCategories();
});

watch(canMap, value => {
  if (!value && tab.value === 'mapping') tab.value = 'analysis';
});

onMounted(loadMetrics);
</script>

<template>
  <div class="p-16px lt-sm:p-12px">
    <NSpace vertical :size="16">
      <div class="flex flex-wrap items-start justify-between gap-12px">
        <div>
          <h1 class="text-22px font-500">经营专题工作台</h1>
          <p class="mt-6px text-13px text-gray-500">
            关键指标与品类配置试点。其余预置视图和映射规则继续使用旧版。
          </p>
        </div>
      </div>

      <NAlert type="info" :bordered="false">
        这是并行接入的新版外壳。当前仅验证关键指标查询与品类配置；报告、导入和其余专题未迁移。
      </NAlert>

      <div class="flex flex-wrap items-end gap-12px">
        <NFormItem label="分析期间" class="!mb-0">
          <NInput v-model:value="period" placeholder="YYYY-MM，留空取最新" class="w-180px" @keyup.enter="loadMetrics" />
        </NFormItem>
        <NFormItem label="主体编码" class="!mb-0">
          <NInput v-model:value="companyCode" placeholder="留空按账号范围" class="w-190px" @keyup.enter="loadMetrics" />
        </NFormItem>
        <NButton type="primary" :loading="loading" @click="loadMetrics">查询</NButton>
      </div>

      <div class="flex flex-wrap items-center gap-8px">
        <NButton :type="tab === 'analysis' ? 'primary' : 'default'" @click="tab = 'analysis'">分析</NButton>
        <NButton v-if="canMap" :type="tab === 'mapping' ? 'primary' : 'default'" @click="tab = 'mapping'">
          映射规则
        </NButton>
        <span class="text-12px text-gray-500">
          {{ tab === 'analysis' ? '结果范围以实际查询为准' : '品类配置保存后返回分析重新查询核对' }}
        </span>
      </div>

      <template v-if="tab === 'analysis'">
        <NAlert v-if="metrics?.degraded" type="warning" :bordered="false">
          请求主体超出当前账号范围，后端已按实际权限降级为 {{ metrics.companyName || metrics.companyCode }}。
        </NAlert>
        <NAlert v-if="error" type="error" :bordered="false">
          <div class="flex flex-wrap items-center justify-between gap-8px">
            <span>{{ error }}</span>
            <NButton size="small" @click="loadMetrics">重试</NButton>
          </div>
        </NAlert>

        <NCard :bordered="false" size="small">
          <template #header>
            <div class="flex flex-wrap items-center justify-between gap-8px">
              <span>关键指标</span>
              <span class="text-12px text-gray-500">
                {{ metrics?.companyName || '账号范围' }} · {{ metrics?.period || '最新期间' }} · 单位：万元
              </span>
            </div>
          </template>
          <NDataTable
            :columns="columns"
            :data="rows"
            :loading="loading"
            :row-key="row => row.key"
            :scroll-x="980"
            :max-height="560"
            size="small"
            striped
          />
          <template #footer>
            <span class="text-12px text-gray-500">
              当前为关键指标预置视图；产品明细、导出与其他专题沿用旧版。
            </span>
          </template>
        </NCard>
      </template>

      <template v-else>
        <NAlert v-if="categoryError" type="error" :bordered="false">
          <div class="flex flex-wrap items-center justify-between gap-8px">
            <span>{{ categoryError }}</span>
            <NButton size="small" @click="loadCategories">重试</NButton>
          </div>
        </NAlert>
        <NCard :bordered="false" size="small">
          <template #header>
            <div class="flex flex-wrap items-center justify-between gap-8px">
              <span>品类配置</span>
              <span class="text-12px text-gray-500">点击任意行编辑；规则生效范围不等于顶部查询主体</span>
            </div>
          </template>
          <NDataTable
            :columns="categoryColumns"
            :data="categories"
            :loading="categoryLoading"
            :row-key="row => row.id"
            :row-props="row => ({ style: 'cursor: pointer', onClick: () => openEdit(row) })"
            :scroll-x="760"
            size="small"
            striped
          />
          <template #footer>
            <span class="text-12px text-gray-500">
              当前仅迁移品类配置；其他四类映射继续在旧版维护。
            </span>
          </template>
        </NCard>
      </template>
    </NSpace>

    <NModal v-model:show="editing" preset="card" title="编辑品类配置" class="w-560px lt-sm:w-[calc(100vw-24px)]">
      <NSpace vertical :size="14">
        <NFormItem label="品类编码">
          <NInput :value="editForm.code" disabled />
        </NFormItem>
        <NFormItem label="品类名称" required>
          <NInput v-model:value="editForm.name" maxlength="80" placeholder="请输入品类名称" />
        </NFormItem>
        <NFormItem label="匹配关键词">
          <NInput v-model:value="editForm.subjectKeyword" maxlength="80" placeholder="关键词与显式科目至少填写一项" />
        </NFormItem>
        <NFormItem label="显式科目">
          <NInput v-model:value="editForm.subjectCodes" placeholder="多个编码用逗号分隔，例如 PL020101, PL020102" />
        </NFormItem>
        <NFormItem label="排序">
          <NInputNumber v-model:value="editForm.sortOrder" class="w-160px" />
        </NFormItem>
        <NFormItem label="状态">
          <NSelect
            v-model:value="editForm.status"
            :options="[
              { label: '启用', value: 'active' },
              { label: '停用', value: 'inactive' }
            ]"
            class="w-160px"
          />
        </NFormItem>
        <NAlert v-if="editError" type="error" :bordered="false">{{ editError }}</NAlert>
      </NSpace>
      <template #footer>
        <div class="flex justify-end gap-8px">
          <NButton :disabled="saving" @click="editing = false">取消</NButton>
          <NButton type="primary" :loading="saving" @click="saveCategory">保存</NButton>
        </div>
      </template>
    </NModal>
  </div>
</template>
