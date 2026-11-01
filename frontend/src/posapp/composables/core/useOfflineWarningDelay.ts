import { onScopeDispose, ref, watch, type Ref } from "vue";

/** Continuous offline duration; a successful reconnect resets the full delay. */
export function useOfflineWarningDelay(onlineReady: Ref<boolean>, delayMs = 30_000) {
 const ready = ref(false);
 let timer: ReturnType<typeof setTimeout> | undefined;
 const clear = () => {
  if (timer !== undefined) clearTimeout(timer);
  timer = undefined;
 };
 watch(onlineReady, (online) => {
  clear();
  ready.value = false;
  if (!online) timer = setTimeout(() => { ready.value = true; timer = undefined; }, delayMs);
 }, { immediate: true, flush: "sync" });
 onScopeDispose(clear);
 return ready;
}
