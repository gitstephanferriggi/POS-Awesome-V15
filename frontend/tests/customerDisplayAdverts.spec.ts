import { effectScope, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCustomerDisplayAdverts } from "../src/posapp/composables/pos/shared/useCustomerDisplayAdverts";
import {
	getCustomerDisplayAdverts,
	type CustomerDisplaySnapshot,
} from "../src/posapp/utils/customerDisplay";

const images = Array.from({ length: 10 }, (_, i) => ({
	image: `/files/ad-${i}.png`,
	title: `Advert ${i}`,
}));
const profile = {
	posa_enable_customer_display: 1,
	posa_enable_customer_display_adverts: 1,
	posa_customer_display_adverts: images,
};
const makeSnapshot = (): CustomerDisplaySnapshot => ({
	channel_id: "till-1",
	currency: "EUR",
	customer_name: "",
	items: [],
	total_qty: 0,
	total_amount: 0,
	updated_at: "",
	bill_active: false,
	adverts: images,
});
let scopes: ReturnType<typeof effectScope>[] = [];
function setup(overrides: Partial<CustomerDisplaySnapshot> = {}) {
	const snapshot = ref({ ...makeSnapshot(), ...overrides });
	const scope = effectScope();
	scopes.push(scope);
	const display = scope.run(() => useCustomerDisplayAdverts(snapshot))!;
	return { snapshot, display, scope };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
	scopes.forEach((s) => s.stop());
	scopes = [];
	vi.useRealTimers();
});

describe("customer display adverts", () => {
	it("waits five seconds then rotates all ten adverts every ten seconds and loops", () => {
		const { display } = setup();
		vi.advanceTimersByTime(4999);
		expect(display.currentAdvert.value).toBeNull();
		vi.advanceTimersByTime(1);
		for (let i = 0; i < 10; i++) {
			expect(display.currentAdvert.value).toEqual(images[i]);
			vi.advanceTimersByTime(10000);
		}
		expect(display.currentAdvert.value).toEqual(images[0]);
	});
	it("never shows adverts during an active bill or payment, however long the pause", () => {
		const { snapshot, display } = setup({ bill_active: true });
		vi.advanceTimersByTime(600000);
		expect(display.currentAdvert.value).toBeNull();
		snapshot.value = { ...snapshot.value, bill_active: false };
		vi.advanceTimersByTime(4999);
		expect(display.currentAdvert.value).toBeNull();
		vi.advanceTimersByTime(1);
		expect(display.currentAdvert.value).toEqual(images[0]);
	});
	it("stops immediately on a new bill and cancels an unfinished idle countdown", () => {
		const { snapshot, display } = setup();
		vi.advanceTimersByTime(4000);
		snapshot.value.bill_active = true;
		vi.advanceTimersByTime(20000);
		expect(display.currentAdvert.value).toBeNull();
		snapshot.value.bill_active = false;
		vi.advanceTimersByTime(5000);
		expect(display.currentAdvert.value).toEqual(images[0]);
		snapshot.value.bill_active = true;
		expect(display.currentAdvert.value).toBeNull();
	});
	it("does not restart the idle delay on repeated identical cart snapshots", () => {
		const { snapshot, display } = setup();
		vi.advanceTimersByTime(4000);
		snapshot.value = {
			...snapshot.value,
			updated_at: new Date().toISOString(),
			adverts: [...images],
		};
		vi.advanceTimersByTime(1000);
		expect(display.currentAdvert.value).toEqual(images[0]);
	});
	it("stops when switched off or when the display channel changes", () => {
		const { snapshot, display } = setup();
		vi.advanceTimersByTime(5000);
		snapshot.value.adverts = [];
		expect(display.currentAdvert.value).toBeNull();
		snapshot.value.adverts = images;
		vi.advanceTimersByTime(5000);
		snapshot.value.channel_id = "till-2";
		expect(display.currentAdvert.value).toBeNull();
		vi.advanceTimersByTime(5000);
		expect(display.currentAdvert.value).toEqual(images[0]);
	});
	it("keeps the normal screen for old snapshots, no images, or remaining cart items", () => {
		for (const overrides of [
			{ bill_active: undefined },
			{ adverts: [] },
			{
				items: [
					{
						id: "1",
						item_code: "X",
						item_name: "X",
						qty: 1,
						rate: 1,
						amount: 1,
						uom: "Nos",
					},
				],
			},
		]) {
			const { display } = setup(overrides);
			vi.advanceTimersByTime(20000);
			expect(display.currentAdvert.value).toBeNull();
		}
	});
	it("skips unavailable images and falls back to the normal screen if all fail", () => {
		const { display } = setup({ adverts: images.slice(0, 2) });
		vi.advanceTimersByTime(5000);
		expect(display.imageVisible.value).toBe(false);
		display.imageFailed(images[0].image);
		expect(display.currentAdvert.value).toEqual(images[1]);
		display.imageLoaded(images[1].image);
		expect(display.imageVisible.value).toBe(true);
		display.imageFailed(images[1].image);
		expect(display.currentAdvert.value).toBeNull();
		expect(vi.getTimerCount()).toBe(0);
	});
	it("retains a single advert and clears timers on exit", () => {
		const { display, scope } = setup({ adverts: images.slice(0, 1) });
		vi.advanceTimersByTime(45000);
		expect(display.currentAdvert.value).toEqual(images[0]);
		scope.stop();
		expect(vi.getTimerCount()).toBe(0);
	});
	it("defaults old profiles to off, respects switches, order, and the ten-image maximum", () => {
		expect(getCustomerDisplayAdverts({})).toEqual([]);
		expect(
			getCustomerDisplayAdverts({
				...profile,
				posa_enable_customer_display: 0,
			}),
		).toEqual([]);
		expect(
			getCustomerDisplayAdverts({
				...profile,
				posa_enable_customer_display_adverts: "0",
			}),
		).toEqual([]);
		expect(
			getCustomerDisplayAdverts({
				...profile,
				posa_customer_display_adverts: [...images, images[0]],
			}),
		).toEqual(images);
		expect(
			getCustomerDisplayAdverts({
				...profile,
				posa_customer_display_adverts: [
					{ image: "javascript:alert(1)" },
					{ image: "" },
				],
			}),
		).toEqual([]);
	});
});
