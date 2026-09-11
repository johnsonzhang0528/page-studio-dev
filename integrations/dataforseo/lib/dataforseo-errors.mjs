const retryable = new Set([40202, 42900, 50000, 50301]);
const neverRetry = new Set([40100, 40101, 40102, 40203, 40205, 40501, 40601]);

export function classifyDataForSeoStatus(code) {
  const value = Number(code);
  if (value >= 20000 && value < 30000) return {ok:true, retryable:false, class:'success'};
  if (neverRetry.has(value)) return {ok:false, retryable:false, class:'terminal'};
  if (retryable.has(value) || value >= 50000) return {ok:false, retryable:true, class:'transient'};
  return {ok:false, retryable:false, class:'unknown_fail_closed'};
}

export function validateDataForSeoEnvelope(envelope) {
  const errors = [];
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) return {ok:false, errors:['ENVELOPE_INVALID']};
  const general = classifyDataForSeoStatus(envelope.status_code);
  if (!general.ok) errors.push(`GENERAL_STATUS:${envelope.status_code ?? 'MISSING'}`);
  if (!Array.isArray(envelope.tasks) || envelope.tasks.length < 1) errors.push('TASKS_MISSING');
  else for (const task of envelope.tasks) {
    const status = classifyDataForSeoStatus(task?.status_code);
    if (!status.ok) errors.push(`TASK_STATUS:${task?.status_code ?? 'MISSING'}`);
  }
  return {ok:errors.length === 0, errors};
}
