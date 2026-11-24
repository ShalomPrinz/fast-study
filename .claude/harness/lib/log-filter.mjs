// Chromium reports a body-less answer (204) as a failed request with ERR_ABORTED; the response
// record already says it all, so that pair is not logged as an abort.
export const isBenignAbort = (errorText, status) =>
  status === 204 && /ERR_ABORTED/.test(errorText ?? '');
