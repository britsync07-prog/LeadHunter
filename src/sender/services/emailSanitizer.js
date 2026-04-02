const SIMPLE_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

const tryDecode = (value) => {
  let output = value;
  for (let i = 0; i < 2; i += 1) {
    try {
      const decoded = decodeURIComponent(output.replace(/\+/g, '%20'));
      if (decoded === output) break;
      output = decoded;
    } catch {
      break;
    }
  }
  return output;
};

const normalizeRecipientEmail = (input) => {
  let candidate = String(input || '').trim();
  if (!candidate) return '';

  candidate = tryDecode(candidate)
    .replace(/^mailto:/i, '')
    .replace(/^\/+/, '')
    .replace(/^%20+/i, '')
    .replace(/^[<("'`\s]+/, '')
    .replace(/[>)"'`\s]+$/, '')
    .trim();

  if (candidate.startsWith('20') && SIMPLE_EMAIL_RE.test(candidate.slice(2))) {
    candidate = candidate.slice(2);
  }

  if (candidate.startsWith('%20') && SIMPLE_EMAIL_RE.test(candidate.slice(3))) {
    candidate = candidate.slice(3);
  }

  candidate = candidate.trim().toLowerCase();
  return SIMPLE_EMAIL_RE.test(candidate) ? candidate : '';
};

export {
  normalizeRecipientEmail,
  SIMPLE_EMAIL_RE
};
