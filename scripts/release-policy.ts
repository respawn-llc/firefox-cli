export type ReleaseSignedXpiPolicy = {
  readonly phase0Mode: boolean;
  readonly requireSignedXpi: boolean;
  readonly allowUnsignedLocal: boolean;
};

export function resolveReleaseSignedXpiPolicy(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
): ReleaseSignedXpiPolicy {
  const phase0Mode = argv.includes("--phase0");
  const requireSignedXpi =
    argv.includes("--require-signed-xpi") || env.FIREFOX_CLI_REQUIRE_SIGNED_XPI === "1";
  const allowUnsignedLocal =
    argv.includes("--allow-unsigned-local") || env.FIREFOX_CLI_ALLOW_UNSIGNED_LOCAL === "1";

  return {
    phase0Mode,
    requireSignedXpi: !phase0Mode && (requireSignedXpi || !allowUnsignedLocal),
    allowUnsignedLocal: !phase0Mode && allowUnsignedLocal && !requireSignedXpi,
  };
}
