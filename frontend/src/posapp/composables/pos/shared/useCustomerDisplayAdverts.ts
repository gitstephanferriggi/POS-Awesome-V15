import { computed, onScopeDispose, ref, watch, type Ref } from "vue";
import type { CustomerDisplaySnapshot } from "../../../utils/customerDisplay";

/** Advert timing follows bill lifecycle, never mouse/keyboard inactivity. */
export function useCustomerDisplayAdverts(
	snapshot: Ref<CustomerDisplaySnapshot>,
) {
	const showing = ref(false);
	const index = ref(0);
	const failed = ref<string[]>([]);
	const loadedImage = ref("");
	let idleTimer: ReturnType<typeof setTimeout> | undefined;
	let rotationTimer: ReturnType<typeof setInterval> | undefined;
	const adverts = computed(() =>
		(snapshot.value.adverts || [])
			.slice(0, 10)
			.filter(
				(advert) =>
					advert.image && !failed.value.includes(advert.image),
			),
	);
	const currentAdvert = computed(() =>
		showing.value && adverts.value.length
			? adverts.value[index.value % adverts.value.length]
			: null,
	);
	const imageVisible = computed(() =>
		Boolean(
			currentAdvert.value &&
				loadedImage.value === currentAdvert.value.image,
		),
	);

	const stop = () => {
		clearTimeout(idleTimer);
		clearInterval(rotationTimer);
		idleTimer = undefined;
		rotationTimer = undefined;
		showing.value = false;
		loadedImage.value = "";
	};

	watch(
		() =>
			JSON.stringify([
				snapshot.value.channel_id,
				snapshot.value.bill_active === false &&
					!snapshot.value.items?.length,
				snapshot.value.adverts || [],
			]),
		() => {
			stop();
			failed.value = [];
			index.value = 0;
			if (
				snapshot.value.bill_active !== false ||
				snapshot.value.items?.length ||
				!adverts.value.length
			)
				return;
			idleTimer = setTimeout(() => {
				showing.value = true;
				rotationTimer = setInterval(() => {
					index.value =
						(index.value + 1) % Math.max(adverts.value.length, 1);
				}, 10000);
			}, 5000);
		},
		{ immediate: true, flush: "sync" },
	);

	watch(
		() => currentAdvert.value?.image,
		() => {
			loadedImage.value = "";
		},
		{ flush: "sync" },
	);
	const imageLoaded = (image: string) => {
		loadedImage.value = image;
	};
	const imageFailed = (image: string) => {
		failed.value = [...failed.value, image];
		if (!adverts.value.length) stop();
	};
	onScopeDispose(stop);
	return { currentAdvert, imageVisible, imageLoaded, imageFailed };
}
