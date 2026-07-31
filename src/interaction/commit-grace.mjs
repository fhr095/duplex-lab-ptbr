const EFFECTFUL_PT_BR =
  /\b(?:agend|apag|apagu|autoriz|cancel|compr|envi|execut|exclu|marc|marqu|mud|pag|public|publiqu|reserv|transfer)[\p{L}]*/iu;

export function selectFinalCommitGraceMs(input) {
  const baseMs = Math.max(0, Number(input.baseMs) || 0);
  const effectfulMs = Math.max(
    baseMs,
    Number(input.effectfulMs) || baseMs
  );
  return EFFECTFUL_PT_BR.test(String(input.transcript ?? ""))
    ? effectfulMs
    : baseMs;
}
