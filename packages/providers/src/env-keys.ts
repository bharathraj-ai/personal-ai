/** Load numbered API keys: PREFIX, PREFIX_2, PREFIX_5 — gaps allowed. Never log values. */
export function loadNumberedEnvKeys(
  prefix: string,
  env: NodeJS.ProcessEnv = process.env,
): Array<{ keyId: string; envName: string; value: string }> {
  const out: Array<{ keyId: string; envName: string; value: string }> = [];
  const primary = env[prefix]?.trim();
  if (primary) {
    out.push({ keyId: `${prefix.toLowerCase()}-1`, envName: prefix, value: primary });
  }
  for (const [name, raw] of Object.entries(env)) {
    const m = name.match(new RegExp(`^${prefix}_(\\d+)$`));
    if (!m || !raw?.trim()) continue;
    out.push({
      keyId: `${prefix.toLowerCase()}-${m[1]}`,
      envName: name,
      value: raw.trim(),
    });
  }
  const seen = new Set<string>();
  return out.filter((k) => {
    if (seen.has(k.value)) return false;
    seen.add(k.value);
    return true;
  });
}

export function estimateTokensFromText(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function dynamicMaxOutputTokens(input: {
  providerId: string;
  taskChars: number;
  hardMax: number;
}): number {
  const small = input.taskChars < 800;
  const wanted = small ? 512 : input.taskChars < 2500 ? 1024 : 2048;
  return Math.min(wanted, input.hardMax);
}
