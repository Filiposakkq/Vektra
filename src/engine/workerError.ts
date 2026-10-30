export function describeWorkerError(event: ErrorEvent): string {
  const reason: unknown = event.error;
  let detail = '';
  if (reason instanceof Error) {
    detail = `${reason.name}: ${reason.message}${reason.stack ? `\n${reason.stack}` : ''}`;
  } else if (typeof reason === 'string') {
    detail = reason;
  } else if (reason !== undefined) {
    try {
      detail = JSON.stringify(reason) ?? String(reason);
    } catch {
      detail = String(reason);
    }
  }
  const location = event.filename
    ? ` (${event.filename}${event.lineno ? `:${event.lineno}:${event.colno}` : ''})`
    : '';
  return `${event.message || 'Stockfish worker failed'}${location}${detail ? `\n${detail}` : ''}`;
}
