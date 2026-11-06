import ankiConnectInvoke from '../../../libs/ankiConnect.js';
import {el} from '../../../libs/dom.js';

export function startOfAnkiDay(now = new Date()) {
	const start = new Date(now);
	start.setHours(4, 0, 0, 0);
	if (now.getTime() < start.getTime()) start.setDate(start.getDate() - 1);
	return start.getTime();
}

export function formatDuration(ms) {
	const minutes = Math.round(ms / 60000);
	if (minutes < 1) return 'less than a minute';
	if (minutes < 60) return minutes + 'm';
	return Math.floor(minutes / 60) + 'h ' + (minutes % 60) + 'm';
}

export async function reviewedToday() {
	const count = Number(await ankiConnectInvoke('getNumCardsReviewedToday')) || 0;
	return count + ' card' + (count === 1 ? '' : 's') + ' reviewed today';
}

export async function timeStudiedToday() {
	const cards = await ankiConnectInvoke('findCards', {query: 'rated:1'});
	if (!Array.isArray(cards) || cards.length > 2000) return null;
	if (!cards.length) return 'Time studied today: less than a minute';
	const reviews = await ankiConnectInvoke('getReviewsOfCards', {cards});
	const start = startOfAnkiDay();
	let total = 0;
	Object.values(reviews || {}).forEach((reviewList) => {
		(reviewList || []).forEach((review) => {
			if (review && Number(review.id) >= start) total += Number(review.time) || 0;
		});
	});
	return 'Time studied today: ' + formatDuration(total);
}

export async function nextDueTomorrow() {
	const cards = await ankiConnectInvoke('findCards', {query: 'prop:due=1'});
	const count = Array.isArray(cards) ? cards.length : 0;
	return count + ' card' + (count === 1 ? '' : 's') + ' due tomorrow';
}

function statLine(text) {
	return text ? el('div', 'stat-line', text) : null;
}

function fillStats(container, settings) {
	const requests = [];
	if (settings.doneShowStats) {
		requests.push(reviewedToday(), timeStudiedToday());
	}
	if (settings.doneShowNextDue) requests.push(nextDueTomorrow());
	Promise.all(requests.map((request) => request.then(statLine).catch(() => null))).then((lines) => {
		lines.forEach((line) => {
			if (line) container.appendChild(line);
		});
	});
}

export function buildStats(settings) {
	const container = el('div', 'done-stats');
	fillStats(container, settings);
	return container;
}
