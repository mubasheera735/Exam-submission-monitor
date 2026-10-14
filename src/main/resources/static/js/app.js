/* =========================================================================
   Exam Submission Monitor — page behaviour
   Progressive enhancement: without this script the form still posts to
   /check and the server renders the result. With it, the page validates
   as you type, previews the deadline, checks without reloading, draws the
   timeline and keeps a history of recent checks in this browser.
   ========================================================================= */
(function () {
    'use strict';

    /* ---------- Small helpers ---------- */
    const $ = (sel, root = document) => root.querySelector(sel);
    const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
    const el = (tag, className, text) => {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text != null) node.textContent = text;
        return node;
    };
    const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const pad = (n) => String(n).padStart(2, '0');

    /** Parses "2026-10-14T10:00" (what datetime-local and LocalDateTime#toString produce) as local time. */
    function parseLocal(value) {
        if (!value) return null;
        const d = new Date(value);
        return isNaN(d.getTime()) ? null : d;
    }
    function fmtTime(d, withSeconds) {
        let h = d.getHours();
        const ap = h < 12 ? 'AM' : 'PM';
        h = h % 12 || 12;
        return pad(h) + ':' + pad(d.getMinutes()) + (withSeconds ? ':' + pad(d.getSeconds()) : '') + ' ' + ap;
    }
    /* Same pattern the server uses: dd MMM yyyy, hh:mm a */
    const fmtFull = (d) => pad(d.getDate()) + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear() + ', ' + fmtTime(d);
    const fmtShort = (d) => pad(d.getDate()) + ' ' + MONTHS[d.getMonth()] + ', ' + fmtTime(d);
    const toInputValue = (d) =>
        d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    const sameDay = (a, b) => a.toDateString() === b.toDateString();
    const minutesBetween = (a, b) => Math.floor((b.getTime() - a.getTime()) / 60000);

    /* localStorage can be missing or throw (private mode, blocked storage) — never let that break the page */
    const store = {
        get(key, fallback) {
            try {
                const raw = localStorage.getItem(key);
                return raw === null ? fallback : JSON.parse(raw);
            } catch (e) { return fallback; }
        },
        set(key, value) {
            try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ }
        }
    };

    /* ---------- Toast ---------- */
    const toastEl = $('#toast');
    let toastTimer;
    function hideToast() { toastEl.classList.remove('is-visible'); }
    function toast(message, opts = {}) {
        toastEl.textContent = '';
        toastEl.className = 'toast' + (opts.type === 'error' ? ' is-error' : '');
        toastEl.append(el('span', null, message));
        if (opts.action) {
            const b = el('button', 'toast-action', opts.action.label);
            b.type = 'button';
            b.addEventListener('click', () => { opts.action.run(); hideToast(); });
            toastEl.append(b);
        }
        void toastEl.offsetWidth; // restart the transition
        toastEl.classList.add('is-visible');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(hideToast, opts.action ? 6000 : 3200);
    }

    const srStatus = $('#sr-status');
    function announce(message) {
        srStatus.textContent = '';
        setTimeout(() => { srStatus.textContent = message; }, 50);
    }

    /* ---------- Theme ---------- */
    const root = document.documentElement;
    const themeBtn = $('#theme-toggle');
    const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const currentTheme = () => root.getAttribute('data-theme') || (darkQuery.matches ? 'dark' : 'light');
    function syncThemeButton() {
        themeBtn.setAttribute('aria-label', currentTheme() === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
    }
    themeBtn.addEventListener('click', () => {
        const next = currentTheme() === 'dark' ? 'light' : 'dark';
        root.setAttribute('data-theme', next);
        try { localStorage.setItem('esm.theme', next); } catch (e) { /* ignore */ }
        syncThemeButton();
    });
    if (darkQuery.addEventListener) darkQuery.addEventListener('change', syncThemeButton);
    syncThemeButton();

    /* ---------- Live clock ---------- */
    const clock = $('#clock');
    function tickClock() {
        const now = new Date();
        clock.textContent = fmtTime(now, true);
        clock.setAttribute('datetime', now.toISOString());
        clock.title = 'Current time, ' + fmtFull(now);
        setTimeout(tickClock, 1000 - now.getMilliseconds());
    }
    tickClock();

    /* ---------- Timeline ---------- */
    const timelines = new Set();

    /**
     * Draws start → deadline (the exam window) and, if given, where the paper was submitted.
     * Late time beyond the deadline is drawn as a hatched overrun.
     */
    function renderTimeline(container, start, deadline, submission, opts = {}) {
        if (!container) return;
        container._tl = { start, deadline, submission, opts };
        timelines.add(container);
        container.textContent = '';
        container.className = 'tl';
        container.removeAttribute('role');
        container.removeAttribute('aria-label');

        if (!start || !deadline) {
            container.classList.add('is-placeholder');
            container.append(el('div', 'tl-placeholder', 'The exam window appears here once the start time and duration are set.'));
            return;
        }

        const s = start.getTime();
        const d = deadline.getTime();
        const sub = submission ? submission.getTime() : null;
        const end = Math.max(d, sub == null ? d : sub);
        const span = Math.max(end - s, 1);
        const pct = (t) => ((t - s) / span) * 100;
        const late = sub != null && sub > d;
        const multiDay = !sameDay(start, new Date(end));
        const label = (date) => (multiDay ? fmtShort(date) : fmtTime(date));

        if (opts.preview) container.classList.add('tl-preview-only');
        if (sub != null) container.classList.add(late ? 'is-late' : 'is-ok');

        const track = el('div', 'tl-track');
        const win = el('div', 'tl-window');
        win.style.width = pct(d) + '%';
        track.append(win);

        if (late) {
            const over = el('div', 'tl-overrun');
            over.style.left = pct(d) + '%';
            over.style.width = (100 - pct(d)) + '%';
            track.append(over);
        }

        const marker = (cls, pos, caption, time) => {
            const m = el('div', 'tl-marker ' + cls);
            m.style.left = pos + '%';
            const lab = el('span', 'tl-label');
            lab.append(caption + ' ', el('strong', null, time));
            m.append(lab);
            m._pos = pos;
            track.append(m);
            return m;
        };

        const startMark = marker('tl-tick tl-start', 0, 'Start', label(start));
        const deadMark = marker('tl-tick tl-deadline', pct(d), 'Deadline', label(deadline));
        let pinMark = null;
        if (sub != null) pinMark = marker('tl-pin', pct(sub), 'Submitted', label(submission));

        container.append(track);

        // Keep labels inside the track's width, then drop the deadline label to a second row if it collides with "Start".
        const trackW = track.clientWidth;
        [startMark, deadMark, pinMark].forEach((m) => {
            if (!m) return;
            const lab = m.firstChild;
            const w = lab.offsetWidth;
            const x = (m._pos / 100) * trackW;
            let shift = -w / 2;
            if (x + shift < 0) shift = -x;
            if (x + shift + w > trackW) shift = trackW - x - w;
            lab.style.transform = 'translateX(' + Math.round(shift) + 'px)';
        });
        const a = startMark.firstChild.getBoundingClientRect();
        const b = deadMark.firstChild.getBoundingClientRect();
        if (trackW > 0 && a.right + 10 > b.left) {
            deadMark.classList.add('row-2');
            container.classList.add('has-row-2');
        }

        // Text alternative for screen readers
        let desc = 'Exam window from ' + label(start) + ' to ' + label(deadline) + '.';
        if (sub != null) {
            desc += ' Submitted at ' + label(submission) + (late
                ? ', ' + minutesBetween(deadline, submission) + ' minutes after the deadline.'
                : ', within the time limit.');
        }
        container.setAttribute('role', 'img');
        container.setAttribute('aria-label', desc);
    }

    let resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            timelines.forEach((c) => {
                if (!c.isConnected) { timelines.delete(c); return; }
                const t = c._tl;
                renderTimeline(c, t.start, t.deadline, t.submission, t.opts);
            });
        }, 120);
    });

    /* ---------- Form ---------- */
    const form = $('#check-form');
    const fields = {
        studentId: form.elements.studentId,
        start: form.elements.start,
        duration: form.elements.duration,
        submission: form.elements.submission
    };
    const checkBtn = $('#check-btn');
    const checkLabel = $('.btn-label', checkBtn);
    const deadlineHint = $('#deadline-hint');
    const panel = $('#result-panel');
    const touched = new Set();
    let attempted = false;

    function readForm() {
        const start = parseLocal(fields.start.value);
        const submission = parseLocal(fields.submission.value);
        const raw = fields.duration.value.trim();
        const duration = raw === '' ? null : Number(raw);
        const durationOk = duration != null && Number.isInteger(duration) && duration > 0;
        const deadline = start && durationOk ? new Date(start.getTime() + duration * 60000) : null;
        return { studentId: fields.studentId.value.trim(), start, duration, durationOk, submission, deadline };
    }

    /* Messages mirror the server's own validation so both say the same thing */
    function validate() {
        const v = readForm();
        const errors = {};
        if (!v.studentId) errors.studentId = 'Enter the student ID.';

        if (!fields.start.value) errors.start = 'Enter the exam start time.';
        else if (!v.start) errors.start = 'Enter a valid date and time.';

        const dur = fields.duration;
        if (dur.validity.badInput || (dur.value !== '' && !Number.isInteger(Number(dur.value)))) {
            errors.duration = 'Enter the duration in whole minutes.';
        } else if (dur.value === '') {
            errors.duration = 'Enter the exam duration.';
        } else if (Number(dur.value) <= 0) {
            errors.duration = 'Duration must be greater than 0.';
        }

        if (!fields.submission.value) errors.submission = 'Enter the submission time.';
        else if (!v.submission) errors.submission = 'Enter a valid date and time.';
        else if (v.start && v.submission < v.start) errors.submission = 'Submission time cannot be before the exam start time.';

        return errors;
    }

    function showErrors(errors) {
        Object.keys(fields).forEach((name) => {
            const visible = attempted || touched.has(name);
            const msg = visible ? errors[name] || '' : '';
            $('#' + name + '-error').textContent = msg;
            if (msg) fields[name].setAttribute('aria-invalid', 'true');
            else fields[name].removeAttribute('aria-invalid');
        });
    }

    function updateDeadlineHint(v) {
        deadlineHint.textContent = '';
        if (v.deadline) {
            deadlineHint.append('Deadline: ', el('strong', null, fmtFull(v.deadline)));
        } else {
            deadlineHint.textContent = 'The deadline appears here once the start time and duration are set.';
        }
        $$('.chip').forEach((chip) => chip.setAttribute('aria-pressed', String(Number(chip.dataset.duration) === v.duration)));
    }

    function updatePreview(v) {
        const empty = $('[data-state="empty"]', panel);
        if (!empty || empty.hidden) return;
        const note = $('[data-preview-note]', empty);
        const sub = v.submission && v.start && v.submission >= v.start ? v.submission : null;
        renderTimeline($('[data-preview]', empty), v.start, v.deadline, v.deadline ? sub : null, { preview: true });

        if (!v.deadline) {
            note.innerHTML = 'Fill in the details and choose <strong>Check submission</strong>. A preview of the exam window appears here as you type.';
        } else if (!sub) {
            note.textContent = 'The exam window runs from ' + fmtFull(v.start) + ' to ' +
                (sameDay(v.start, v.deadline) ? fmtTime(v.deadline) : fmtFull(v.deadline)) + '. Add the submission time to see where it lands.';
        } else {
            const late = sub > v.deadline;
            note.textContent = late
                ? 'From these times the paper looks about ' + minutesBetween(v.deadline, sub) + ' min late. Check it to confirm and save it to recent checks.'
                : 'From these times the paper looks on time. Check it to confirm and save it to recent checks.';
        }
    }

    function markStale() {
        const res = $('.result[data-state="result"], .result[data-state="error"]', panel);
        if (!res || res.classList.contains('is-stale')) return;
        res.classList.add('is-stale');
        res.classList.remove('is-new');
        const note = el('div', 'stale-note');
        note.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8v5M12 16.5v.5"/><circle cx="12" cy="12" r="10"/></svg>';
        note.append('The details have changed. Check again to update this result.');
        res.prepend(note);
    }

    function onFormChanged() {
        const v = readForm();
        updateDeadlineHint(v);
        updatePreview(v);
        showErrors(validate());
        markStale();
    }

    form.addEventListener('input', onFormChanged);
    Object.keys(fields).forEach((name) => {
        fields[name].addEventListener('blur', () => {
            if (fields[name].value !== '') touched.add(name);
            showErrors(validate());
        });
        fields[name].addEventListener('change', () => { touched.add(name); showErrors(validate()); });
    });

    // Duration shortcuts
    $$('.chip').forEach((chip) => chip.addEventListener('click', () => {
        fields.duration.value = chip.dataset.duration;
        touched.add('duration');
        onFormChanged();
    }));

    // "Use current time" buttons
    $$('[data-now]').forEach((btn) => btn.addEventListener('click', () => {
        const name = btn.dataset.now;
        fields[name].value = toInputValue(new Date());
        touched.add(name);
        onFormChanged();
        fields[name].focus();
    }));

    // Example from the README: 10:00 AM start, 60 minutes, submitted 11:05 AM → 5 minutes late
    $('#load-example').addEventListener('click', () => {
        const start = new Date();
        start.setHours(10, 0, 0, 0);
        fields.studentId.value = 'STU-1042';
        fields.start.value = toInputValue(start);
        fields.duration.value = '60';
        fields.submission.value = toInputValue(new Date(start.getTime() + 65 * 60000));
        Object.keys(fields).forEach((n) => touched.add(n));
        onFormChanged();
        toast('Example loaded: a 60-minute exam submitted at 11:05 AM.');
    });

    function showEmptyState() {
        $$('.result', panel).forEach((n) => n.remove());
        const empty = $('[data-state="empty"]', panel);
        if (empty) empty.hidden = false;
        updatePreview(readForm());
    }

    function clearForm() {
        Object.values(fields).forEach((f) => { f.value = ''; f.removeAttribute('aria-invalid'); });
        touched.clear();
        attempted = false;
        showErrors({});
        updateDeadlineHint(readForm());
        showEmptyState();
        fields.studentId.focus();
    }
    $('#clear-form').addEventListener('click', clearForm);

    function setLoading(on) {
        checkBtn.classList.toggle('is-loading', on);
        checkBtn.disabled = on;
        checkLabel.textContent = on ? 'Checking…' : 'Check submission';
    }

    form.addEventListener('submit', async (event) => {
        attempted = true;
        const errors = validate();
        showErrors(errors);
        const firstInvalid = Object.keys(fields).find((n) => errors[n]);
        if (firstInvalid) {
            event.preventDefault();
            fields[firstInvalid].focus();
            announce(errors[firstInvalid]);
            return;
        }
        if (!window.fetch || !window.DOMParser) return; // let the browser post the form normally

        event.preventDefault();
        setLoading(true);
        let res;
        try {
            res = await fetch(form.action, {
                method: 'POST',
                body: new URLSearchParams(new FormData(form)),
                headers: { Accept: 'text/html' }
            });
        } catch (networkError) {
            toast('Couldn’t reach the server. Make sure the app is running, then check again.', { type: 'error' });
            setLoading(false);
            return;
        }
        try {
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
            const fresh = doc.getElementById('result-panel');
            if (!fresh) throw new Error('Unexpected response');
            panel.innerHTML = fresh.innerHTML;
            hydrateResult({ isNew: true });
        } catch (err) {
            toast('The server couldn’t check this submission (' + err.message + '). Review the details and try again.', { type: 'error' });
        } finally {
            setLoading(false);
        }
    });

    /* ---------- Result ---------- */
    let current = null; // the result on screen, used by "Copy summary"

    function hydrateResult({ isNew }) {
        // Timestamps: time on top, date underneath
        $$('[data-dt]', panel).forEach((n) => {
            const d = parseLocal(n.getAttribute('data-dt'));
            if (!d) return;
            n.textContent = '';
            n.append(fmtTime(d), el('span', 'dd-sub', pad(d.getDate()) + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear()));
        });

        const res = $('.result[data-state="result"]', panel);
        const err = $('.result[data-state="error"]', panel);
        current = null;

        if (res) {
            const data = res.dataset;
            const start = parseLocal(data.start);
            const deadline = parseLocal(data.deadline);
            const submission = parseLocal(data.submission);
            const onTime = data.ontime === 'true';
            const delay = Number(data.delay) || 0;

            if (isNew) res.classList.add('is-new');
            renderTimeline($('[data-timeline]', res), start, deadline, submission);

            // Break the server's late message after its dash so the stamp reads in two lines (text unchanged)
            const stamp = $('.stamp', res);
            const dash = ' \u2013 ';
            if (stamp && stamp.textContent.includes(dash)) {
                const [head, ...rest] = stamp.textContent.split(dash);
                stamp.textContent = '';
                stamp.append(head + ' \u2013', document.createElement('br'), rest.join(dash));
            }

            const detail = $('[data-detail]', res);
            if (detail && deadline && submission) {
                const t = (d) => (sameDay(submission, deadline) ? fmtTime(d) : fmtShort(d));
                if (onTime) {
                    const spare = minutesBetween(submission, deadline);
                    detail.textContent = spare === 0
                        ? 'Submitted at ' + t(submission) + ', right on the deadline.'
                        : 'Submitted at ' + t(submission) + ', ' + spare + ' min before the ' + t(deadline) + ' deadline.';
                } else {
                    detail.textContent = 'Submitted at ' + t(submission) + ', ' + delay + ' min after the ' + t(deadline) + ' deadline.';
                }
            }

            current = {
                studentId: data.student,
                start: data.start,
                duration: Number(data.duration),
                submission: data.submission,
                deadline: data.deadline,
                onTime,
                delay,
                message: data.message,
                checkedAt: Date.now()
            };
            addToHistory(current, isNew);
            if (isNew) announce('Result for ' + current.studentId + ': ' + current.message);
        } else if (err && isNew) {
            const msg = $('p', err);
            announce('This submission can’t be checked. ' + (msg ? msg.textContent : ''));
        }

        if (isNew && (res || err) && window.innerWidth <= 960) {
            panel.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
        }
    }

    function summaryText(r) {
        const s = parseLocal(r.start), d = parseLocal(r.deadline), sub = parseLocal(r.submission);
        return [
            'Student: ' + r.studentId,
            'Exam start: ' + (s ? fmtFull(s) : r.start),
            'Duration: ' + r.duration + ' min',
            'Deadline: ' + (d ? fmtFull(d) : r.deadline),
            'Submitted: ' + (sub ? fmtFull(sub) : r.submission),
            'Result: ' + r.message
        ].join('\n');
    }

    async function copyText(text) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (e) {
            const ta = el('textarea');
            ta.value = text;
            ta.setAttribute('readonly', '');
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.append(ta);
            ta.select();
            let ok = false;
            try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
            ta.remove();
            return ok;
        }
    }

    panel.addEventListener('click', async (event) => {
        if (event.target.closest('[data-copy]') && current) {
            const ok = await copyText(summaryText(current));
            toast(ok ? 'Summary copied to the clipboard.' : 'Couldn’t copy. Select the details and copy them manually.', ok ? {} : { type: 'error' });
        }
        if (event.target.closest('[data-new]')) clearForm();
    });

    /* ---------- Recent checks ---------- */
    const HISTORY_KEY = 'esm.history.v1';
    const HISTORY_MAX = 12;
    const historyTable = $('#history-table');
    const historyBody = $('#history-body');
    const historyEmpty = $('#history-empty');
    const clearHistoryBtn = $('#clear-history');

    const loadHistory = () => {
        const h = store.get(HISTORY_KEY, []);
        return Array.isArray(h) ? h : [];
    };
    const sameCheck = (a, b) => a && b && a.studentId === b.studentId && a.start === b.start &&
        Number(a.duration) === Number(b.duration) && a.submission === b.submission;

    function addToHistory(entry, highlight) {
        const list = loadHistory().filter((e) => !sameCheck(e, entry));
        list.unshift(entry);
        store.set(HISTORY_KEY, list.slice(0, HISTORY_MAX));
        renderHistory(highlight);
    }

    function renderHistory(highlightFirst) {
        const list = loadHistory();
        historyBody.textContent = '';
        list.forEach((e, i) => {
            const tr = el('tr');
            const s = parseLocal(e.start), sub = parseLocal(e.submission);
            tr.append(
                el('td', 'cell-student', e.studentId),
                el('td', 'cell-start col-optional', s ? fmtShort(s) : e.start),
                el('td', 'cell-duration col-optional', e.duration + ' min'),
                el('td', 'cell-submitted', sub ? fmtShort(sub) : e.submission)
            );
            const resultCell = el('td', 'cell-result');
            resultCell.append(el('span', 'badge ' + (e.onTime ? 'badge-ok' : 'badge-late'),
                e.onTime ? 'On time' : 'Late by ' + e.delay + ' min'));
            tr.append(resultCell);

            const actionCell = el('td', 'cell-action');
            const loadBtn = el('button', 'text-btn text-btn-sm', 'Load');
            loadBtn.type = 'button';
            loadBtn.setAttribute('aria-label', 'Load the check for ' + e.studentId + ' into the form');
            actionCell.append(loadBtn);
            tr.append(actionCell);

            tr.addEventListener('click', () => loadIntoForm(e));
            if (highlightFirst && i === 0) tr.classList.add('is-fresh');
            historyBody.append(tr);
        });
        historyTable.hidden = list.length === 0;
        historyEmpty.hidden = list.length > 0;
        clearHistoryBtn.disabled = list.length === 0;
    }

    function loadIntoForm(e) {
        fields.studentId.value = e.studentId;
        fields.start.value = e.start;
        fields.duration.value = e.duration;
        fields.submission.value = e.submission;
        Object.keys(fields).forEach((n) => touched.add(n));
        onFormChanged();
        $('#check').scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
        checkBtn.focus({ preventScroll: true });
        toast('Loaded ' + e.studentId + ' into the form.');
    }

    clearHistoryBtn.addEventListener('click', () => {
        const backup = loadHistory();
        store.set(HISTORY_KEY, []);
        renderHistory(false);
        toast('Recent checks cleared.', {
            action: { label: 'Undo', run: () => { store.set(HISTORY_KEY, backup); renderHistory(false); } }
        });
    });

    /* ---------- Start up ---------- */
    renderHistory(false);
    hydrateResult({ isNew: false }); // a result rendered by the server on a normal (non-script) post
    const initial = readForm();
    updateDeadlineHint(initial);
    updatePreview(initial);
})();
