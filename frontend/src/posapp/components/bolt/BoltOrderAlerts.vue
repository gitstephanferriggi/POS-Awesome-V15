<template>
	<div v-if="store.enabled" :class="['bolt-alert', 'bolt-' + store.availability]">
		<router-link to="/bolt-orders"
			><strong>Bolt Orders</strong> · {{ store.orders.length }} active</router-link
		>
		<span v-if="store.unacknowledged.length"
			>{{ store.unacknowledged.length }} new — open and acknowledge to stop ringing</span
		>
		<BoltStoreControls />
        <v-btn size="small" data-alarm-toggle :aria-pressed="alarmEnabled" @click="toggleAlarm">{{ alarmEnabled ? "Mute alarm" : "Enable alarm" }}</v-btn>
        <v-btn v-if="alarmEnabled" size="small" data-alarm-test @click="enableSound(true)">Test alarm</v-btn>
        <span>{{ !alarmEnabled ? "Alarm muted on this terminal" : soundReady ? "Alarm on" : "Alarm on — click anywhere in POS to allow sound" }}</span>
		<span v-if="soundError || store.error" class="text-error">{{
			soundError || "Connection lost — order status may be out of date."
		}}</span>
	</div>
</template>
<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from "vue";
import { useUIStore } from "../../stores/uiStore";
import { useBoltOrdersStore } from "../../stores/boltOrdersStore";
import BoltStoreControls from "./BoltStoreControls.vue";
const alarmEnabled = ref(true);
const ui = useUIStore(),
	store = useBoltOrdersStore();
const soundReady = ref(false),
	soundError = ref("");
let context: AudioContext | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
function beep() {
	if (!alarmEnabled.value || !context || context.state !== "running") {
		soundReady.value = false;
		return;
	}
	const oscillator = context.createOscillator(),
		volume = context.createGain();
	oscillator.type = "square";
	oscillator.frequency.value = 880;
	volume.gain.setValueAtTime(0.0001, context.currentTime);
	volume.gain.exponentialRampToValueAtTime(0.3, context.currentTime + 0.03);
	volume.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.65);
	oscillator.connect(volume);
	volume.connect(context.destination);
	oscillator.start();
	oscillator.stop(context.currentTime + 0.7);
	oscillator.onended = () => {
		oscillator.disconnect();
		volume.disconnect();
	};
}
async function enableSound(test = false) {
	if (!alarmEnabled.value || !store.enabled) return;
	try {
		context ||= new AudioContext();
        context.onstatechange = () => { soundReady.value = context?.state === "running"; };
		await context.resume();
		soundReady.value = context.state === "running";
		soundError.value = "";
		if (test) beep();
	} catch {
		soundReady.value = false;
		soundError.value = "Browser blocked audio. Check the terminal sound settings.";
	}
}
function unlockSound() { if (alarmEnabled.value && !soundReady.value) void enableSound(); }
function toggleAlarm() {
    alarmEnabled.value = !alarmEnabled.value;
    if (alarmEnabled.value) void enableSound();
    else { if (timer) clearInterval(timer); void context?.suspend(); }
}
onMounted(() => {
    document.addEventListener("pointerdown", unlockSound);
    document.addEventListener("keydown", unlockSound);
    unlockSound();
});
watch(() => store.enabled, (enabled) => { if (enabled) unlockSound(); });
watch(
	() => ui.posProfile?.name,
	(profile) => store.start(profile || ""),
	{ immediate: true },
);
watch(
	() => [store.unacknowledged.length, soundReady.value, alarmEnabled.value, store.enabled],
	() => {
		if (timer) clearInterval(timer);
		if (store.enabled && alarmEnabled.value && store.unacknowledged.length && soundReady.value) {
			beep();
			timer = setInterval(beep, 1800);
		}
	},
);
onBeforeUnmount(() => {
	document.removeEventListener("pointerdown", unlockSound);
    document.removeEventListener("keydown", unlockSound);
    store.stop();
	if (timer) clearInterval(timer);
	void context?.close();
});
</script>
<style scoped>
.bolt-alert {
	display: flex;
	align-items: center;
	flex-wrap: wrap;
	gap: 16px;
	padding: 10px 20px;
	background: #e9f6e9;
	color: #183d24;
	border-bottom: 1px solid #b8d8ba;
}
.bolt-pause, .bolt-unconfirmed { background: #fff3df; color: #68420a; border-color: #e6c68d; }
.bolt-unknown, .bolt-pending { background: #edf1f5; color: #334155; border-color: #cbd5e1; }
a {
	color: inherit;
	text-decoration: none;
}
</style>
