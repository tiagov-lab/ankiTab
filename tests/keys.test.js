import {describe, it, expect, vi} from 'vitest';
import {isEditableTarget, createKeyHandler} from '../extension/app/js/keys.js';

function typeInto(type) {
	const input = document.createElement('input');
	input.type = type;
	return input;
}

describe('isEditableTarget', () => {
	it.each(['text', 'search', 'email', 'url', 'tel', 'password', 'number', 'date', 'time', 'month', 'week', 'datetime-local'])(
		'treats an input of type %s as editable',
		(type) => {
			expect(isEditableTarget(typeInto(type))).toBe(true);
		}
	);

	it.each(['radio', 'checkbox', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image'])(
		'keeps shortcuts working on an input of type %s',
		(type) => {
			expect(isEditableTarget(typeInto(type))).toBe(false);
		}
	);

	it('treats an input with no type as text', () => {
		const input = document.createElement('input');
		expect(isEditableTarget(input)).toBe(true);
	});

	it('defaults an input without a type property to text', () => {
		expect(isEditableTarget({tagName: 'INPUT', type: ''})).toBe(true);
		expect(isEditableTarget({tagName: 'INPUT', type: 'RADIO'})).toBe(false);
	});

	it('treats textarea and select as editable', () => {
		expect(isEditableTarget(document.createElement('textarea'))).toBe(true);
		expect(isEditableTarget(document.createElement('select'))).toBe(true);
	});

	it('treats contenteditable elements as editable', () => {
		const div = document.createElement('div');
		Object.defineProperty(div, 'isContentEditable', {value: true});
		expect(isEditableTarget(div)).toBe(true);
	});

	it('returns false for null and for ordinary elements', () => {
		expect(isEditableTarget(null)).toBe(false);
		expect(isEditableTarget(document.createElement('div'))).toBe(false);
		expect(isEditableTarget({})).toBe(false);
	});
});

function keyEvent(overrides = {}) {
	return Object.assign(
		{
			key: 'x',
			code: 'KeyX',
			repeat: false,
			altKey: false,
			metaKey: false,
			ctrlKey: false,
			shiftKey: false,
			target: document.body,
			preventDefault: vi.fn(),
		},
		overrides
	);
}

function handlers(overrides = {}) {
	return Object.assign(
		{
			state: () => 'question',
			showAnswer: vi.fn(),
			answer: vi.fn(),
			answerCount: () => 4,
			goodIndex: () => 3,
			edit: vi.fn(),
			undo: vi.fn(),
			bury: vi.fn(),
			suspend: vi.fn(),
			replay: vi.fn(),
		},
		overrides
	);
}

describe('createKeyHandler', () => {
	it('ignores repeated keydowns', () => {
		const h = handlers();
		createKeyHandler(h)(keyEvent({key: ' ', repeat: true}));
		expect(h.showAnswer).not.toHaveBeenCalled();
	});

	it('ignores alt and meta combinations so browser shortcuts still work', () => {
		const h = handlers();
		const handle = createKeyHandler(h);
		const alt = keyEvent({key: '@', altKey: true});
		const meta = keyEvent({key: 'r', metaKey: true});
		handle(alt);
		handle(meta);
		expect(h.suspend).not.toHaveBeenCalled();
		expect(h.replay).not.toHaveBeenCalled();
		expect(alt.preventDefault).not.toHaveBeenCalled();
	});

	it('ignores ctrl combinations other than ctrl+z', () => {
		const h = handlers();
		const handle = createKeyHandler(h);
		handle(keyEvent({key: 'r', ctrlKey: true}));
		handle(keyEvent({key: '1', ctrlKey: true}));
		expect(h.replay).not.toHaveBeenCalled();
		expect(h.answer).not.toHaveBeenCalled();
	});

	it('maps ctrl+z to undo', () => {
		const h = handlers();
		const event = keyEvent({key: 'z', ctrlKey: true});
		createKeyHandler(h)(event);
		expect(h.undo).toHaveBeenCalledTimes(1);
		expect(event.preventDefault).toHaveBeenCalled();
	});

	it('ignores everything while busy', () => {
		const h = handlers({state: () => 'busy'});
		const handle = createKeyHandler(h);
		const event = keyEvent({key: 'e'});
		handle(event);
		expect(h.edit).not.toHaveBeenCalled();
		expect(event.preventDefault).not.toHaveBeenCalled();
	});

	it('leaves keys alone when the target is editable', () => {
		const h = handlers();
		createKeyHandler(h)(keyEvent({key: '-', target: typeInto('text')}));
		expect(h.bury).not.toHaveBeenCalled();
	});

	it('leaves keys alone when the target is inside the More menu', () => {
		const menu = document.createElement('div');
		menu.id = 'menu';
		const button = document.createElement('button');
		menu.appendChild(button);
		document.body.appendChild(menu);
		const h = handlers();
		createKeyHandler(h)(keyEvent({key: ' ', target: button}));
		expect(h.showAnswer).not.toHaveBeenCalled();
	});

	it('maps @ to suspend', () => {
		const h = handlers();
		const event = keyEvent({key: '@'});
		createKeyHandler(h)(event);
		expect(h.suspend).toHaveBeenCalledTimes(1);
		expect(event.preventDefault).toHaveBeenCalled();
	});

	it('maps - to bury', () => {
		const h = handlers();
		const event = keyEvent({key: '-'});
		createKeyHandler(h)(event);
		expect(h.bury).toHaveBeenCalledTimes(1);
		expect(event.preventDefault).toHaveBeenCalled();
	});

	it('shows the answer on space or enter in the question state', () => {
		const h = handlers({state: () => 'question'});
		const handle = createKeyHandler(h);
		handle(keyEvent({key: ' '}));
		handle(keyEvent({key: 'Enter'}));
		expect(h.showAnswer).toHaveBeenCalledTimes(2);
	});

	it('answers with goodIndex on space in the answer state', () => {
		const h = handlers({state: () => 'answer', goodIndex: () => 3});
		createKeyHandler(h)(keyEvent({key: ' '}));
		expect(h.answer).toHaveBeenCalledWith(3);
	});

	it('answers with the number key and ignores digits above answerCount', () => {
		const h = handlers({state: () => 'answer', answerCount: () => 2});
		const handle = createKeyHandler(h);
		handle(keyEvent({key: '1'}));
		handle(keyEvent({key: '3'}));
		expect(h.answer).toHaveBeenCalledTimes(1);
		expect(h.answer).toHaveBeenCalledWith(1);
	});

	it('ignores digit keys in the question state', () => {
		const h = handlers({state: () => 'question'});
		createKeyHandler(h)(keyEvent({key: '2'}));
		expect(h.answer).not.toHaveBeenCalled();
	});

	it('maps e and E to edit', () => {
		const h = handlers();
		const handle = createKeyHandler(h);
		handle(keyEvent({key: 'e'}));
		handle(keyEvent({key: 'E'}));
		expect(h.edit).toHaveBeenCalledTimes(2);
	});

	it('maps r, R and F5 to replay', () => {
		const h = handlers();
		const handle = createKeyHandler(h);
		handle(keyEvent({key: 'r'}));
		handle(keyEvent({key: 'R'}));
		handle(keyEvent({key: 'Unidentified', code: 'F5'}));
		expect(h.replay).toHaveBeenCalledTimes(3);
		expect(h.edit).not.toHaveBeenCalled();
	});

	it('calls preventDefault only for handled keys', () => {
		const h = handlers();
		const handle = createKeyHandler(h);
		const handled = keyEvent({key: '-'});
		const ignored = keyEvent({key: 'x'});
		handle(handled);
		handle(ignored);
		expect(handled.preventDefault).toHaveBeenCalled();
		expect(ignored.preventDefault).not.toHaveBeenCalled();
	});
});
