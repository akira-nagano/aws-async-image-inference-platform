export function parseAwsCliJson(
  stdout: string,
  command: string,
  allowEmptyObject = false,
): unknown {
  const output = stdout.trim();
  if (output === "" && allowEmptyObject) return {};
  try {
    return JSON.parse(output) as unknown;
  } catch {
    throw new Error(`AWS CLI returned invalid JSON: ${command}`);
  }
}
