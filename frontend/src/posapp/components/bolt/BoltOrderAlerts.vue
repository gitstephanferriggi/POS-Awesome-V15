<template>
	<div v-if="store.enabled" class="bolt-alert" role="status">
		<router-link to="/bolt-orders"
			><strong>Bolt Orders</strong> · {{ store.orders.length }} active</router-link
		>
		<span v-if="store.unacknowledged.length"
			>{{ store.unacknowledged.length }} new — open and acknowledge to stop ringing</span
		>
		<v-btn size="small" @click="enableSound">{{
			soundReady ? "Test alarm" : "Enable order alarm"
		}}</v-btn>
		<span v-if="!soundReady">Sound needs enabling on this terminal.</span>
		<span v-if="soundError || store.error" class="text-error">{{
			soundError || "Connection lost — order status may be out of date."
		}}</span>
	</div>
</template>
<script setup lang="ts">
import { ref, watch, onBeforeUnmount } from "vue";
import { useUIStore } from "../../stores/uiStore";
import { useBoltOrdersStore } from "../../stores/boltOrdersStore";
const ui = useUIStore(),
	store = useBoltOrdersStore();
const soundReady = ref(false),
	soundError = ref("");
let context: AudioContext | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
function beep() {
	if (!context || context.state !== "running") {
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
async function enableSound() {
	try {
		context ||= new AudioContext();
		await context.resume();
		soundReady.value = context.state === "running";
		soundError.value = "";
		beep();
	} catch {
		soundReady.value = false;
		soundError.value = "Browser blocked audio. Check the terminal sound settings.";
	}
}
watch(
	() => ui.posProfile?.name,
	(profile) => store.start(profile || ""),
	{ immediate: true },
);
watch(
	() => [store.unacknowledged.length, soundReady.value],
	() => {
		if (timer) clearInterval(timer);
		if (store.unacknowledged.length && soundReady.value) {
			beep();
			timer = setInterval(beep, 1800);
		}
	},
);
onBeforeUnmount(() => {
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
a {
	color: inherit;
	text-decoration: none;
}
</style>
