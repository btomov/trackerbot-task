// Only the offscreen document calls this: service workers have no DOMParser.
export function inspectHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const has = selector => Boolean(doc.querySelector(selector));
  const facts = (kind, email = null) => ({ kind, email });

  // Blocked or verification pages cannot establish login state.
  if (has('#captchacharacters, form[action*="validateCaptcha"], #auth-captcha-image, form[action*="/ap/cvf/verify"], #cvf-page-content, #auth-mfa-otpcode, #ap_error_page') ||
      /AwsWafIntegration|token\.awswaf\.com|bm-verify|\/_sec\/verify/.test(html)) {
    return facts('unavailable');
  }
  const email = signinEmail(doc);
  if (email) return facts('account', email);
  if (has('#ap_password, #ap_change_login_claim')) return facts('unavailable');
  if (has('#ap_email, #ap_email_login')) return facts('signin');

  return facts('unavailable');
}

function validEmail(value) {
  // Match the entire address. Reject masks (a***@, a•••@) instead of extracting their suffix.
  return !/[*•]/.test(value) && /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(value);
}

function uniqueEmail(values) {
  const emails = new Map();
  for (const value of values) {
    if (!validEmail(value)) return null;
    emails.set(value.toLowerCase(), value);
  }
  return emails.size === 1 ? [...emails.values()][0] : null;
}

function signinEmail(doc) {
  const form = doc.querySelector('form[name="signIn"]');
  if (!form) return null;
  const inputs = [...form.querySelectorAll('input[name="email"]')]
    .map(input => input.value.trim()).filter(Boolean);
  // Dedicated fields take priority; invalid/ambiguous values never fall back to guesses.
  if (inputs.length) return uniqueEmail(inputs);
  form.querySelectorAll('script, style').forEach(node => node.remove());
  const tokens = form.textContent.split(/[\s<>()\[\],;:"]+/).filter(token => token.includes('@'));
  return uniqueEmail(tokens.map(token => token.replace(/[.!?]+$/, '')));
}

export function resolveAccount(account) {
  const result = (status, email = null) => ({ status, email });
  // The selected detection rule: a unique email returned by the sign-in form
  // identifies the logged-in account.
  if (account.email) return result('signed-in', account.email);
  if (account.kind === 'signin') return result('signed-out');
  return result('error');
}
