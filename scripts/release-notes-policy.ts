export const firstReleaseNotesHeadings = ["# firefox-cli 0.1.1", "## Highlights", "## Install", "## Distribution", "## Security", "## Known Limits"] as const;

export function validateReleaseNotesBody(body: string, requiredHeadings: readonly string[]): readonly string[] {
  return [
    ...(body.includes("\\n") ? ["Release notes contain literal newline escape sequences."] : []),
    ...requiredHeadings.filter((heading) => !body.includes(heading)).map((heading) => `Release notes are missing heading: ${heading}`),
  ];
}
