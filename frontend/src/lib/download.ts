/**
 * Start a download without navigating away.
 *
 * A generated anchor rather than assigning `location.href`: the response carries
 * `Content-Disposition: attachment`, and going through an <a> means the browser
 * treats it as a download rather than as leaving the editor — which would
 * discard unsaved caption edits on a slow response.
 *
 * Shared because there are now two callers minting two different kinds of
 * token, and the mechanism is the one part of the job that is identical.
 */
export function startDownload(url: string) {
  const link = document.createElement("a");
  link.href = url;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
}
