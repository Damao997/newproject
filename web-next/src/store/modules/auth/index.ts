import { computed, reactive, ref } from 'vue';
import { defineStore } from 'pinia';
import { SetupStoreId } from '@/enum';
import { fetchProfile } from '@/service/api/workbench';
import {
  getSession,
  onSessionChange,
  redirectToLegacyLogin,
  type LegacySession
} from '@/service/session';

export const useAuthStore = defineStore(SetupStoreId.Auth, () => {
  const token = ref('');
  const loginLoading = ref(false);

  const userInfo = reactive({
    userId: '',
    userName: '',
    roles: [] as string[],
    buttons: [] as string[]
  });

  /** 新版前端不维护独立登录态，只读取旧版 auth-storage 的共享会话。 */
  const isLogin = computed(() => Boolean(token.value));
  const isStaticSuper = computed(() => false);

  function applySession(session: LegacySession | null) {
    token.value = session?.accessToken ?? '';

    if (!session) {
      userInfo.userId = '';
      userInfo.userName = '';
      userInfo.roles = [];
      userInfo.buttons = [];
      return;
    }

    const permissions = session.user.permissions ?? [];
    userInfo.userId = session.user.id ?? '';
    userInfo.userName = session.user.name || session.user.username || '';
    userInfo.roles = permissions;
    userInfo.buttons = permissions;
  }

  async function initUserInfo() {
    const session = getSession();
    applySession(session);

    if (!session) return false;

    try {
      const profile = await fetchProfile();
      userInfo.userId = profile.id;
      userInfo.userName = profile.name || profile.username;
      const permissions = profile.permissions ?? userInfo.roles;
      userInfo.roles = permissions;
      userInfo.buttons = permissions;
    } catch {
      // 网络或后端暂时失败时保留共享会话中的权限；请求层会在 401 时统一处理刷新。
    }

    token.value = getSession()?.accessToken ?? '';
    return Boolean(token.value);
  }

  function resetStore() {
    applySession(null);
    redirectToLegacyLogin();
  }

  async function login() {
    loginLoading.value = true;
    redirectToLegacyLogin();
    loginLoading.value = false;
  }

  onSessionChange(applySession);

  return {
    token,
    userInfo,
    isLogin,
    isStaticSuper,
    loginLoading,
    initUserInfo,
    login,
    resetStore
  };
});
